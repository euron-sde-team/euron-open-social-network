/**
 * Moderation job handlers. Registered by jobs/messaging.jobs.ts.
 *
 *   moderation.scan               classify one item (throws on provider failure so the
 *                                 queue retries; the item stays UNCHECKED meanwhile)
 *   maintenance.lift-suspensions  end timed suspensions that have run out
 */
import type { ModerationTarget } from "@open-social/types";
import { sql } from "kysely";
import { db } from "../db/kysely";
import { scanTarget } from "../services/moderation/scan.service";

export async function moderationScanJob(data: { targetType: ModerationTarget; targetId: string }): Promise<void> {
  await scanTarget(data.targetType, data.targetId);
}

export async function liftSuspensionsJob(): Promise<void> {
  await db
    .updateTable("users")
    .set({ status: "ACTIVE", suspended_until: null, updated_at: new Date() })
    .where("status", "=", "SUSPENDED")
    .where("suspended_until", "<=", sql<Date>`now()`)
    .execute();
}
