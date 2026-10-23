/** /api/dms: 1:1 and group conversations, message requests, reactions, pins, read state and contacts. */
import { Router } from "express";
import * as ctrl from "../controllers/dm.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

const send = rateLimit("dm-send", 30, 60);

/** Your conversations: `folder=inbox` (accepted) or `folder=requests` (message requests). */
router.get("/threads", ctrl.listThreads);
/** Find or create the 1:1 conversation with a user. 403 DM_NOT_ALLOWED with `details.reason`. */
router.post("/threads", ctrl.openDirect);
/** Start a group conversation with 2 to 49 other people. */
router.post("/threads/group", ctrl.createGroup);
/** One conversation, from your side. */
router.get("/threads/:id", ctrl.getThread);
/** Rename a group, or mute a conversation until a time (null unmutes). */
router.patch("/threads/:id", ctrl.updateThread);
/** Messages, newest first. */
router.get("/threads/:id/messages", ctrl.listMessages);
/** Send a message (body and/or upload ids). Rate limited to 30 a minute. */
router.post("/threads/:id/messages", send, ctrl.sendMessage);
/** Pinned messages (`Message[]`), newest pin first. Participants only. */
router.get("/threads/:id/pinned", ctrl.pinned);
/** Mark everything up to now as read. */
router.post("/threads/:id/read", ctrl.markRead);
/** Accept a message request. */
router.post("/threads/:id/accept", ctrl.accept);
/** Decline a message request. */
router.post("/threads/:id/decline", ctrl.decline);
/** Leave a group conversation. */
router.post("/threads/:id/leave", ctrl.leave);
/** Add people to a group conversation. */
router.post("/threads/:id/participants", ctrl.addParticipants);
/** Every attachment in the conversation, newest first. */
router.get("/threads/:id/media", ctrl.threadMedia);
/** Full-text search within one conversation. */
router.get("/threads/:id/search", ctrl.search);
/** Edit your message. */
router.patch("/messages/:id", ctrl.editMessage);
/** Delete your message (leaves a tombstone). */
router.delete("/messages/:id", ctrl.deleteMessage);
/** Pin a message in its conversation. */
router.post("/messages/:id/pin", ctrl.pin);
/** Unpin a message. */
router.delete("/messages/:id/pin", ctrl.unpin);
/** React with an emoji (idempotent). */
router.put("/messages/:id/reactions/:emoji", ctrl.addReaction);
/** Remove your emoji reaction. */
router.delete("/messages/:id/reactions/:emoji", ctrl.removeReaction);
/** Unread badge: messages in your inbox, and pending requests. */
router.get("/unread", ctrl.unread);
/** Whether you may message a user right now, and why not. */
router.get("/eligibility/:userId", ctrl.eligibility);
/** People you can message now, online first. */
router.get("/contacts", ctrl.contacts);
