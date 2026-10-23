/**
 * Keyset pagination must return every row exactly once, even when many rows share a
 * timestamp. This pins the schema decision that timestamps are timestamptz(3): with
 * microsecond columns, a cursor built from a millisecond JS Date skips or repeats rows.
 */
import { describe, expect, test } from "vitest";
import { sql } from "kysely";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, createUser } from "./harness";
import { addMember, allPages, makeCommunity } from "./social-fixtures";

describe("keyset pagination precision", () => {
  test("timestamps are stored at millisecond precision", async () => {
    const r = await sql<{ t: Date }>`select '2026-01-01 00:00:00.123456+00'::timestamptz(3) as t`.execute(db);
    expect(r.rows[0]?.t.toISOString()).toBe("2026-01-01T00:00:00.123Z");
    const cols = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name <> 'schema_migrations'
        and data_type = 'timestamp with time zone' and datetime_precision <> 3`.execute(db);
    expect(cols.rows[0]?.n).toBe(0);
  });

  test("40 chat messages with the same timestamp page out exactly once", async () => {
    const owner = await createUser();
    const member = await createUser();
    const community = await makeCommunity(owner);
    await addMember(community.id, member);
    const at = new Date();
    const ids = Array.from({ length: 40 }, () => newId());
    await db
      .insertInto("chat_messages")
      .values(ids.map((id) => ({ id, community_id: community.id, sender_id: owner.id, body: `m ${id}`, created_at: at })))
      .execute();

    const seen = await allPages(async (cursor) => {
      const res = await as(member).get(`/api/chat/${community.id}/messages?limit=7${cursor ? `&cursor=${cursor}` : ""}`).expect(200);
      return res.body;
    });
    const got = seen.map((m: { id: string }) => m.id);
    expect(new Set(got).size).toBe(40);
    expect([...got].sort()).toEqual([...ids].sort());
  });
});
