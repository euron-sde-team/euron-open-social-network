/** Contract types added by the admin and moderation modules. Re-exported from index.ts. */
import type { UserStatus, UserSummary } from "./index";

/** A row of GET /api/admin/users (and the response of the account actions). */
export interface AdminUserRow extends UserSummary {
  email: string;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
  suspendedUntil: string | null;
}

/** GET /api/admin/stats */
export interface AdminStats {
  totals: { users: number; activeUsers7d: number; communities: number; posts: number; messages: number };
  daily: { date: string; signups: number; posts: number; messages: number }[];
}

/** GET /api/moderation/stats */
export interface ModerationStats {
  openCases: number;
  openAppeals: number;
  actionsToday: number;
  autoHiddenToday: number;
}
