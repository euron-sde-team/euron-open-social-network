/**
 * User reports. A report joins the target's open case (or opens a REPORT case), raises
 * its priority, and, once enough established accounts agree, hides the content until
 * a moderator looks (see domain/report-threshold.ts for the exact rule). Only reports
 * on the currently OPEN case count (filed since the last resolution), and only from
 * reporters who are ACTIVE now and whose accounts are older than a day.
 *
 * Reporting is only possible for what the reporter can see: anything else is a 404,
 * so reports cannot probe for hidden content. Reporters are never revealed to authors.
 */
import type { ModerationTarget, ReportReason } from "@open-social/types";
import { requireActive, type Actor } from "../../core/context";
import { withTransaction } from "../../core/effects";
import { badRequest, conflict, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { bumpPriority, shouldAutoHideFromReports } from "../../domain/report-threshold";
import { moderationRepo } from "../../repositories/moderation.repository";
import { emitQueue, labelOf, notifyAuthor, openCaseFor } from "./cases.service";
import { loadTarget, setContentStatus, visibleTo } from "./targets";

export interface ReportInput {
  targetType: ModerationTarget;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
}

export async function createReport(actor: Actor, input: ReportInput): Promise<{ id: string }> {
  requireActive(actor);
  const probe = await loadTarget(input.targetType, input.targetId);
  if (!probe || !(await visibleTo(actor, probe))) throw notFound("Not found", "TARGET_NOT_FOUND");
  if (probe.authorId === actor.id) throw badRequest("You cannot report yourself or your own content", "CANNOT_REPORT_SELF");
  if (await moderationRepo.findReport(actor.id, input.targetType, input.targetId)) throw conflict("You already reported this", "ALREADY_REPORTED");

  return withTransaction(async (trx, fx) => {
    const info = await loadTarget(input.targetType, input.targetId, trx);
    if (!info) throw notFound("Not found", "TARGET_NOT_FOUND");
    const { row: kase } = await openCaseFor(info, "REPORT", {}, trx, fx);
    const report = await moderationRepo.insertReport(
      { id: newId(), reporter_id: actor.id, target_type: input.targetType, target_id: input.targetId, reason: input.reason, details: input.details ?? null, case_id: kase.id },
      trx,
    );
    if (!report) throw conflict("You already reported this", "ALREADY_REPORTED");
    await moderationRepo.updateCase(kase.id, { report_count: kase.report_count + 1, priority: bumpPriority(kase.priority) }, trx);

    // Three established reporters hide the content pending review (rule and reasons in domain/report-threshold.ts).
    const author = info.authorId ? await trx.selectFrom("users").select("role").where("id", "=", info.authorId).executeTakeFirst() : undefined;
    const hide = shouldAutoHideFromReports({
      targetType: info.type,
      reporterAgesDays: await moderationRepo.reporterAges(kase.id, trx),
      authorIsStaff: author?.role === "ADMIN" || author?.role === "MODERATOR",
      targetStatus: info.status,
    });
    if (hide && (await setContentStatus(info, "HIDDEN", trx, fx))) {
      await moderationRepo.insertAction(
        { id: newId(), case_id: kase.id, actor_id: null, action: "HIDE", target_type: info.type, target_id: info.id, reason: "Automatic: reported by several members" },
        trx,
      );
      await notifyAuthor(info.authorId, null, kase.id, info, `Your ${labelOf(info.type)} was hidden after several reports while a moderator reviews it.`, trx, fx);
      emitQueue(fx);
    }
    return { id: report.id };
  });
}
