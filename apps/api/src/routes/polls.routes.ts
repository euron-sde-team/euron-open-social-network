/** /api/polls: polls attached to posts. */
import { Router } from "express";
import * as ctrl from "../controllers/poll.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const votes = rateLimit("poll-votes", 60, 60);

/** A poll (`Poll`). Private communities: members only. */
router.get("/:id", optionalAuth, ctrl.get);
/** Vote: `{ optionIds }` (`Poll`); replaces your previous vote. Single-choice polls take exactly one option. */
router.post("/:id/vote", authenticate, votes, ctrl.vote);
/** Withdraw your vote (`Poll`). */
router.delete("/:id/vote", authenticate, votes, ctrl.unvote);
/** Close the poll (post author or mod). */
router.post("/:id/close", authenticate, ctrl.close);
/** Who voted (`Page<UserSummary>`), `optionId` filter. Members only; 403 POLL_ANONYMOUS for anonymous polls. */
router.get("/:id/voters", authenticate, ctrl.voters);
