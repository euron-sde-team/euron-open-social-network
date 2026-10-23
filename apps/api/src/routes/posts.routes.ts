/** /api/posts: the home feed, posts, reactions, bookmarks, pinning, locking and comments on a post. */
import { Router } from "express";
import * as ctrl from "../controllers/post.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const postLimit = rateLimit("posts", 10, 60);
const commentLimit = rateLimit("comments", 30, 60);
const reactionLimit = rateLimit("reactions", 120, 60);

/** Your feed (`Page<Post>`): your communities plus public posts by people you follow. `sort=latest|top` (top: last 7 days). */
router.get("/feed", authenticate, ctrl.homeFeed);
/** Create a post (201 `Post`): `{ communityId, body, kind?, feeling?, tags?, mediaIds?, poll?, sharedPostId? }`. ANNOUNCEMENT is for moderators. */
router.post("/", authenticate, postLimit, ctrl.create);
/** A post (`Post`). 404 for private communities you are not in, and across blocks. */
router.get("/:id", optionalAuth, ctrl.get);
/** Edit your post: `{ body?, tags?, feeling? }`. */
router.patch("/:id", authenticate, postLimit, ctrl.update);
/** Delete (author) or remove (moderator) a post. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/** React: `{ type }` -> `{ reactionCount, reactionCounts, viewerReaction }`. Changing type replaces your reaction. */
router.put("/:id/reaction", authenticate, reactionLimit, ctrl.react);
/** Remove your reaction. */
router.delete("/:id/reaction", authenticate, reactionLimit, ctrl.unreact);
/** Who reacted (`Page<{ user, type }>`), `type` filter. */
router.get("/:id/reactions", optionalAuth, ctrl.reactionList);
/** Bookmark. 204. */
router.post("/:id/bookmark", authenticate, ctrl.bookmark);
/** Remove the bookmark. 204. */
router.delete("/:id/bookmark", authenticate, ctrl.unbookmark);
/** Hide from your own feed. 204. */
router.post("/:id/hide", authenticate, ctrl.hide);
/** Pin (mod). */
router.post("/:id/pin", authenticate, ctrl.pin);
/** Unpin (mod). */
router.delete("/:id/pin", authenticate, ctrl.unpin);
/** Lock comments (mod). */
router.post("/:id/lock", authenticate, ctrl.lock);
/** Unlock comments (mod). */
router.delete("/:id/lock", authenticate, ctrl.unlock);
/** Top-level comments, oldest first (`Page<Comment>`). */
router.get("/:id/comments", optionalAuth, ctrl.listComments);
/** Comment or reply: `{ body, parentId?, mediaId? }`. 201 `Comment`. */
router.post("/:id/comments", authenticate, commentLimit, ctrl.createComment);
