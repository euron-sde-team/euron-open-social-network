/**
 * Moderator decisions: on a case (content and account actions) and directly on an
 * account (the admin console reuses `applyAccountAction`, so both paths leave the same
 * trail: moderation_actions + audit_log + notification + socket disconnect).
 *
 * Who may do what:
 *   community moderators  HIDE, REMOVE, RESTORE, APPROVE, DISMISS in their communities
 *   platform staff        all of the above anywhere, plus WARN and SUSPEND
 *   platform admins       plus BAN and UNBAN
 * Nobody acts on their own account, and admins' accounts are out of reach (demote first);
 * moderators cannot act on other moderators. Acting needs an ACTIVE account (a suspended
 * moderator has no powers), and only a platform ADMIN may act on a case about their own
 * content (403 SELF_MODERATION for everyone else), so nobody approves their own hidden post.
 */
import type { ContentStatus, ModerationActionType, ModerationCase } from "@open-social/types";
import { isAdmin, isStaff, requireActive, type Actor } from "../../core/context";
import { withTransaction, type Effects } from "../../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import type { Executor } from "../../db/kysely";
import { presentCases } from "../../presenters/moderation.presenter";
import { moderationRepo } from "../../repositories/moderation.repository";
import { sessionRepo } from "../../repositories/session.repository";
import { userRepo } from "../../repositories/user.repository";
import { audit } from "../audit.service";
import { canSeeCase, emitQueue, isCaseSubject, labelOf, notifyAuthor } from "./cases.service";
import { isContentTarget, loadTarget, setContentStatus, setModerationState } from "./targets";

export const CONTENT_ACTIONS: readonly ModerationActionType[] = ["HIDE", "REMOVE", "RESTORE", "APPROVE", "DISMISS"];
export type AccountAction = "WARN" | "SUSPEND" | "UNSUSPEND" | "BAN" | "UNBAN";

export interface AccountActionOptions {
  days?: number;
  reason?: string | null;
  caseId?: string | null;
  ip?: string | null;
}

const MAX_SUSPEND_DAYS = 3650;

/**
 * Warn, suspend, lift a suspension, ban or unban an account, inside the caller's
 * transaction. Lifting a suspension is logged as RESTORE (the action enum has no
 * UNSUSPEND) with data.kind = "UNSUSPEND".
 */
export async function applyAccountAction(actor: Actor, userId: string, kind: AccountAction, opts: AccountActionOptions, trx: Executor, fx: Effects): Promise<void> {
  if (kind === "BAN" || kind === "UNBAN" ? !isAdmin(actor) : !isStaff(actor)) throw forbidden("Only platform staff can do that", "STAFF_ONLY");
  if (userId === actor.id) throw badRequest("You cannot moderate your own account", "CANNOT_MODERATE_SELF");
  const user = await trx.selectFrom("users").select(["id", "role", "status"]).where("id", "=", userId).forUpdate().executeTakeFirst();
  if (!user) throw notFound("User not found", "USER_NOT_FOUND");
  if (user.role === "ADMIN" || (user.role === "MODERATOR" && !isAdmin(actor))) throw forbidden("That account can only be changed by an administrator after a role change", "TARGET_PROTECTED");

  let snippet: string;
  switch (kind) {
    case "WARN":
      snippet = `You received a warning from the moderators${opts.reason ? `: ${opts.reason}` : "."}`;
      break;
    case "SUSPEND": {
      const days = opts.days ?? 0;
      if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPEND_DAYS) throw badRequest("Give a suspension length in days", "SUSPEND_DAYS_REQUIRED");
      if (user.status === "BANNED") throw conflict("This account is banned", "ALREADY_BANNED");
      const until = new Date(Date.now() + days * 86400_000);
      await userRepo.update(userId, { status: "SUSPENDED", suspended_until: until }, trx);
      fx.disconnect([userId], "SUSPENDED");
      snippet = `Your account is suspended for ${days} day${days === 1 ? "" : "s"}${opts.reason ? `: ${opts.reason}` : "."}`;
      break;
    }
    case "UNSUSPEND":
      if (user.status !== "SUSPENDED") throw conflict("This account is not suspended", "NOT_SUSPENDED");
      await userRepo.update(userId, { status: "ACTIVE", suspended_until: null }, trx);
      snippet = "Your account suspension was lifted.";
      break;
    case "BAN":
      if (user.status === "BANNED") throw conflict("This account is already banned", "ALREADY_BANNED");
      await userRepo.update(userId, { status: "BANNED", suspended_until: null }, trx);
      await sessionRepo.revokeAllForUser(userId, trx);
      await userRepo.bumpTokenVersion(userId, trx);
      fx.disconnect([userId], "BANNED");
      snippet = `Your account was banned${opts.reason ? `: ${opts.reason}` : "."}`;
      break;
    case "UNBAN":
      if (user.status !== "BANNED") throw conflict("This account is not banned", "NOT_BANNED");
      await userRepo.update(userId, { status: "ACTIVE" }, trx);
      snippet = "Your account ban was lifted.";
      break;
  }

  const action: ModerationActionType = kind === "UNSUSPEND" ? "RESTORE" : kind;
  await moderationRepo.insertAction(
    { id: newId(), case_id: opts.caseId ?? null, actor_id: actor.id, action, target_type: "USER", target_id: userId, reason: opts.reason ?? null, data: JSON.stringify({ kind, ...(opts.days ? { days: opts.days } : {}) }) },
    trx,
  );
  await audit({ actorId: actor.id, action: `moderation.${kind.toLowerCase()}`, entityType: "user", entityId: userId, ip: opts.ip ?? null, data: { caseId: opts.caseId ?? null, reason: opts.reason ?? null, days: opts.days ?? null } }, trx);
  await notifyAuthor(userId, actor.id, opts.caseId ?? null, { type: "USER", communityId: null }, snippet, trx, fx);
}

export interface CaseActionInput {
  action: ModerationActionType;
  reason?: string | null;
  suspendDays?: number;
}

/**
 * What each content action turns the target into, from which statuses. Becoming
 * PUBLISHED (an approved pre-moderated post included) runs the posts module's
 * `postPublished` transition through setContentStatus, which awards the +5 authoring
 * points through the idempotent ledger: once per post, however often it is approved.
 */
const TRANSITIONS: Partial<Record<ModerationActionType, { to: ContentStatus; from: ContentStatus[] }>> = {
  APPROVE: { to: "PUBLISHED", from: ["PENDING_REVIEW", "HIDDEN", "PUBLISHED"] },
  HIDE: { to: "HIDDEN", from: ["PUBLISHED", "PENDING_REVIEW", "HIDDEN"] },
  REMOVE: { to: "REMOVED", from: ["PUBLISHED", "PENDING_REVIEW", "HIDDEN", "REMOVED"] },
  RESTORE: { to: "PUBLISHED", from: ["HIDDEN", "REMOVED", "PUBLISHED"] },
};

const OUTCOME_COPY: Partial<Record<ModerationActionType, string>> = {
  APPROVE: "is now visible",
  HIDE: "was hidden by a moderator",
  REMOVE: "was removed by a moderator",
  RESTORE: "was restored",
};

export async function actOnCase(actor: Actor, caseId: string, input: CaseActionInput, ip: string | null = null): Promise<ModerationCase> {
  requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const kase = await moderationRepo.lockCase(caseId, trx);
    if (!kase || !(await canSeeCase(actor, kase, trx))) throw notFound("Case not found", "CASE_NOT_FOUND");
    if (isCaseSubject(actor, kase) && !isAdmin(actor)) throw forbidden("You cannot moderate a case about your own content or account", "SELF_MODERATION");
    if (!isStaff(actor) && !CONTENT_ACTIONS.includes(input.action)) throw forbidden("Only platform staff can act on accounts", "STAFF_ONLY");
    if (kase.status !== "OPEN") throw conflict("This case is already resolved", "CASE_RESOLVED");

    const accountKinds: Partial<Record<ModerationActionType, AccountAction>> = { WARN: "WARN", SUSPEND: "SUSPEND", BAN: "BAN", UNBAN: "UNBAN" };
    const accountKind = accountKinds[input.action];
    if (accountKind) {
      if (!kase.author_id) throw badRequest("This case has no author to act on", "NO_AUTHOR");
      await applyAccountAction(actor, kase.author_id, accountKind, { days: input.suspendDays, reason: input.reason, caseId: kase.id, ip }, trx, fx);
    } else if (input.action !== "DISMISS") {
      const info = await loadTarget(kase.target_type, kase.target_id, trx);
      if (!info) throw notFound("The content no longer exists", "TARGET_NOT_FOUND");
      if (kase.target_type === "USER" || (kase.target_type === "COMMUNITY" && !isStaff(actor))) throw badRequest("Use an account action for this case", "INVALID_ACTION");
      const t = TRANSITIONS[input.action];
      if (!t) throw badRequest("Unknown action", "INVALID_ACTION");
      if (!t.from.includes(info.status as ContentStatus)) throw conflict(`The ${labelOf(info.type)} cannot be changed from ${info.status}`, "INVALID_TRANSITION");
      await setContentStatus(info, t.to, trx, fx);
      if (input.action === "APPROVE" || input.action === "RESTORE") await setModerationState(info, "CLEAN", trx);
      await moderationRepo.insertAction(
        { id: newId(), case_id: kase.id, actor_id: actor.id, action: input.action, target_type: kase.target_type, target_id: kase.target_id, reason: input.reason ?? null },
        trx,
      );
      await audit({ actorId: actor.id, action: `moderation.${input.action.toLowerCase()}`, entityType: kase.target_type.toLowerCase(), entityId: kase.target_id, ip, data: { caseId: kase.id, reason: input.reason ?? null } }, trx);
      if (isContentTarget(info.type) && info.authorId !== actor.id) {
        await notifyAuthor(kase.author_id, actor.id, kase.id, info, `Your ${labelOf(info.type)} ${OUTCOME_COPY[input.action]}${input.reason ? `: ${input.reason}` : "."}`, trx, fx);
      }
    } else {
      await moderationRepo.insertAction(
        { id: newId(), case_id: kase.id, actor_id: actor.id, action: "DISMISS", target_type: kase.target_type, target_id: kase.target_id, reason: input.reason ?? null },
        trx,
      );
      await audit({ actorId: actor.id, action: "moderation.dismiss", entityType: kase.target_type.toLowerCase(), entityId: kase.target_id, ip, data: { caseId: kase.id } }, trx);
    }

    const resolved = await moderationRepo.updateCase(kase.id, { status: "RESOLVED", resolution: input.action, resolved_by: actor.id, resolved_at: new Date() }, trx);
    emitQueue(fx);
    return resolved;
  });
  return (await presentCases([row]))[0] as ModerationCase;
}
