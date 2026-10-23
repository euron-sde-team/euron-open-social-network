/** Append-only audit trail for security and administrative actions. */
import { db, type Executor } from "../db/kysely";
import { newId } from "../core/ids";

export function audit(
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; ip?: string | null; data?: Record<string, unknown> },
  exec: Executor = db,
) {
  return exec
    .insertInto("audit_log")
    .values({
      id: newId(),
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      ip: entry.ip ?? null,
      data: JSON.stringify(entry.data ?? {}),
    })
    .execute();
}
