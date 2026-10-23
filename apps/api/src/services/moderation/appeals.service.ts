/**
 * Appeals: one per case, by the person the case is about. Appealable are:
 *   - a RESOLVED case whose resolution was HIDE, REMOVE, SUSPEND or BAN, within 30 days;
 *   - an OPEN case whose target was hidden automatically (by the scan pipeline or the
 *     report threshold: a HIDE action with no actor) and is still HIDDEN. The author's
 *     notification says "you can appeal", so they can, without waiting for a moderator.
 * A different staff member decides; an admin may decide their own case only with a
 * written note (the override is on the record). Deciding needs an ACTIVE account, and
 * nobody but a platform ADMIN decides an appeal about their own content.
 *
 * OVERTURNED undoes the decision: content back to PUBLISHED; an account back to ACTIVE
 * only while it is still in the state this case put it in (SUSPENDED for SUSPEND, BANNED
 * for BAN) and no later moderation action on the account exists. Otherwise the overturn
 * is recorded (appeal row, audit) and the later decision stands. UPHELD leaves it. An
 * appeal on an OPEN case also resolves the case (RESTORE when overturned, HIDE when
 * upheld). Either way the appellant is notified.
 *
 * Appealing needs a signed-in account but not an ACTIVE one: suspended users can
 * appeal. Banned accounts cannot sign in, so they appeal outside the product.
 */
import type { Appeal, AppealStatus, ModerationActionType, Page } from "@open-social/types";
import { isAdmin, requireActor, requireActive, requireStaff, type Actor } from "../../core/context";
import { decodeCursor, toPage } from "../../core/cursor";
import { withTransaction } from "../../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import type { Executor } from "../../db/kysely";
import { presentAppeals } from "../../presenters/moderation.presenter";
import { moderationRepo, type CaseRow } from "../../repositories/moderation.repository";
import { userRepo } from "../../repositories/user.repository";
import { audit } from "../audit.service";
import { emitQueue, isCaseSubject, labelOf, notifyAuthor } from "./cases.service";
import { loadTarget, setContentStatus, setModerationState } from "./targets";

const APPEALABLE: readonly ModerationActionType[] = ["HIDE", "REMOVE", "SUSPEND", "BAN"];
const APPEAL_WINDOW_DAYS = 30;

/** An OPEN case whose target the pipeline (not a person) hid, and which is still hidden. */
async function autoHiddenOpenCase(kase: CaseRow, exec: Executor): Promise<boolean> {
  if (kase.status !== "OPEN") return false;
  const target = await loadTarget(kase.target_type, kase.target_id, exec);
  if (!target || target.status !== "HIDDEN") return false;
  const hide = await exec.selectFrom("moderation_actions").select("id").where("case_id", "=", kase.id).where("action", "=", "HIDE").where("actor_id", "is", null).executeTakeFirst();
  return !!hide;
}

export async function createAppeal(actor: Actor, caseId: string, statement: string): Promise<Appeal> {
  requireActor(actor);
  const row = await withTransaction(async (trx) => {
    const kase = await moderationRepo.lockCase(caseId, trx);
    if (!kase || kase.author_id !== actor.id) throw notFound("Case not found", "CASE_NOT_FOUND");
    if (kase.status === "OPEN") {
      if (!(await autoHiddenOpenCase(kase, trx))) throw badRequest("Only a hidden or removed item, or a suspension or ban, can be appealed", "NOT_APPEALABLE");
    } else {
      if (!kase.resolution || !APPEALABLE.includes(kase.resolution)) throw badRequest("Only a hidden or removed item, or a suspension or ban, can be appealed", "NOT_APPEALABLE");
      if (kase.resolved_at && Date.now() - kase.resolved_at.getTime() > APPEAL_WINDOW_DAYS * 86400_000) throw badRequest("The appeal window has closed", "APPEAL_WINDOW_CLOSED");
    }
    const appeal = await moderationRepo.insertAppeal({ id: newId(), case_id: kase.id, appellant_id: actor.id, statement }, trx);
    if (!appeal) throw conflict("You already appealed this decision", "ALREADY_APPEALED");
    await audit({ actorId: actor.id, action: "moderation.appeal", entityType: "moderation_case", entityId: kase.id }, trx);
    return appeal;
  });
  return (await presentAppeals([row]))[0] as Appeal;
}

/**
 * Whether overturning this case's SUSPEND or BAN may set the account ACTIVE: the account
 * is still in the state the case set, and no moderation action on it came later.
 */
async function canRestoreAccount(kase: CaseRow, userId: string, exec: Executor): Promise<boolean> {
  const user = await exec.selectFrom("users").select("status").where("id", "=", userId).forUpdate().executeTakeFirst();
  if (!user || user.status !== (kase.resolution === "BAN" ? "BANNED" : "SUSPENDED")) return false;
  const own = await exec
    .selectFrom("moderation_actions")
    .select(["id", "created_at"])
    .where("case_id", "=", kase.id)
    .where("target_type", "=", "USER")
    .where("target_id", "=", userId)
    .where("action", "=", kase.resolution!)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .executeTakeFirst();
  if (!own) return false;
  const later = await exec
    .selectFrom("moderation_actions")
    .select("id")
    .where("target_type", "=", "USER")
    .where("target_id", "=", userId)
    .where("id", "<>", own.id)
    .where((eb) => eb.or([eb("created_at", ">", own.created_at), eb.and([eb("created_at", "=", own.created_at), eb("id", ">", own.id)])]))
    .executeTakeFirst();
  return !later;
}

export async function listAppeals(actor: Actor, status: AppealStatus | undefined, cursor: string | undefined, limit: number): Promise<Page<Appeal>> {
  requireStaff(actor);
  const rows = await moderationRepo.listAppeals(status, decodeCursor(cursor), limit);
  const page = toPage(rows, limit, (r) => ({ at: r.created_at, id: r.id }));
  return { items: await presentAppeals(page.items), nextCursor: page.nextCursor };
}

export async function decideAppeal(actor: Actor, appealId: string, status: "UPHELD" | "OVERTURNED", note: string | null): Promise<Appeal> {
  requireStaff(actor);
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const appeal = await moderationRepo.lockAppeal(appealId, trx);
    if (!appeal) throw notFound("Appeal not found", "APPEAL_NOT_FOUND");
    if (appeal.status !== "PENDING") throw conflict("This appeal was already decided", "APPEAL_DECIDED");
    const kase = await moderationRepo.lockCase(appeal.case_id, trx);
    if (!kase) throw notFound("Case not found", "CASE_NOT_FOUND");
    if ((isCaseSubject(actor, kase) || appeal.appellant_id === actor.id) && !isAdmin(actor)) throw forbidden("You cannot decide an appeal about your own content or account", "SELF_MODERATION");
    // A second pair of eyes: the moderator who made the call does not judge the appeal.
    if (kase.resolved_by === actor.id && !(isAdmin(actor) && note?.trim())) throw forbidden("Another moderator must decide this appeal", "APPEAL_CONFLICT");

    const info = (await loadTarget(kase.target_type, kase.target_id, trx)) ?? { type: kase.target_type, communityId: kase.community_id };
    let accountRestored: boolean | null = null;
    if (status === "OVERTURNED") {
      if (kase.resolution === "SUSPEND" || kase.resolution === "BAN") {
        if (!kase.author_id) throw badRequest("This case has no account to restore", "NO_AUTHOR");
        accountRestored = await canRestoreAccount(kase, kase.author_id, trx);
        if (accountRestored) {
          await userRepo.update(kase.author_id, { status: "ACTIVE", suspended_until: null }, trx);
          await moderationRepo.insertAction(
            { id: newId(), case_id: kase.id, actor_id: actor.id, action: kase.resolution === "BAN" ? "UNBAN" : "RESTORE", target_type: "USER", target_id: kase.author_id, reason: "Appeal overturned", data: JSON.stringify({ appealId }) },
            trx,
          );
        }
      } else {
        const target = await loadTarget(kase.target_type, kase.target_id, trx);
        if (target && (target.status === "HIDDEN" || target.status === "REMOVED")) {
          await setContentStatus(target, "PUBLISHED", trx, fx);
          await setModerationState(target, "CLEAN", trx);
        }
        await moderationRepo.insertAction(
          { id: newId(), case_id: kase.id, actor_id: actor.id, action: "RESTORE", target_type: kase.target_type, target_id: kase.target_id, reason: "Appeal overturned", data: JSON.stringify({ appealId }) },
          trx,
        );
      }
    }
    // An appeal on an auto-hidden, still OPEN case settles the case as well.
    if (kase.status === "OPEN") {
      await moderationRepo.updateCase(kase.id, { status: "RESOLVED", resolution: status === "OVERTURNED" ? "RESTORE" : "HIDE", resolved_by: actor.id, resolved_at: new Date() }, trx);
      emitQueue(fx);
    }
    const decided = await moderationRepo.updateAppeal(appeal.id, { status, decided_by: actor.id, decision_note: note, decided_at: new Date() }, trx);
    await audit(
      { actorId: actor.id, action: `moderation.appeal_${status.toLowerCase()}`, entityType: "appeal", entityId: appeal.id, data: { caseId: kase.id, note, selfDecided: kase.resolved_by === actor.id, ...(accountRestored === null ? {} : { accountRestored }) } },
      trx,
    );
    const what = kase.target_type === "USER" || kase.resolution === "SUSPEND" || kase.resolution === "BAN" ? "account decision" : labelOf(kase.target_type);
    const overturned =
      accountRestored === false ? `Your appeal was accepted, but a later decision about your account still applies.` : `Your appeal was accepted: the ${what} was reversed.`;
    await notifyAuthor(
      appeal.appellant_id,
      actor.id,
      kase.id,
      info,
      status === "OVERTURNED" ? overturned : `Your appeal about a ${what} was reviewed and the decision stands.`,
      trx,
      fx,
      "APPEAL_DECIDED",
    );
    return decided;
  });
  return (await presentAppeals([row]))[0] as Appeal;
}
