/** /api/chat: the live chat room of each community, for its active members. */
import { Router } from "express";
import * as ctrl from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** Unread message counts per community you belong to. */
router.get("/unread", ctrl.unread);
/** Edit your chat message. */
router.patch("/messages/:id", ctrl.editMessage);
/** Delete a chat message: your own, or anyone's as a moderator. */
router.delete("/messages/:id", ctrl.deleteMessage);
/** Pin a chat message (moderators). */
router.post("/messages/:id/pin", ctrl.pin);
/** Unpin a chat message (moderators). */
router.delete("/messages/:id/pin", ctrl.unpin);
/** React with an emoji (idempotent). */
router.put("/messages/:id/reactions/:emoji", ctrl.addReaction);
/** Remove your emoji reaction. */
router.delete("/messages/:id/reactions/:emoji", ctrl.removeReaction);
/** Chat history, newest first. */
router.get("/:communityId/messages", ctrl.listMessages);
/** Send a chat message. Rate limited to 30 a minute. */
router.post("/:communityId/messages", rateLimit("chat-send", 30, 60), ctrl.sendMessage);
/** Pinned messages of the room. */
router.get("/:communityId/pinned", ctrl.pinned);
/** Mark the room read up to now. */
router.post("/:communityId/read", ctrl.markRead);
/** Mute the room until a time (null unmutes). */
router.patch("/:communityId/mute", ctrl.mute);
