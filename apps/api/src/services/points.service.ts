/**
 * Reputation awards (see domain/points.ts for the amounts and the level curve). Awards
 * run inside the caller's transaction, so a rolled-back post never earns points.
 */
import type { LeaderboardEntry } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { leaderboardWindowStart, levelFor } from "../domain/points";
import { loadSummaries } from "../presenters/user.presenter";
import { pointsRepo, type Award } from "../repositories/points.repository";

export const award = (a: Award, exec: Executor) => pointsRepo.award(a, exec);
export const revoke = (a: Award, exec: Executor) => pointsRepo.revoke(a, exec);
export const revokeEntity = (entityType: "post" | "comment", entityId: string, exec: Executor) => pointsRepo.revokeEntity(entityType, entityId, exec);

export async function leaderboard(viewer: Actor | null, period: "week" | "month" | "all"): Promise<LeaderboardEntry[]> {
  const rows = await pointsRepo.leaderboard(viewer?.id ?? null, leaderboardWindowStart(period, new Date()), 20);
  const users = await loadSummaries(rows.map((r) => r.id));
  const totals = rows.length ? await db.selectFrom("users").select(["id", "reputation"]).where("id", "in", rows.map((r) => r.id)).execute() : [];
  const reputation = new Map(totals.map((r) => [r.id, r.reputation]));
  return rows
    .filter((r) => users.has(r.id))
    .map((r, i) => {
      const total = reputation.get(r.id) ?? 0;
      return { user: users.get(r.id)!, reputation: period === "all" ? total : Number(r.points), level: levelFor(total), rank: i + 1 };
    });
}
