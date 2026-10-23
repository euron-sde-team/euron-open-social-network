/**
 * Events to DTOs. The virtual link is the one piece of an event that is not public:
 * only people who are GOING and the organiser see it (the source system sent it to
 * everyone who could load the event). `viewer.waitlistPosition` is the viewer's own
 * place in the promotion queue, loaded for the whole page in one query.
 */
import type { CommunityEvent } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Access } from "../domain/community-access";
import { communityRepo } from "../repositories/community.repository";
import { eventRepo, type EventRow } from "../repositories/event.repository";
import { accessMap } from "./community.presenter";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

export async function presentEvents(viewer: Actor | null, rows: readonly EventRow[], exec: Executor = db): Promise<CommunityEvent[]> {
  if (!rows.length) return [];
  const communityIds = rows.map((r) => r.community_id).filter((x): x is string => !!x);
  const [communities, organizers, media, rsvps, positions] = await Promise.all([
    communityRepo.findMany(communityIds, exec),
    loadSummaries(rows.map((r) => r.organizer_id), exec),
    loadMedia(rows.map((r) => r.cover_upload_id), exec),
    eventRepo.viewerRsvps(viewer?.id, rows.map((r) => r.id), exec),
    eventRepo.waitlistPositions(viewer?.id, rows.map((r) => r.id), exec),
  ]);
  const access = await accessMap(viewer, communities, exec);
  const byId = new Map(communities.map((c) => [c.id, c]));
  const active = viewer?.status === "ACTIVE";

  return rows
    .filter((r) => organizers.has(r.organizer_id))
    .map((r) => {
      const c = r.community_id ? byId.get(r.community_id) : undefined;
      const a = c ? (access.get(c.id) as Access) : undefined;
      const rsvp = rsvps.get(r.id) ?? null;
      const isOrganizer = viewer?.id === r.organizer_id;
      const canModerate = a ? a.canModerate : active && (viewer?.role === "ADMIN" || viewer?.role === "MODERATOR");
      return {
        id: r.id,
        community: c ? { id: c.id, slug: c.slug, name: c.name } : null,
        organizer: organizers.get(r.organizer_id)!,
        title: r.title,
        description: r.description,
        coverUrl: urlOf(media, r.cover_upload_id),
        location: r.location,
        isVirtual: r.is_virtual,
        virtualLink: isOrganizer || rsvp === "GOING" ? r.virtual_link : null,
        startsAt: r.starts_at.toISOString(),
        endsAt: r.ends_at.toISOString(),
        timezone: r.timezone,
        capacity: r.capacity,
        goingCount: r.going_count,
        waitlistCount: r.waitlist_count,
        interestedCount: r.interested_count,
        status: r.status,
        viewer: {
          rsvp: rsvp === "CANCELLED" ? null : rsvp,
          waitlistPosition: rsvp === "WAITLISTED" ? (positions.get(r.id) ?? null) : null,
          canEdit: (active && isOrganizer) || !!canModerate,
        },
      };
    });
}

export async function presentEvent(viewer: Actor | null, row: EventRow, exec: Executor = db): Promise<CommunityEvent> {
  const [e] = await presentEvents(viewer, [row], exec);
  if (!e) throw new Error(`event ${row.id} could not be presented`);
  return e;
}
