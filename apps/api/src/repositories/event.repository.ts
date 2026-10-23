/**
 * Events and RSVPs. Capacity is enforced by the service while it holds the event row
 * lock (`findByIdForUpdate`), so concurrent RSVPs are decided one at a time.
 */
import type { RsvpStatus } from "@open-social/types";
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Events } from "../db/types";
import type { RsvpCounters } from "../domain/rsvp";
import { atKey, newerThan, olderThan, type TimeKey } from "./keyset";
import { canReadCommunity, notBlocked } from "./visibility";

export type EventRow = Selectable<Events>;

export class EventRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("events").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("events").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  /** Network-wide events are public; community events follow the community's visibility. */
  visible(viewer: Actor | null, exec: Executor = db) {
    return exec
      .selectFrom("events as e")
      .leftJoin("communities as c", "c.id", "e.community_id")
      .selectAll("e")
      .where("e.content_status", "=", "PUBLISHED")
      .where(notBlocked(viewer?.id, "e.organizer_id"))
      .where((eb) =>
        eb.or([
          eb("e.community_id", "is", null),
          eb.and([eb("c.status", "=", "PUBLISHED"), canReadCommunity(viewer, "e.community_id")(eb)]),
        ]),
      );
  }

  list(viewer: Actor | null, opts: { scope: "upcoming" | "past" | "going" | "organising"; communityId?: string; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = this.visible(viewer, exec).select(atKey("e.starts_at"));
    if (opts.communityId) q = q.where("e.community_id", "=", opts.communityId);
    const now = new Date();
    switch (opts.scope) {
      case "upcoming":
        q = q.where("e.status", "=", "SCHEDULED").where("e.ends_at", ">=", now);
        break;
      case "past":
        q = q.where("e.status", "=", "SCHEDULED").where("e.ends_at", "<", now);
        break;
      case "going":
        q = q.where((eb) =>
          eb.exists(eb.selectFrom("event_rsvps as r").select("r.event_id").whereRef("r.event_id", "=", "e.id").where("r.user_id", "=", viewer?.id ?? "").where("r.status", "in", ["GOING", "WAITLISTED"])),
        );
        break;
      case "organising":
        q = q.where("e.organizer_id", "=", viewer?.id ?? "");
        break;
    }
    if (opts.scope === "past") return q.where(olderThan("e.starts_at", "e.id", opts.cursor)).orderBy("e.starts_at", "desc").orderBy("e.id", "desc").limit(opts.limit + 1).execute();
    return q.where(newerThan("e.starts_at", "e.id", opts.cursor)).orderBy("e.starts_at", "asc").orderBy("e.id", "asc").limit(opts.limit + 1).execute();
  }

  insert(row: Insertable<Events>, exec: Executor = db) {
    return exec.insertInto("events").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Events>, exec: Executor = db) {
    return exec
      .updateTable("events")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  adjust(id: string, d: RsvpCounters, exec: Executor) {
    return exec
      .updateTable("events")
      .set({
        going_count: sql`greatest(0, going_count + ${d.going})`,
        waitlist_count: sql`greatest(0, waitlist_count + ${d.waitlisted})`,
        interested_count: sql`greatest(0, interested_count + ${d.interested})`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findRsvp(eventId: string, userId: string, exec: Executor = db) {
    return exec.selectFrom("event_rsvps").selectAll().where("event_id", "=", eventId).where("user_id", "=", userId).executeTakeFirst();
  }

  async setRsvp(eventId: string, userId: string, status: RsvpStatus, keepPosition: boolean, exec: Executor): Promise<void> {
    const now = new Date();
    await exec
      .insertInto("event_rsvps")
      .values({ event_id: eventId, user_id: userId, status, created_at: now, updated_at: now })
      .onConflict((oc) => oc.columns(["event_id", "user_id"]).doUpdateSet(keepPosition ? { status } : { status, updated_at: now }))
      .execute();
  }

  deleteRsvp(eventId: string, userId: string, exec: Executor) {
    return exec.deleteFrom("event_rsvps").where("event_id", "=", eventId).where("user_id", "=", userId).execute();
  }

  /** The first `n` on the waitlist, first come first served. */
  firstWaitlisted(eventId: string, n: number, exec: Executor) {
    return exec
      .selectFrom("event_rsvps")
      .select(["user_id", "updated_at"])
      .where("event_id", "=", eventId)
      .where("status", "=", "WAITLISTED")
      .orderBy("updated_at", "asc")
      .orderBy("user_id", "asc")
      .limit(n)
      .forUpdate()
      .execute();
  }

  promote(eventId: string, userIds: readonly string[], exec: Executor) {
    if (!userIds.length) return Promise.resolve();
    return exec
      .updateTable("event_rsvps")
      .set({ status: "GOING", updated_at: new Date() })
      .where("event_id", "=", eventId)
      .where("user_id", "in", [...userIds])
      .execute()
      .then(() => undefined);
  }

  viewerRsvps(userId: string | null | undefined, eventIds: readonly string[], exec: Executor = db): Promise<Map<string, RsvpStatus>> {
    if (!userId || !eventIds.length) return Promise.resolve(new Map());
    return exec
      .selectFrom("event_rsvps")
      .select(["event_id", "status"])
      .where("user_id", "=", userId)
      .where("event_id", "in", [...eventIds])
      .execute()
      .then((rows) => new Map(rows.map((r) => [r.event_id, r.status])));
  }

  /**
   * The viewer's 1-based place on each waitlist they are on, in promotion order
   * (updated_at, then user id: the order `firstWaitlisted` promotes in).
   */
  waitlistPositions(userId: string | null | undefined, eventIds: readonly string[], exec: Executor = db): Promise<Map<string, number>> {
    if (!userId || !eventIds.length) return Promise.resolve(new Map());
    return exec
      .selectFrom("event_rsvps as r")
      .select("r.event_id")
      .select((eb) =>
        eb
          .selectFrom("event_rsvps as o")
          .select(sql<string>`count(*) + 1`.as("n"))
          .whereRef("o.event_id", "=", "r.event_id")
          .where("o.status", "=", "WAITLISTED")
          .where(sql<boolean>`(o.updated_at, o.user_id) < (r.updated_at, r.user_id)`)
          .as("position"),
      )
      .where("r.user_id", "=", userId)
      .where("r.event_id", "in", [...eventIds])
      .where("r.status", "=", "WAITLISTED")
      .execute()
      .then((rows) => new Map(rows.map((r) => [r.event_id, Number(r.position ?? 1)])));
  }

  attendeeIds(eventId: string, statuses: RsvpStatus[], exec: Executor = db) {
    return exec
      .selectFrom("event_rsvps")
      .select("user_id")
      .where("event_id", "=", eventId)
      .where("status", "in", statuses)
      .execute()
      .then((rows) => rows.map((r) => r.user_id));
  }

  attendees(eventId: string, viewerId: string | null, status: RsvpStatus | undefined, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    let q = exec
      .selectFrom("event_rsvps as r")
      .innerJoin("users as u", "u.id", "r.user_id")
      .select(["r.user_id as id", "r.status"])
      .select(atKey("r.updated_at"))
      .where("r.event_id", "=", eventId)
      .where("r.status", "!=", "CANCELLED")
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, "r.user_id"));
    if (status) q = q.where("r.status", "=", status);
    return q.where(newerThan("r.updated_at", "r.user_id", cursor)).orderBy("r.updated_at", "asc").orderBy("r.user_id", "asc").limit(limit + 1).execute();
  }

  /** Scheduled events starting within the next hour that have not been reminded yet. */
  dueReminders(exec: Executor = db) {
    return exec
      .selectFrom("events")
      .selectAll()
      .where("status", "=", "SCHEDULED")
      .where("content_status", "=", "PUBLISHED")
      .where("reminded_at", "is", null)
      .where("starts_at", ">", new Date())
      .where("starts_at", "<=", new Date(Date.now() + 3600_000))
      .limit(200)
      .execute();
  }

  /** Claim a reminder: only one worker wins the update. */
  async claimReminder(id: string, exec: Executor): Promise<boolean> {
    const r = await exec.updateTable("events").set({ reminded_at: new Date() }).where("id", "=", id).where("reminded_at", "is", null).executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }
}

export const eventRepo = new EventRepository();
