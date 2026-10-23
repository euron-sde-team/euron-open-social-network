/**
 * Moderator removals through the ordinary delete endpoints (a moderator deleting someone
 * else's post, comment, question, answer or chat message). They bypass the case queue,
 * so they write the same trail a case action does: a moderation_actions row (REMOVE,
 * no case) so the target's moderation history shows it, and an audit_log entry.
 *
 * Kept free of other service imports so every content module can use it without cycles.
 */
import type { ModerationTarget } from "@open-social/types";
import { newId } from "../../core/ids";
import type { Executor } from "../../db/kysely";
import { moderationRepo } from "../../repositories/moderation.repository";
import { audit } from "../audit.service";

export async function recordModeratorRemoval(
  actorId: string,
  target: { type: ModerationTarget; id: string; communityId: string | null; reason: string; auditAction: string; data?: Record<string, unknown> },
  exec: Executor,
): Promise<void> {
  const data = { communityId: target.communityId, via: "delete-endpoint", ...(target.data ?? {}) };
  await moderationRepo.insertAction({ id: newId(), case_id: null, actor_id: actorId, action: "REMOVE", target_type: target.type, target_id: target.id, reason: target.reason, data: JSON.stringify(data) }, exec);
  await audit({ actorId, action: target.auditAction, entityType: target.type.toLowerCase(), entityId: target.id, data }, exec);
}
