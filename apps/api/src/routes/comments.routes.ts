/** /api/comments: replies, editing, deleting and reacting to comments. */
import { Router } from "express";
import * as ctrl from "../controllers/comment.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const reactionLimit = rateLimit("reactions", 120, 60);

/** Replies to a comment, oldest first (`Page<Comment>`). */
router.get("/:id/replies", optionalAuth, ctrl.replies);
/** Edit your comment: `{ body }`. */
router.patch("/:id", authenticate, rateLimit("comments", 30, 60), ctrl.update);
/** Delete (author) or remove (moderator) a comment. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/** React: `{ type }` -> `{ reactionCount, reactionCounts, viewerReaction }`. */
router.put("/:id/reaction", authenticate, reactionLimit, ctrl.react);
/** Remove your reaction. */
router.delete("/:id/reaction", authenticate, reactionLimit, ctrl.unreact);
