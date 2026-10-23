/**
 * Events: community events (members RSVP) and network-wide events (anyone signed in
 * RSVPs; who may create them is settings.networkWideEvents).
 *
 * Capacity is enforced inside one transaction holding the event row lock (SELECT ...
 * FOR UPDATE): concurrent RSVPs queue on that lock, so exactly `capacity` people end up
 * GOING and the rest WAITLISTED. Freeing a seat promotes the first WAITLISTED person
 * (by updated_at) and tells them (EVENT_PROMOTED). Counters change in the same
 * transaction. The virtual link is shown only to people who are GOING and the organiser.
 */
import type { CommunityEvent, RsvpStatus, UserSummary } from "@open-social/types";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { isStaff, requireActive } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { buildIcs } from "../domain/ics";
import { decideRsvp, promotable } from "../domain/rsvp";
import { presentEvent, presentEvents } from "../presenters/event.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { eventRepo, type EventRow } from "../repositories/event.repository";
import { decodeTime, encodeTime, pageBy, type Paged } from "../repositories/keyset";
import { userRepo } from "../repositories/user.repository";
import { isBlockedEitherWay } from "../repositories/visibility";
import { claimSingle } from "./media-attach.service";
import { loadContext, memberError, requireReadable, type CommunityContext } from "./membership.service";
import { notify } from "./notification.service";
import { getSettings } from "./settings.service";

export interface EventInput {
  communityId: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  isVirtual?: boolean;
  virtualLink?: string | null;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  capacity?: number | null;
  coverUploadId?: string | null;
}

async function loadEvent(viewer: Actor | null, id: string, exec: Executor = db, lock = false): Promise<{ event: EventRow; ctx: CommunityContext | null }> {
  const event = lock ? await eventRepo.findByIdForUpdate(id, exec) : await eventRepo.findById(id, exec);
  if (!event || event.content_status !== "PUBLISHED") throw notFound("Event not found");
  let ctx: CommunityContext | null = null;
  if (event.community_id) {
    ctx = await loadContext(viewer, event.community_id, exec).catch(() => {
      throw notFound("Event not found");
    });
    if (!ctx.access.canRead) throw notFound("Event not found");
  }
  if (viewer && viewer.id !== event.organizer_id && (await isBlockedEitherWay(viewer.id, event.organizer_id, exec))) throw notFound("Event not found");
  return { event, ctx };
}

function canManage(actor: Actor, event: EventRow, ctx: CommunityContext | null): boolean {
  if (actor.status !== "ACTIVE") return false;
  if (event.organizer_id === actor.id) return true;
  return ctx ? ctx.access.canModerate : isStaff(actor);
}

/** Who may RSVP: members of the event's community, or anyone active for network-wide events. */
function requireParticipant(actor: Actor, ctx: CommunityContext | null): void {
  requireActive(actor);
  if (ctx && !ctx.access.canInteract) throw memberError(ctx);
}

function validateTimes(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw badRequest("Invalid date", "VALIDATION_FAILED");
  if (endsAt <= startsAt) throw badRequest("The event must end after it starts", "INVALID_EVENT_TIMES");
}

export async function list(viewer: Actor | null, q: { scope: "upcoming" | "past" | "going" | "organising"; communityId?: string; cursor?: string; limit: number }): Promise<Paged<CommunityEvent>> {
  if ((q.scope === "going" || q.scope === "organising") && !viewer) return { items: [], nextCursor: null };
  if (q.communityId) await requireReadable(viewer, q.communityId);
  const rows = await eventRepo.list(viewer, { scope: q.scope, communityId: q.communityId, cursor: decodeTime(q.cursor), limit: q.limit });
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  return { items: await presentEvents(viewer, page.items), nextCursor: page.nextCursor };
}

export async function create(actor: Actor, input: EventInput): Promise<CommunityEvent> {
  requireActive(actor);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  validateTimes(startsAt, endsAt);
  const row = await withTransaction(async (trx, fx) => {
    if (input.communityId) {
      const ctx = await loadContext(actor, input.communityId, trx);
      if (!ctx.access.canRead) throw notFound("Community not found");
      if (!ctx.access.canInteract) throw memberError(ctx);
    } else {
      const settings = await getSettings(trx);
      if (settings.networkWideEvents === "STAFF" && !isStaff(actor)) throw forbidden("Only moderators and admins can create network-wide events", "NETWORK_EVENTS_RESTRICTED");
    }
    const cover = await claimSingle(actor.id, input.coverUploadId, "EVENT_COVER", trx);
    const event = await eventRepo.insert(
      {
        id: newId(),
        community_id: input.communityId,
        organizer_id: actor.id,
        title: input.title,
        description: input.description ?? "",
        cover_upload_id: cover,
        location: input.location ?? null,
        is_virtual: input.isVirtual ?? false,
        virtual_link: input.virtualLink ?? null,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: input.timezone ?? "UTC",
        capacity: input.capacity ?? null,
        created_at: new Date(),
      },
      trx,
    );
    fx.job("moderation.scan", { targetType: "EVENT", targetId: event.id });
    return event;
  });
  return presentEvent(actor, row);
}

export async function get(viewer: Actor | null, id: string): Promise<CommunityEvent> {
  const { event } = await loadEvent(viewer, id);
  return presentEvent(viewer, event);
}

/** Promote as many waitlisted people as now fit; notifies each. Returns the updated row. */
async function promoteWaitlist(event: EventRow, actorId: string | null, trx: Executor, fx: Effects): Promise<EventRow> {
  const n = promotable(event.capacity, event.going_count, event.waitlist_count);
  if (!n) return event;
  const next = await eventRepo.firstWaitlisted(event.id, n, trx);
  if (!next.length) return event;
  const ids = next.map((r) => r.user_id);
  await eventRepo.promote(event.id, ids, trx);
  const updated = await eventRepo.adjust(event.id, { going: ids.length, waitlisted: -ids.length, interested: 0 }, trx);
  for (const userId of ids) {
    await notify(
      { recipientId: userId, actorId, type: "EVENT_PROMOTED", entityType: "event", entityId: event.id, communityId: event.community_id, snippet: event.title },
      fx,
      trx,
    );
  }
  return updated;
}

async function notifyAttendees(event: EventRow, actorId: string, type: "EVENT_UPDATED" | "EVENT_CANCELLED", trx: Executor, fx: Effects) {
  for (const userId of await eventRepo.attendeeIds(event.id, ["GOING", "WAITLISTED", "INTERESTED"], trx)) {
    await notify({ recipientId: userId, actorId, type, entityType: "event", entityId: event.id, communityId: event.community_id, snippet: event.title }, fx, trx);
  }
}

export async function update(actor: Actor, id: string, patch: Partial<Omit<EventInput, "communityId">>): Promise<CommunityEvent> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { event, ctx } = await loadEvent(actor, id, trx, true);
    if (!canManage(actor, event, ctx)) throw forbidden("Only the organiser or a moderator can edit this event", "NOT_ORGANIZER");
    if (event.status === "CANCELLED") throw conflict("This event was cancelled", "EVENT_CANCELLED");
    const startsAt = patch.startsAt ? new Date(patch.startsAt) : event.starts_at;
    const endsAt = patch.endsAt ? new Date(patch.endsAt) : event.ends_at;
    validateTimes(startsAt, endsAt);
    const cover = patch.coverUploadId === undefined ? undefined : await claimSingle(actor.id, patch.coverUploadId, "EVENT_COVER", trx);
    let updated = await eventRepo.update(
      event.id,
      {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description ?? "" } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.isVirtual !== undefined ? { is_virtual: patch.isVirtual } : {}),
        ...(patch.virtualLink !== undefined ? { virtual_link: patch.virtualLink } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
        ...(cover !== undefined ? { cover_upload_id: cover } : {}),
        starts_at: startsAt,
        ends_at: endsAt,
        // Moving the start time re-arms the one hour reminder.
        ...(startsAt.getTime() !== event.starts_at.getTime() ? { reminded_at: null } : {}),
      },
      trx,
    );
    if (patch.capacity !== undefined) updated = await promoteWaitlist(updated, actor.id, trx, fx);
    await notifyAttendees(updated, actor.id, "EVENT_UPDATED", trx, fx);
    if (patch.title !== undefined || patch.description !== undefined || patch.location !== undefined || patch.virtualLink !== undefined) {
      fx.job("moderation.scan", { targetType: "EVENT", targetId: event.id });
    }
    return updated;
  });
  return presentEvent(actor, row);
}

export async function cancel(actor: Actor, id: string): Promise<void> {
  requireActive(actor);
  await withTransaction(async (trx, fx) => {
    const { event, ctx } = await loadEvent(actor, id, trx, true);
    if (!canManage(actor, event, ctx)) throw forbidden("Only the organiser or a moderator can cancel this event", "NOT_ORGANIZER");
    if (event.status === "CANCELLED") return;
    const updated = await eventRepo.update(event.id, { status: "CANCELLED" }, trx);
    await notifyAttendees(updated, actor.id, "EVENT_CANCELLED", trx, fx);
  });
}

export async function rsvp(actor: Actor, id: string, requested: "GOING" | "INTERESTED"): Promise<CommunityEvent> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const { event, ctx } = await loadEvent(actor, id, trx, true);
    requireParticipant(actor, ctx);
    if (event.status !== "SCHEDULED" || event.ends_at <= new Date()) throw conflict("This event is not taking RSVPs", "EVENT_CLOSED");
    const current = (await eventRepo.findRsvp(event.id, actor.id, trx))?.status ?? null;
    const decision = decideRsvp({ capacity: event.capacity, goingCount: event.going_count, current: current === "CANCELLED" ? null : current, requested });
    if (decision.status === current) return event;
    await eventRepo.setRsvp(event.id, actor.id, decision.status as RsvpStatus, decision.keepPosition, trx);
    let updated = await eventRepo.adjust(event.id, decision.delta, trx);
    if (decision.seatsFreed) updated = await promoteWaitlist(updated, null, trx, fx);
    return updated;
  });
  return presentEvent(actor, row);
}

export async function unrsvp(actor: Actor, id: string): Promise<CommunityEvent> {
  const row = await withTransaction(async (trx, fx) => {
    const { event } = await loadEvent(actor, id, trx, true);
    const current = (await eventRepo.findRsvp(event.id, actor.id, trx))?.status ?? null;
    if (!current) return event;
    const decision = decideRsvp({ capacity: event.capacity, goingCount: event.going_count, current: current === "CANCELLED" ? null : current, requested: null });
    await eventRepo.deleteRsvp(event.id, actor.id, trx);
    let updated = await eventRepo.adjust(event.id, decision.delta, trx);
    if (decision.seatsFreed && event.status === "SCHEDULED") updated = await promoteWaitlist(updated, null, trx, fx);
    return updated;
  });
  return presentEvent(actor, row);
}

export async function attendees(viewer: Actor | null, id: string, q: { status?: RsvpStatus; cursor?: string; limit: number }): Promise<Paged<{ user: UserSummary; status: RsvpStatus }>> {
  const { event } = await loadEvent(viewer, id);
  const rows = await eventRepo.attendees(event.id, viewer?.id ?? null, q.status, decodeTime(q.cursor), q.limit);
  const page = pageBy(rows, q.limit, (r) => encodeTime(r._at, r.id));
  const users = await loadSummaries(page.items.map((r) => r.id));
  return { items: page.items.filter((r) => users.has(r.id)).map((r) => ({ user: users.get(r.id)!, status: r.status })), nextCursor: page.nextCursor };
}

export async function ics(viewer: Actor | null, id: string): Promise<{ filename: string; body: string }> {
  const { event } = await loadEvent(viewer, id);
  const rsvpStatus = viewer ? (await eventRepo.findRsvp(event.id, viewer.id))?.status : undefined;
  const seesLink = !!viewer && (viewer.id === event.organizer_id || rsvpStatus === "GOING");
  const organizer = await userRepo.findById(event.organizer_id);
  const body = buildIcs(
    {
      uid: `${event.id}@${new URL(config.APP_WEB_URL).hostname}`,
      title: event.title,
      description: event.description,
      location: event.location,
      url: seesLink ? event.virtual_link : null,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      createdAt: event.created_at,
      updatedAt: event.updated_at,
      cancelled: event.status === "CANCELLED",
      organizerName: organizer?.display_name ?? "Organiser",
    },
    config.PRODUCT_NAME,
  );
  return { filename: `event-${event.id}.ics`, body };
}

/** maintenance.event-reminders: GOING attendees of events starting within the hour. */
export async function sendDueReminders(): Promise<number> {
  let sent = 0;
  for (const event of await eventRepo.dueReminders()) {
    await withTransaction(async (trx, fx) => {
      if (!(await eventRepo.claimReminder(event.id, trx))) return;
      for (const userId of await eventRepo.attendeeIds(event.id, ["GOING"], trx)) {
        await notify({ recipientId: userId, actorId: null, type: "EVENT_REMINDER", entityType: "event", entityId: event.id, communityId: event.community_id, snippet: event.title }, fx, trx);
        sent += 1;
      }
    });
  }
  return sent;
}
