/**
 * The one database connection pool, and the `Executor` type every repository method
 * accepts so it can run inside or outside a transaction:
 *
 *   async findById(id: string, exec: Executor = db) { return exec.selectFrom("users")... }
 */
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import { config } from "../core/config";
import { resolveConnectionConfig } from "./connection-config";
import type { DB } from "./types";

// timestamp without time zone is never used by the schema, but parse it as UTC anyway.
pg.types.setTypeParser(1114, (v: string) => new Date(`${v}Z`));
// int8 (bigint): file sizes and COUNT(*). Safe as numbers well below 2^53.
pg.types.setTypeParser(20, (v: string) => Number(v));
// numeric: averages and ratios.
pg.types.setTypeParser(1700, (v: string) => Number(v));

export const pool = new pg.Pool({
  ...resolveConnectionConfig(process.env),
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export type Executor = Kysely<DB> | Transaction<DB>;

export async function closeDb(): Promise<void> {
  await db.destroy();
}
