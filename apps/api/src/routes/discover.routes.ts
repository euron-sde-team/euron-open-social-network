/** /api/discover: search, typeahead, trending tags, tag pages and the leaderboard. */
import { Router } from "express";
import * as ctrl from "../controllers/discover.controller";
import { optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const searches = rateLimit("search", 60, 60, "ip");

/** Search people, communities, posts and questions (`SearchResults`): `q` (2+ characters), `type`. */
router.get("/search", optionalAuth, searches, ctrl.search);
/** Quick suggestions while typing: `{ people, communities }`. */
router.get("/typeahead", optionalAuth, searches, ctrl.typeahead);
/** Most used tags over the last 14 days (`TrendingTag[]`). */
router.get("/trending-tags", optionalAuth, ctrl.trendingTags);
/** Posts with a tag (`Page<Post>`). */
router.get("/tags/:tag/posts", optionalAuth, ctrl.tagPosts);
/** Top contributors (`LeaderboardEntry[]`): `period=week|month|all`. */
router.get("/leaderboard", optionalAuth, ctrl.leaderboard);
