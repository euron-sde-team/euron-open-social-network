/** /api/questions: community Q&A with votes and accepted answers. */
import { Router } from "express";
import * as ctrl from "../controllers/question.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const writes = rateLimit("qa-writes", 20, 60);
const votes = rateLimit("qa-votes", 120, 60);

/** Questions of a community (`Page<Question>`): `communityId` (required), `status`, `sort=new|top|unanswered`, `tag`. */
router.get("/", optionalAuth, ctrl.list);
/** Ask (201 `Question`): `{ communityId, title, body, tags? }`. */
router.post("/", authenticate, writes, ctrl.create);
/** Edit your answer: `{ body }`. */
router.patch("/answers/:answerId", authenticate, writes, ctrl.updateAnswer);
/** Delete (author) or remove (moderator) an answer. 204. */
router.delete("/answers/:answerId", authenticate, ctrl.removeAnswer);
/** Vote on an answer: `{ value: -1 | 0 | 1 }` -> `{ score, vote }`. Idempotent. */
router.post("/answers/:answerId/vote", authenticate, votes, ctrl.voteAnswer);
/** A question (`Question`). Counts a view once per viewer per hour. */
router.get("/:id", optionalAuth, ctrl.get);
/** Edit your question: `{ title?, body?, tags? }`. */
router.patch("/:id", authenticate, writes, ctrl.update);
/** Delete (author) or remove (moderator) a question. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/** Vote: `{ value: -1 | 0 | 1 }` -> `{ score, vote }`. Idempotent; not on your own question. */
router.post("/:id/vote", authenticate, votes, ctrl.vote);
/** Open or close (author or mod): `{ status: OPEN | CLOSED }`. */
router.post("/:id/status", authenticate, ctrl.setStatus);
/** Accept an answer (the question's author only): `{ answerId | null }`. */
router.post("/:id/accept", authenticate, ctrl.accept);
/** Answers (`Page<Answer>`), accepted first: `sort=top|new`. */
router.get("/:id/answers", optionalAuth, ctrl.answers);
/** Answer (201 `Answer`): `{ body }`. Notifies the asker (ANSWER_POSTED). */
router.post("/:id/answers", authenticate, writes, ctrl.createAnswer);
