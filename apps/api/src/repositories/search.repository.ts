/** People and community search for discovery, on the trigram and tsvector indexes only. */
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { isStaff } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { likeContains } from "../domain/tags";
import { tsMatches, userNameLike } from "./text-search";
import { notBlocked } from "./visibility";

export class SearchRepository {
  people(viewer: Actor | null, q: string, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("users as u")
      .select("u.id")
      .where("u.status", "=", "ACTIVE")
      .where(userNameLike("u", q))
      .where(notBlocked(viewer?.id, "u.id"))
      .orderBy("u.follower_count", "desc")
      .orderBy("u.id", "asc")
      .limit(limit)
      .execute()
      .then((rows) => rows.map((r) => r.id));
  }

  /** Public communities, plus private ones the viewer belongs to. */
  communities(viewer: Actor | null, q: string, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("communities as c")
      .selectAll("c")
      .where("c.status", "=", "PUBLISHED")
      .where((eb) => eb.or([eb("c.name", "ilike", likeContains(q)), tsMatches("c.search", q)]))
      .where((eb) =>
        isStaff(viewer)
          ? sql<boolean>`true`
          : eb.or([
              eb("c.visibility", "=", "PUBLIC"),
              ...(viewer
                ? [eb.exists(eb.selectFrom("community_members as m").select("m.id").whereRef("m.community_id", "=", "c.id").where("m.user_id", "=", viewer.id).where("m.status", "=", "ACTIVE"))]
                : []),
            ]),
      )
      .orderBy("c.member_count", "desc")
      .orderBy("c.id", "asc")
      .limit(limit)
      .execute();
  }
}

export const searchRepo = new SearchRepository();
