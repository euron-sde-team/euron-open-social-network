/** Trending tags: most used on visible posts over the last TRENDING_DAYS days. */
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { TRENDING_DAYS } from "../domain/tags";
import { canReadCommunity, notBlocked } from "./visibility";

export class TagRepository {
  trending(viewer: Actor | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("post_tags as t")
      .innerJoin("posts as p", "p.id", "t.post_id")
      .innerJoin("communities as c", "c.id", "p.community_id")
      .select(["t.tag"])
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("t.created_at", ">", sql<Date>`now() - ${sql.lit(`${TRENDING_DAYS} days`)}::interval`)
      .where("p.status", "=", "PUBLISHED")
      .where("c.status", "=", "PUBLISHED")
      .where(notBlocked(viewer?.id, "p.author_id"))
      .where(canReadCommunity(viewer, "p.community_id"))
      .groupBy("t.tag")
      .orderBy("n", "desc")
      .orderBy("t.tag", "asc")
      .limit(limit)
      .execute()
      .then((rows) => rows.map((r) => ({ tag: String(r.tag).toLowerCase(), postCount: Number(r.n) })));
  }
}

export const tagRepo = new TagRepository();
