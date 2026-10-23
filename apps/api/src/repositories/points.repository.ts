/**
 * The reputation ledger. The unique key (user, reason, entity, actor) makes "award once"
 * a plain insert and "revoke" a delete of exactly that row; users.reputation and level
 * move only when the ledger row actually changed.
 */
import { sql } from "kysely";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { REASON_AMOUNT, type PointsReason } from "../domain/points";
import { notBlocked } from "./visibility";

export interface Award {
  userId: string;
  reason: PointsReason;
  entityType: string;
  entityId: string;
  /** Who caused it; the author themself for authoring awards. Never null (NULLs would defeat the unique key). */
  actorId: string;
}

/** domain/points.ts `levelFor` in SQL: floor(sqrt(points / 10)) + 1, never below level 1. */
export const levelSql = (rep: unknown) => sql<number>`floor(sqrt(greatest(0, ${rep})::float8 / 10))::int + 1`;

export class PointsRepository {
  async award(a: Award, exec: Executor): Promise<boolean> {
    const amount = REASON_AMOUNT[a.reason];
    const row = await exec
      .insertInto("points_ledger")
      .values({ id: newId(), user_id: a.userId, amount, reason: a.reason, entity_type: a.entityType, entity_id: a.entityId, actor_id: a.actorId })
      .onConflict((oc) => oc.columns(["user_id", "reason", "entity_type", "entity_id", "actor_id"]).doNothing())
      .returning("amount")
      .executeTakeFirst();
    if (!row) return false;
    await this.bump(a.userId, row.amount, exec);
    return true;
  }

  async revoke(a: Award, exec: Executor): Promise<boolean> {
    const row = await exec
      .deleteFrom("points_ledger")
      .where("user_id", "=", a.userId)
      .where("reason", "=", a.reason)
      .where("entity_type", "=", a.entityType)
      .where("entity_id", "=", a.entityId)
      .where("actor_id", "=", a.actorId)
      .returning("amount")
      .executeTakeFirst();
    if (!row) return false;
    await this.bump(a.userId, -row.amount, exec);
    return true;
  }

  /** Revoke every award tied to an entity (a deleted post loses its reaction points too). */
  async revokeEntity(entityType: string, entityId: string, exec: Executor): Promise<void> {
    const rows = await exec.deleteFrom("points_ledger").where("entity_type", "=", entityType).where("entity_id", "=", entityId).returning(["user_id", "amount"]).execute();
    const byUser = new Map<string, number>();
    for (const r of rows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + r.amount);
    for (const [userId, amount] of byUser) await this.bump(userId, -amount, exec);
  }

  private async bump(userId: string, delta: number, exec: Executor) {
    await exec
      .updateTable("users")
      .set({ reputation: sql`greatest(0, reputation + ${delta})`, level: levelSql(sql`reputation + ${delta}`) })
      .where("id", "=", userId)
      .execute();
  }

  /** Top earners since a date (week, month), or by total reputation when `since` is null. */
  leaderboard(viewerId: string | null, since: Date | null, limit: number, exec: Executor = db) {
    if (!since) {
      return exec
        .selectFrom("users as u")
        .select(["u.id", "u.reputation as points"])
        .where("u.status", "=", "ACTIVE")
        .where("u.reputation", ">", 0)
        .where(notBlocked(viewerId, "u.id"))
        .orderBy("u.reputation", "desc")
        .orderBy("u.id", "asc")
        .limit(limit)
        .execute();
    }
    return exec
      .selectFrom("points_ledger as l")
      .innerJoin("users as u", "u.id", "l.user_id")
      .select(["u.id"])
      .select((eb) => eb.fn.sum<number>("l.amount").as("points"))
      .where("l.created_at", ">=", since)
      .where("u.status", "=", "ACTIVE")
      .where(notBlocked(viewerId, "u.id"))
      .groupBy("u.id")
      .having((eb) => eb.fn.sum("l.amount"), ">", 0)
      .orderBy("points", "desc")
      .orderBy("u.id", "asc")
      .limit(limit)
      .execute();
  }
}

export const pointsRepo = new PointsRepository();
