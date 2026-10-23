import type { CommunityEvent, UserSummary } from "@open-social/types";

export const organizer: UserSummary = { id: "01J0000000000000000000000A", username: "org", displayName: "Org Person", avatarUrl: null, headline: null, role: "USER" };

export function makeEvent(over: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: "01J0000000000000000000000E",
    community: { id: "c1", slug: "makers", name: "Makers" },
    organizer,
    title: "Community meetup",
    description: "Bring a friend",
    coverUrl: null,
    location: "Main hall",
    isVirtual: false,
    virtualLink: null,
    startsAt: "2026-06-10T16:00:00.000Z",
    endsAt: "2026-06-10T18:00:00.000Z",
    timezone: "UTC",
    capacity: null,
    goingCount: 3,
    waitlistCount: 0,
    interestedCount: 1,
    status: "SCHEDULED",
    viewer: { rsvp: null, waitlistPosition: null, canEdit: false },
    ...over,
  };
}
