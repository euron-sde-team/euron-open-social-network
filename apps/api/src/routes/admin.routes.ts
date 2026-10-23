/** /api/admin: the platform console for staff (read) and admins (change). */
import { Router } from "express";
import * as ctrl from "../controllers/admin.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();

router.use(authenticate);

/** Platform settings (moderation thresholds, provider, blocked terms, community rules). Admin. */
router.get("/settings", ctrl.getSettings);
/** Change part of the settings. Thresholds are 0..1 with review at most hide. Admin. */
router.patch("/settings", ctrl.patchSettings);
/** Totals and a daily series of sign-ups, posts and messages. Staff. */
router.get("/stats", ctrl.stats);
/** Account directory with search by name, username or exact email. Staff. */
router.get("/users", ctrl.users);
/** Change an account's platform role. Not your own, never the last admin. Admin. */
router.patch("/users/:id", ctrl.patchUser);
/** Suspend an account for some days; its sockets disconnect. Staff. */
router.post("/users/:id/suspend", ctrl.suspend);
/** Lift a suspension early. Staff. */
router.post("/users/:id/unsuspend", ctrl.unsuspend);
/** Ban an account: every session is revoked and its sockets disconnect. Admin. */
router.post("/users/:id/ban", ctrl.ban);
/** Lift a ban. Admin. */
router.post("/users/:id/unban", ctrl.unban);
/** Every community, any status. Staff. */
router.get("/communities", ctrl.communities);
/** Make a community a default for new accounts, or remove it network-wide. Admin. */
router.patch("/communities/:id", ctrl.patchCommunity);
/** The audit trail of security and administrative actions. Admin. */
router.get("/audit", ctrl.auditLog);
