/**
 * Search predicates written to match the indexes in 0001_init.sql exactly, so Postgres
 * can use them: the users trigram index is on (display_name || ' ' || username), the
 * communities trigram index on name, and posts/questions/communities have tsvector
 * `search` columns. Never ILIKE an unindexed column.
 */
import { sql, type Expression, type SqlBool } from "kysely";
import { likeContains, prefixTsQuery } from "../domain/tags";

/** Matches users_name_trgm_idx. `alias` is the users table alias. */
export function userNameLike(alias: string, q: string): Expression<SqlBool> {
  return sql<boolean>`(${sql.ref(`${alias}.display_name`)} || ' ' || ${sql.ref(`${alias}.username`)}::text) ILIKE ${likeContains(q)}`;
}

/** tsvector prefix match on a `search` column; false when the query has no words. */
export function tsMatches(searchColumn: string, q: string): Expression<SqlBool> {
  const ts = prefixTsQuery(q);
  if (!ts) return sql<boolean>`false`;
  return sql<boolean>`${sql.ref(searchColumn)} @@ to_tsquery('simple', ${ts})`;
}
