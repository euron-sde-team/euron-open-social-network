/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line.
 */
import type { Express } from "express";
import { router as admin } from "./admin.routes";
import { router as auth } from "./auth.routes";
import { router as chat } from "./chat.routes";
import { router as comments } from "./comments.routes";
import { router as communities } from "./communities.routes";
import { router as discover } from "./discover.routes";
import { router as dms } from "./dms.routes";
import { router as events } from "./events.routes";
import { router as media } from "./media.routes";
import { router as meta } from "./meta.routes";
import { router as moderation } from "./moderation.routes";
import { router as notifications } from "./notifications.routes";
import { router as polls } from "./polls.routes";
import { router as posts } from "./posts.routes";
import { router as questions } from "./questions.routes";
import { router as reports } from "./reports.routes";
import { router as users } from "./users.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/communities", communities],
  ["/api/posts", posts],
  ["/api/comments", comments],
  ["/api/polls", polls],
  ["/api/questions", questions],
  ["/api/events", events],
  ["/api/chat", chat],
  ["/api/dms", dms],
  ["/api/media", media],
  ["/api/notifications", notifications],
  ["/api/discover", discover],
  ["/api/reports", reports],
  ["/api/moderation", moderation],
  ["/api/admin", admin],
  ["/api/meta", meta],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
