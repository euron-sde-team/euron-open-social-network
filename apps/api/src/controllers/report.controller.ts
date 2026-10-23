/** Filing reports. Validation here; the rules live in services/moderation/reports.service.ts. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import { createReport } from "../services/moderation/reports.service";

const TARGETS = ["POST", "COMMENT", "CHAT_MESSAGE", "DM_MESSAGE", "QUESTION", "ANSWER", "EVENT", "USER", "COMMUNITY"] as const;
const REASONS = ["SPAM", "HARASSMENT", "HATE", "VIOLENCE", "SEXUAL", "SELF_HARM", "MISINFORMATION", "IMPERSONATION", "OTHER"] as const;

const body = z.object({
  targetType: z.enum(TARGETS),
  targetId: id(),
  reason: z.enum(REASONS),
  details: z.string().trim().max(1000).optional().nullable(),
});

export async function create(req: Request, res: Response) {
  const input = parse(body, req.body);
  res.status(201).json(await createReport(actorOf(req), { ...input, details: input.details || null }));
}
