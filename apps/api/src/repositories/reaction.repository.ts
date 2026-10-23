/**
 * Reactions on posts and comments: one per person per item, changing type replaces it.
 * The denormalised reaction_count and reaction_counts ({ "LIKE": 3 }) are updated in
 * the same statement-level transaction as the reaction row.
 */
import type { ReactionType } from "@open-social/types";
import { sql, type RawBuilder } from "kysely";
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { notBlocked } from "./visibility";

export type ReactionTarget = "post" | "comment";

const T = {
  post: { table: "post_reactions", fk: "post_id", parent: "posts" },
  comment: { table: "comment_reactions", fk: "comment_id", parent: "comments" },
} as const;

/** reaction_counts with one key decremented and/or another incremented, zero keys dropped. */
function countsExpr(from: ReactionType | null, to: ReactionType | null): RawBuilder<unknown> {
  let expr: RawBuilder<unknown> = sql`reaction_counts`;
  if (from) expr = sql`(${expr} || jsonb_build_object(${from}::text, coalesce((reaction_counts->>${from})::int, 0) - 1))`;
  if (to) expr = sql`(${expr} || jsonb_build_object(${to}::text, coalesce((reaction_counts->>${to})::int, 0) + 1))`;
  return sql`(select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(${expr}) e where (e.value)::int > 0)`;
}

export class ReactionRepository {
  async find(target: ReactionTarget, itemId: string, userId: string, exec: Executor = db): Promise<ReactionType | null> {
    const t = T[target];
    const row = await (exec as any).selectFrom(t.table).select("type").where(t.fk, "=", itemId).where("user_id", "=", userId).forUpdate().executeTakeFirst();
    return (row?.type as ReactionType | undefined) ?? null;
  }

  async set(target: ReactionTarget, itemId: string, userId: string, type: ReactionType, exec: Executor): Promise<void> {
    const t = T[target];
    await (exec as any)
      .insertInto(t.table)
      .values({ [t.fk]: itemId, user_id: userId, type, created_at: new Date() })
      .onConflict((oc: any) => oc.columns([t.fk, "user_id"]).doUpdateSet({ type }))
      .execute();
  }

  async remove(target: ReactionTarget, itemId: string, userId: string, exec: Executor): Promise<void> {
    const t = T[target];
    await (exec as any).deleteFrom(t.table).where(t.fk, "=", itemId).where("user_id", "=", userId).execute();
  }

  /** Apply a reaction change to the parent's counters; returns the new counts. */
  async applyDelta(target: ReactionTarget, itemId: string, from: ReactionType | null, to: ReactionType | null, exec: Executor) {
    const t = T[target];
    const delta = (to ? 1 : 0) - (from ? 1 : 0);
    const row = await (exec as any)
      .updateTable(t.parent)
      .set({ reaction_count: sql`greatest(0, reaction_count + ${delta})`, reaction_counts: countsExpr(from, to) })
      .where("id", "=", itemId)
      .returning(["reaction_count", "reaction_counts"])
      .executeTakeFirstOrThrow();
    return row as { reaction_count: number; reaction_counts: Record<string, number> };
  }

  list(target: ReactionTarget, itemId: string, viewerId: string | null, type: ReactionType | undefined, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const t = T[target];
    let q = (exec as any)
      .selectFrom(`${t.table} as r`)
      .innerJoin("users as u", "u.id", "r.user_id")
      .select(["r.user_id as id", "r.type"])
      .select(atKey("r.created_at"))
      .where(`r.${t.fk}`, "=", itemId)
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, "r.user_id"));
    if (type) q = q.where("r.type", "=", type);
    return q
      .where(olderThan("r.created_at", "r.user_id", cursor))
      .orderBy("r.created_at", "desc")
      .orderBy("r.user_id", "desc")
      .limit(limit + 1)
      .execute() as Promise<{ id: string; type: ReactionType; _at: string }[]>;
  }

  async viewerReactions(target: ReactionTarget, userId: string | null | undefined, itemIds: readonly string[], exec: Executor = db): Promise<Map<string, ReactionType>> {
    if (!userId || !itemIds.length) return new Map();
    const t = T[target];
    const rows = (await (exec as any).selectFrom(t.table).select([`${t.fk} as item_id`, "type"]).where("user_id", "=", userId).where(t.fk, "in", [...itemIds]).execute()) as { item_id: string; type: ReactionType }[];
    return new Map(rows.map((r) => [r.item_id, r.type]));
  }
}

export const reactionRepo = new ReactionRepository();
