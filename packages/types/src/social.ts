/** Contract types added by the social module. Re-exported from index.ts. */
import type { UserSummary } from "./index";

/** A row of GET /api/users/:username/followers and /following. */
export type FollowEntry = UserSummary & {
  /** The viewer follows this person; always false when signed out or for yourself. */
  viewerFollows: boolean;
};
