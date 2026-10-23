/**
 * Communities and their invite links. Counters (member_count, post_count) are adjusted
 * here in the caller's transaction; the reconcile job corrects any drift.
 */
import type { Insertable, Selectable, Updateable } from "kysely";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Communities, CommunityInvites } from "../db/types";
import { likeContains } from "../domain/tags";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { tsMatches } from "./text-search";

export type CommunityRow = Selectable<Communities>;
export type InviteRow = Selectable<CommunityInvites>;

export class CommunityRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("communities").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdForUpdate(id: string, exec: Executor) {
    return exec.selectFrom("communities").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  findBySlug(slug: string, exec: Executor = db) {
    return exec.selectFrom("communities").selectAll().where("slug", "=", slug).executeTakeFirst();
  }

  findMany(ids: readonly string[], exec: Executor = db): Promise<CommunityRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("communities").selectAll().where("id", "in", [...new Set(ids)]).execute();
  }

  async slugTaken(slug: string, exec: Executor = db): Promise<boolean> {
    return !!(await exec.selectFrom("communities").select("id").where("slug", "=", slug).executeTakeFirst());
  }

  async countLiveCreatedBy(userId: string, exec: Executor = db): Promise<number> {
    const r = await exec
      .selectFrom("communities")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("created_by", "=", userId)
      .where("status", "=", "PUBLISHED")
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  insert(row: Insertable<Communities>, exec: Executor = db) {
    return exec.insertInto("communities").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<Communities>, exec: Executor = db) {
    return exec
      .updateTable("communities")
      .set({ ...patch, updated_at: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }

  adjust(id: string, delta: { members?: number; posts?: number }, exec: Executor = db) {
    const members = delta.members ?? 0;
    const posts = delta.posts ?? 0;
    if (!members && !posts) return Promise.resolve();
    return exec
      .updateTable("communities")
      .set({
        member_count: sql`greatest(0, member_count + ${members})`,
        post_count: sql`greatest(0, post_count + ${posts})`,
      })
      .where("id", "=", id)
      .execute()
      .then(() => undefined);
  }

  /**
   * Directory listing. Lists show public communities plus the private ones the viewer
   * belongs to (staff see all); a private community is otherwise reached by its slug or
   * an invite link and shown as a limited card.
   */
  list(viewer: Actor | null, opts: { filter: "all" | "joined" | "managed"; q?: string; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("communities as c").selectAll("c").select(atKey("c.created_at")).where("c.status", "=", "PUBLISHED");
    if (opts.filter === "all") {
      if (!isStaff(viewer)) {
        q = q.where((eb) =>
          eb.or([
            eb("c.visibility", "=", "PUBLIC"),
            ...(viewer
              ? [
                  eb.exists(
                    eb.selectFrom("community_members as m").select("m.id").whereRef("m.community_id", "=", "c.id").where("m.user_id", "=", viewer.id).where("m.status", "=", "ACTIVE"),
                  ),
                ]
              : []),
          ]),
        );
      }
    } else {
      const roles = opts.filter === "managed" ? (["OWNER", "ADMIN", "MODERATOR"] as const) : (["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const);
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom("community_members as m")
            .select("m.id")
            .whereRef("m.community_id", "=", "c.id")
            .where("m.user_id", "=", viewer?.id ?? "")
            .where("m.status", "=", "ACTIVE")
            .where("m.role", "in", [...roles]),
        ),
      );
    }
    if (opts.q) {
      const text = opts.q;
      q = q.where((eb) => eb.or([eb("c.name", "ilike", likeContains(text)), tsMatches("c.search", text)]));
    }
    return q
      .where(olderThan("c.created_at", "c.id", opts.cursor))
      .orderBy("c.created_at", "desc")
      .orderBy("c.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  /** Popular public communities the user has not joined. */
  suggested(userId: string, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("communities as c")
      .selectAll("c")
      .where("c.status", "=", "PUBLISHED")
      .where("c.visibility", "=", "PUBLIC")
      .where((eb) =>
        eb.not(eb.exists(eb.selectFrom("community_members as m").select("m.id").whereRef("m.community_id", "=", "c.id").where("m.user_id", "=", userId).where("m.status", "in", ["ACTIVE", "PENDING", "BANNED", "SUSPENDED"]))),
      )
      .orderBy("c.member_count", "desc")
      .orderBy("c.id", "desc")
      .limit(limit)
      .execute();
  }

  /** Communities a user is an ACTIVE member of that the viewer may see: public ones, plus private ones they share. */
  memberOf(userId: string, viewer: Actor | null, exec: Executor = db) {
    return exec
      .selectFrom("communities as c")
      .innerJoin("community_members as m", "m.community_id", "c.id")
      .selectAll("c")
      .where("m.user_id", "=", userId)
      .where("m.status", "=", "ACTIVE")
      .where("c.status", "=", "PUBLISHED")
      .where((eb) =>
        isStaff(viewer)
          ? sql<boolean>`true`
          : eb.or([
              eb("c.visibility", "=", "PUBLIC"),
              ...(viewer
                ? [eb.exists(eb.selectFrom("community_members as vm").select("vm.id").whereRef("vm.community_id", "=", "c.id").where("vm.user_id", "=", viewer.id).where("vm.status", "=", "ACTIVE"))]
                : []),
            ]),
      )
      .orderBy("c.member_count", "desc")
      .orderBy("c.id", "asc")
      .limit(100)
      .execute();
  }

  // ─── Invites ──────────────────────────────────────────────────────────────

  insertInvite(row: Insertable<CommunityInvites>, exec: Executor = db) {
    return exec.insertInto("community_invites").values(row).returningAll().executeTakeFirstOrThrow();
  }

  listInvites(communityId: string, exec: Executor = db) {
    return exec
      .selectFrom("community_invites")
      .selectAll()
      .where("community_id", "=", communityId)
      .where("revoked_at", "is", null)
      .orderBy("created_at", "desc")
      .limit(100)
      .execute();
  }

  findInviteByCode(code: string, exec: Executor = db) {
    return exec.selectFrom("community_invites").selectAll().where("code", "=", code).executeTakeFirst();
  }

  findInviteByCodeForUpdate(code: string, exec: Executor) {
    return exec.selectFrom("community_invites").selectAll().where("code", "=", code).forUpdate().executeTakeFirst();
  }

  useInvite(id: string, exec: Executor) {
    return exec.updateTable("community_invites").set((eb) => ({ uses: eb("uses", "+", 1) })).where("id", "=", id).execute();
  }

  revokeInvite(communityId: string, inviteId: string, exec: Executor = db) {
    return exec
      .updateTable("community_invites")
      .set({ revoked_at: new Date() })
      .where("id", "=", inviteId)
      .where("community_id", "=", communityId)
      .where("revoked_at", "is", null)
      .executeTakeFirst()
      .then((r) => Number(r.numUpdatedRows) === 1);
  }
}

export const communityRepo = new CommunityRepository();
