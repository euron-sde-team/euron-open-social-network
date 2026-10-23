/**
 * The two visibility rules every read must apply, as reusable Kysely expressions, so
 * no query can forget them:
 *
 *   1. Blocks hide both ways: content by someone you blocked, or who blocked you, is
 *      invisible to you (feed, comments, search, profiles, members, mentions).
 *   2. Private communities: their content is readable only by ACTIVE members (and
 *      platform staff, for moderation).
 *
 *   exec.selectFrom("posts")
 *     .where(notBlocked(viewerId, "posts.author_id"))
 *     .where(canReadCommunity(viewer, "posts.community_id"))
 */
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { DB } from "../db/types";

type AnyEB = ExpressionBuilder<DB, any>;

/** True unless a block exists between the viewer and the user in `userColumn`. Public viewers see everything. */
export function notBlocked(viewerId: string | null | undefined, userColumn: string) {
  return (eb: AnyEB): Expression<SqlBool> => {
    if (!viewerId) return sql<boolean>`true`;
    const other = sql<string>`${sql.ref(userColumn)}`;
    return eb.not(
      eb.exists(
        eb
          .selectFrom("blocks")
          .select(sql`1`.as("x"))
          .where((w) =>
            w.or([
              w.and([w("blocks.blocker_id", "=", viewerId), w("blocks.blocked_id", "=", other)]),
              w.and([w("blocks.blocked_id", "=", viewerId), w("blocks.blocker_id", "=", other)]),
            ]),
          ),
      ),
    );
  };
}

/**
 * The viewer may read content of the community in `communityColumn`: it is public and
 * published, or the viewer is an ACTIVE member, or the viewer is platform staff.
 */
export function canReadCommunity(viewer: Actor | null | undefined, communityColumn: string) {
  return (eb: AnyEB): Expression<SqlBool> => {
    const cid = sql<string>`${sql.ref(communityColumn)}`;
    const publicCommunity = eb.exists(
      eb.selectFrom("communities as vc").select(sql`1`.as("x")).where("vc.id", "=", cid).where("vc.visibility", "=", "PUBLIC").where("vc.status", "=", "PUBLISHED"),
    );
    if (!viewer) return publicCommunity;
    if (isStaff(viewer)) return sql<boolean>`true`;
    return eb.or([
      publicCommunity,
      eb.exists(
        eb.selectFrom("community_members as vm").select(sql`1`.as("x")).where("vm.community_id", "=", cid).where("vm.user_id", "=", viewer.id).where("vm.status", "=", "ACTIVE"),
      ),
    ]);
  };
}

export async function isBlockedEitherWay(a: string, b: string, exec: Executor = db): Promise<boolean> {
  const row = await exec
    .selectFrom("blocks")
    .select("blocker_id")
    .where((w) => w.or([w.and([w("blocker_id", "=", a), w("blocked_id", "=", b)]), w.and([w("blocker_id", "=", b), w("blocked_id", "=", a)])]))
    .executeTakeFirst();
  return !!row;
}

/** Ids of everyone the viewer has blocked or been blocked by (for filtering small in-memory lists). */
export async function blockedSet(viewerId: string, exec: Executor = db): Promise<Set<string>> {
  const rows = await exec
    .selectFrom("blocks")
    .select(["blocker_id", "blocked_id"])
    .where((w) => w.or([w("blocker_id", "=", viewerId), w("blocked_id", "=", viewerId)]))
    .execute();
  return new Set(rows.map((r) => (r.blocker_id === viewerId ? r.blocked_id : r.blocker_id)));
}

export async function shareActiveCommunity(a: string, b: string, exec: Executor = db): Promise<boolean> {
  const row = await exec
    .selectFrom("community_members as ma")
    .innerJoin("community_members as mb", "mb.community_id", "ma.community_id")
    .innerJoin("communities as c", "c.id", "ma.community_id")
    .select("ma.community_id")
    .where("ma.user_id", "=", a)
    .where("mb.user_id", "=", b)
    .where("ma.status", "=", "ACTIVE")
    .where("mb.status", "=", "ACTIVE")
    .where("c.status", "=", "PUBLISHED")
    .limit(1)
    .executeTakeFirst();
  return !!row;
}
