/** Blocks. A block also removes follows in both directions (with their counters). */
import { db, type Executor } from "../db/kysely";
import { followRepo } from "./follow.repository";

export class BlockRepository {
  async block(blockerId: string, blockedId: string, exec: Executor): Promise<void> {
    await exec
      .insertInto("blocks")
      .values({ blocker_id: blockerId, blocked_id: blockedId, created_at: new Date() })
      .onConflict((oc) => oc.columns(["blocker_id", "blocked_id"]).doNothing())
      .execute();
    await followRepo.unfollow(blockerId, blockedId, exec);
    await followRepo.unfollow(blockedId, blockerId, exec);
  }

  unblock(blockerId: string, blockedId: string, exec: Executor = db) {
    return exec.deleteFrom("blocks").where("blocker_id", "=", blockerId).where("blocked_id", "=", blockedId).execute();
  }

  /** People the user has blocked (not people who blocked them: that stays private). */
  blockedBy(userId: string, exec: Executor = db) {
    return exec
      .selectFrom("blocks")
      .select("blocked_id")
      .where("blocker_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(500)
      .execute()
      .then((rows) => rows.map((r) => r.blocked_id));
  }
}

export const blockRepo = new BlockRepository();
