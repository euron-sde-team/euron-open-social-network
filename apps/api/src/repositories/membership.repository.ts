/**
 * Community memberships: one row per (community, user) for the whole history of that
 * relationship. Leaving sets LEFT; a ban or suspension stays on the row, which is how a
 * rejoin is refused.
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { CommunityMembers, CommunityRole, MembershipStatus } from "../db/types";
import { atKey, newerThan, type TimeKey } from "./keyset";
import { userNameLike } from "./text-search";
import { notBlocked } from "./visibility";

export type MembershipRow = Selectable<CommunityMembers>;

export class MembershipRepository {
  find(communityId: string, userId: string, exec: Executor = db) {
    return exec.selectFrom("community_members").selectAll().where("community_id", "=", communityId).where("user_id", "=", userId).executeTakeFirst();
  }

  findForUpdate(communityId: string, userId: string, exec: Executor) {
    return exec.selectFrom("community_members").selectAll().where("community_id", "=", communityId).where("user_id", "=", userId).forUpdate().executeTakeFirst();
  }

  /** The viewer's memberships in a set of communities (presenters). */
  forUser(userId: string | null | undefined, communityIds: readonly string[], exec: Executor = db): Promise<MembershipRow[]> {
    if (!userId || !communityIds.length) return Promise.resolve([]);
    return exec.selectFrom("community_members").selectAll().where("user_id", "=", userId).where("community_id", "in", [...new Set(communityIds)]).execute();
  }

  insert(row: Insertable<CommunityMembers>, exec: Executor = db) {
    return exec.insertInto("community_members").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<CommunityMembers>, exec: Executor = db) {
    return exec
      .updateTable("community_members")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** ACTIVE owners, admins and moderators: who hears about join requests. */
  moderatorIds(communityId: string, exec: Executor = db) {
    return exec
      .selectFrom("community_members")
      .select("user_id")
      .where("community_id", "=", communityId)
      .where("status", "=", "ACTIVE")
      .where("role", "in", ["OWNER", "ADMIN", "MODERATOR"])
      .execute()
      .then((rows) => rows.map((r) => r.user_id));
  }

  list(
    communityId: string,
    viewerId: string | null,
    opts: { status: MembershipStatus; role?: CommunityRole; q?: string; cursor: TimeKey | null; limit: number },
    exec: Executor = db,
  ) {
    let q = exec
      .selectFrom("community_members as m")
      .innerJoin("users as u", "u.id", "m.user_id")
      .selectAll("m")
      .select(atKey("m.created_at"))
      .where("m.community_id", "=", communityId)
      .where("m.status", "=", opts.status)
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where(notBlocked(viewerId, "m.user_id"));
    if (opts.role) q = q.where("m.role", "=", opts.role);
    if (opts.q) q = q.where(userNameLike("u", opts.q));
    return q
      .where(newerThan("m.created_at", "m.id", opts.cursor))
      .orderBy("m.created_at", "asc")
      .orderBy("m.id", "asc")
      .limit(opts.limit + 1)
      .execute();
  }
}

export const membershipRepo = new MembershipRepository();
