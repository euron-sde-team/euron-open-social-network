/** /api/reports: members flag content and accounts for the moderators. */
import { Router } from "express";
import * as ctrl from "../controllers/report.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Report a post, comment, message, question, answer, event, account or community. 409 ALREADY_REPORTED on a repeat. */
router.post("/", authenticate, rateLimit("reports", 20, 3600), ctrl.create);
