/** Follows. follower_count / following_count on users move in the same transaction. */
import { sql } from "kysely";
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { notBlocked } from "./visibility";

export class FollowRepository {
  /** Returns true when a new follow was created. */
  async follow(followerId: string, followeeId: string, exec: Executor): Promise<boolean> {
    const row = await exec
      .insertInto("follows")
      .values({ follower_id: followerId, followee_id: followeeId, created_at: new Date() })
      .onConflict((oc) => oc.columns(["follower_id", "followee_id"]).doNothing())
      .returning("follower_id")
      .executeTakeFirst();
    if (!row) return false;
    await this.bump(followerId, followeeId, 1, exec);
    return true;
  }

  async unfollow(followerId: string, followeeId: string, exec: Executor): Promise<boolean> {
    const r = await exec.deleteFrom("follows").where("follower_id", "=", followerId).where("followee_id", "=", followeeId).executeTakeFirst();
    if (Number(r.numDeletedRows) !== 1) return false;
    await this.bump(followerId, followeeId, -1, exec);
    return true;
  }

  private async bump(followerId: string, followeeId: string, delta: number, exec: Executor) {
    await exec.updateTable("users").set({ following_count: sql`greatest(0, following_count + ${delta})` }).where("id", "=", followerId).execute();
    await exec.updateTable("users").set({ follower_count: sql`greatest(0, follower_count + ${delta})` }).where("id", "=", followeeId).execute();
  }

  async relation(viewerId: string, otherId: string, exec: Executor = db): Promise<{ following: boolean; followedBy: boolean }> {
    const rows = await exec
      .selectFrom("follows")
      .select(["follower_id"])
      .where((eb) => eb.or([eb.and([eb("follower_id", "=", viewerId), eb("followee_id", "=", otherId)]), eb.and([eb("follower_id", "=", otherId), eb("followee_id", "=", viewerId)])]))
      .execute();
    return { following: rows.some((r) => r.follower_id === viewerId), followedBy: rows.some((r) => r.follower_id === otherId) };
  }

  /** Of `ids`, the ones the viewer follows (one query for a whole page of people). */
  async followedAmong(viewerId: string, ids: readonly string[], exec: Executor = db): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await exec.selectFrom("follows").select("followee_id").where("follower_id", "=", viewerId).where("followee_id", "in", [...ids]).execute();
    return new Set(rows.map((r) => r.followee_id));
  }

  /** People who share an ACTIVE community with the user and whom they do not follow yet. */
  suggestions(userId: string, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("users as u")
      .select(["u.id"])
      .where("u.status", "=", "ACTIVE")
      .where("u.id", "!=", userId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("community_members as a")
            .innerJoin("community_members as b", "b.community_id", "a.community_id")
            .innerJoin("communities as c", "c.id", "a.community_id")
            .select("a.id")
            .where("a.user_id", "=", userId)
            .whereRef("b.user_id", "=", "u.id")
            .where("a.status", "=", "ACTIVE")
            .where("b.status", "=", "ACTIVE")
            .where("c.status", "=", "PUBLISHED"),
        ),
      )
      .where((eb) => eb.not(eb.exists(eb.selectFrom("follows as f").select("f.followee_id").where("f.follower_id", "=", userId).whereRef("f.followee_id", "=", "u.id"))))
      .where(notBlocked(userId, "u.id"))
      .orderBy("u.reputation", "desc")
      .orderBy("u.id", "asc")
      .limit(limit)
      .execute()
      .then((rows) => rows.map((r) => r.id));
  }

  /** Followers (direction "followers") or followees ("following") of a user. */
  list(userId: string, direction: "followers" | "following", viewerId: string | null, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    const followers = direction === "followers";
    const other = followers ? "f.follower_id" : "f.followee_id";
    const self = followers ? "f.followee_id" : "f.follower_id";
    return exec
      .selectFrom("follows as f")
      .innerJoin("users as u", "u.id", other)
      .select(sql<string>`${sql.ref(other)}`.as("id"))
      .select(atKey("f.created_at"))
      .where(self, "=", userId)
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, other))
      .where(olderThan("f.created_at", other, cursor))
      .orderBy("f.created_at", "desc")
      .orderBy(other, "desc")
      .limit(limit + 1)
      .execute();
  }
}

export const followRepo = new FollowRepository();
