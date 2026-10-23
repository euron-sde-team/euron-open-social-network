/** /api/moderation: the case queue for staff and community moderators, appeals, and authors' own cases. */
import { Router } from "express";
import * as ctrl from "../controllers/moderation.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/** The queue: staff see every case, community moderators their communities' cases. Open cases sort by priority, then oldest. */
router.get("/cases", ctrl.list);
/** One case with its snapshot, report reasons (never reporters), current target status and appeal. Its author (the subject, for USER cases) gets the author view: no AI scores, no moderator. */
router.get("/cases/:id", ctrl.detail);
/** Act on a case. Community moderators: HIDE, REMOVE, RESTORE, APPROVE, DISMISS only. */
router.post("/cases/:id/actions", ctrl.act);
/** Assign a case to a staff member (or unassign with null). Staff only. */
router.post("/cases/:id/assign", ctrl.assign);
/** Appeal a decision about your content or account, once, within 30 days. */
router.post("/cases/:id/appeal", rateLimit("appeals", 10, 3600), ctrl.appeal);
/** Every moderation action taken on one target. Staff only. */
router.get("/history", ctrl.history);
/** Cases about your own content or account, in the author view (no reporters, no AI scores, no moderator). */
router.get("/me", ctrl.mine);
/** Appeals waiting for (or past) a decision. Staff only. */
router.get("/appeals", ctrl.appeals);
/** Decide an appeal. The moderator who resolved the case may not, unless an admin writes a note. */
router.post("/appeals/:id/decide", ctrl.decide);
/** Queue counters for the moderation dashboard: network-wide for staff, your communities only for community moderators. */
router.get("/stats", ctrl.stats);
