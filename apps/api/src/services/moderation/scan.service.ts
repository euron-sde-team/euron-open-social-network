/**
 * The automated pass over new and edited content ("moderation.scan" job).
 *
 *   load target -> provider scores -> decideModeration() -> persist
 *
 *   CLEAN   moderation_state CLEAN. Premoderated content (PENDING_REVIEW) still needs
 *           a human: a PREMODERATION case is ensured.
 *   REVIEW  the item stays as it is; an AI case enters the queue.
 *   HIDE    the item is hidden at once, a case opens, the action is logged with no
 *           actor, the author is told and may appeal, live viewers drop it.
 *
 * The provider call happens outside the transaction. If it fails (after its own
 * retries) the item keeps moderation_state UNCHECKED and the error propagates so the
 * job queue retries. With moderation switched off nothing is touched.
 *
 * Profiles (target USER: display name, headline, bio, location, website, avatar) are
 * scanned on every profile edit, but a profile is never hidden automatically: REVIEW
 * and HIDE verdicts both only open an AI case for a moderator.
 *
 * Provider: settings.moderation.provider (admin-editable). "openai" without a real
 * OPENAI_API_KEY (unset or the placeholder "set-me") would fail every scan, so the
 * rules provider is used instead and a warning is logged once per process.
 */
import type { ModerationTarget } from "@open-social/types";
import { config, hasOpenAiKey } from "../../core/config";
import { withTransaction } from "../../core/effects";
import { newId } from "../../core/ids";
import { logger } from "../../core/logger";
import { db } from "../../db/kysely";
import { decideModeration, type Verdict } from "../../domain/moderation-decision";
import { storage } from "../../integrations/storage";
import { moderationRepo } from "../../repositories/moderation.repository";
import { getSettings } from "../settings.service";
import { emitQueue, labelOf, notifyAuthor, openCaseFor } from "./cases.service";
import { providerFor, type ProviderName } from "./providers";
import { isContentTarget, loadTarget, recentDuplicates, setContentStatus, setModerationState } from "./targets";

export type ScanResult = { outcome: "SKIPPED" | Verdict["outcome"]; caseId?: string };

async function imageUrls(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db.selectFrom("media_uploads").select(["storage_key", "thumb_key", "status"]).where("id", "in", ids).where("kind", "=", "IMAGE").where("status", "in", ["COMPLETE", "READY"]).execute();
  const store = storage();
  return Promise.all(rows.map((r) => store.signedGetUrl(r.thumb_key ?? r.storage_key)));
}

let warnedNoKey = false;

/** The provider to use for a settings value: "openai" needs a real key, else rules. */
export function effectiveProvider(name: ProviderName): ProviderName {
  if (name !== "openai" || hasOpenAiKey(config)) return name;
  if (!warnedNoKey) {
    warnedNoKey = true;
    logger.warn("settings.moderation.provider is openai but OPENAI_API_KEY is not set (or is the placeholder set-me); scanning with the rules provider");
  }
  return "rules";
}

const SKIP_STATUSES = new Set(["DELETED", "REMOVED", "DEACTIVATED"]);

export async function scanTarget(targetType: ModerationTarget, targetId: string): Promise<ScanResult> {
  const settings = (await getSettings()).moderation;
  if (!settings.enabled || !(isContentTarget(targetType) || targetType === "USER")) return { outcome: "SKIPPED" };
  const info = await loadTarget(targetType, targetId);
  if (!info || SKIP_STATUSES.has(info.status)) return { outcome: "SKIPPED" };

  const provider = providerFor(effectiveProvider(settings.provider));
  const result = await provider.moderate({
    text: info.text,
    imageUrls: await imageUrls(info.imageIds),
    recentDuplicates: await recentDuplicates(info),
    blockedTerms: settings.blockedTerms,
  });

  const author = info.authorId ? await db.selectFrom("users").select(["role", "reputation", "created_at"]).where("id", "=", info.authorId).executeTakeFirst() : undefined;
  const open = await db.selectFrom("moderation_cases").select("report_count").where("target_type", "=", targetType).where("target_id", "=", targetId).where("status", "=", "OPEN").executeTakeFirst();
  const verdict = decideModeration(result.scores, settings.thresholds, {
    reportCount: open?.report_count ?? 0,
    authorReputation: author?.reputation ?? 0,
    authorAccountAgeDays: author ? (Date.now() - author.created_at.getTime()) / 86400_000 : 0,
    authorIsStaff: author?.role === "ADMIN" || author?.role === "MODERATOR",
  });

  return withTransaction(async (trx, fx) => {
    // Reload under the transaction: the author may have deleted or edited it meanwhile.
    const current = await loadTarget(targetType, targetId, trx);
    if (!current || SKIP_STATUSES.has(current.status)) return { outcome: "SKIPPED" as const };
    await setModerationState(current, verdict.outcome === "CLEAN" ? "CLEAN" : verdict.outcome === "REVIEW" ? "REVIEW" : "FLAGGED", trx);

    if (verdict.outcome === "CLEAN") {
      if (current.status !== "PENDING_REVIEW") return { outcome: "CLEAN" as const };
      const { row } = await openCaseFor(current, "PREMODERATION", {}, trx, fx);
      return { outcome: "CLEAN" as const, caseId: row.id };
    }

    const ai = { priority: verdict.priority, aiProvider: provider.name, aiScores: result.scores, aiCategories: verdict.categories };
    const { row } = await openCaseFor(current, "AI", ai, trx, fx);
    // A profile is never taken down by the classifier: a moderator decides.
    if (verdict.outcome === "REVIEW" || targetType === "USER") return { outcome: "REVIEW" as const, caseId: row.id };

    if (current.status === "PUBLISHED") {
      await setContentStatus(current, "HIDDEN", trx, fx);
      const reason = `Automatic: ${verdict.categories.join(", ")}`;
      await moderationRepo.insertAction({ id: newId(), case_id: row.id, actor_id: null, action: "HIDE", target_type: targetType, target_id: targetId, reason, data: JSON.stringify({ scores: result.scores }) }, trx);
      await notifyAuthor(current.authorId, null, row.id, current, `Your ${labelOf(targetType)} was hidden automatically (${verdict.categories.join(", ")}). You can appeal.`, trx, fx);
      emitQueue(fx);
    }
    return { outcome: "HIDE" as const, caseId: row.id };
  });
}
