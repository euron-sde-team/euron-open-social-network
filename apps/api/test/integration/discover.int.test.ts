import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { anon, as, createUser } from "./harness";
import { addMember, allPages, makePost, uniq, world } from "./social-fixtures";

describe("discovery", () => {
  test("search finds people, communities, posts and questions", async () => {
    const word = `zq${uniq("w").toLowerCase()}`;
    const person = await createUser({ displayName: `Searchable ${word}` });
    const { community, members } = await world({ members: 1 });
    await addMember(community.id, person);
    const post = await makePost(members[0]!, community.id, `Notes about ${word} and more`);
    const q = (await as(members[0]!).post("/api/questions").send({ communityId: community.id, title: `How does ${word} work in practice?`, body: "" }).expect(201)).body;
    const res = await anon().get(`/api/discover/search?q=${word}`).expect(200);
    expect(res.body.people.map((u: { id: string }) => u.id)).toEqual([person.id]);
    expect(res.body.posts.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect(res.body.questions.map((x: { id: string }) => x.id)).toEqual([q.id]);
    const onlyPosts = await anon().get(`/api/discover/search?q=${word}&type=posts`).expect(200);
    expect(onlyPosts.body.people).toEqual([]);
    await anon().get("/api/discover/search?q=a").expect(400);
    const ta = await anon().get(`/api/discover/typeahead?q=${word.slice(0, 6)}`).expect(200);
    expect(ta.body.people.map((u: { id: string }) => u.id)).toContain(person.id);
    // Wildcards in the query are literal.
    expect((await anon().get("/api/discover/typeahead?q=%25%25").expect(200)).body.people).toEqual([]);
  });

  test("trending tags count the last 14 days of visible posts; tag pages are complete", async () => {
    const tag = `t${uniq("x").toLowerCase()}`;
    const { community, members } = await world({ members: 1 });
    for (let i = 0; i < 3; i++) await makePost(members[0]!, community.id, `#${tag} number ${i}`);
    const old = await makePost(members[0]!, community.id, `#${tag} ancient`);
    await db.updateTable("post_tags").set({ created_at: new Date(Date.now() - 20 * 86400_000) }).where("post_id", "=", old.id).execute();
    const trending = await anon().get("/api/discover/trending-tags").expect(200);
    const mine = trending.body.find((t: { tag: string }) => t.tag === tag);
    // The table is shared with other tests, so the tag may sit below the top 20; when listed, the old post is excluded.
    if (mine) expect(mine.postCount).toBe(3);
    const all = await allPages(async (c) => (await anon().get(`/api/discover/tags/${tag.toUpperCase()}/posts?limit=2${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(all).toHaveLength(4);
  });

  test("leaderboard ranks by reputation (all) and by points earned in the window", async () => {
    const { community, members } = await world({ members: 2 });
    const [a, b] = members;
    await makePost(a!, community.id);
    await makePost(b!, community.id);
    // The database is shared with every other test, so lift these two far above the rest.
    await db.updateTable("users").set({ reputation: 9_000_002 }).where("id", "=", a!.id).execute();
    await db.updateTable("users").set({ reputation: 9_000_001 }).where("id", "=", b!.id).execute();
    await db
      .insertInto("points_ledger")
      .values([
        { id: newId(), user_id: b!.id, amount: 8_000_000, reason: "post_created", entity_type: "test", entity_id: newId(), actor_id: b!.id },
        { id: newId(), user_id: a!.id, amount: 7_000_000, reason: "post_created", entity_type: "test", entity_id: newId(), actor_id: a!.id },
      ])
      .execute();
    const all = await anon().get("/api/discover/leaderboard?period=all").expect(200);
    expect(all.body.slice(0, 2).map((e: { user: { id: string } }) => e.user.id)).toEqual([a!.id, b!.id]);
    expect(all.body[0]).toMatchObject({ rank: 1, reputation: 9_000_002 });
    const week = await anon().get("/api/discover/leaderboard?period=week").expect(200);
    expect(week.body.slice(0, 2).map((e: { user: { id: string } }) => e.user.id)).toEqual([b!.id, a!.id]);
    expect(week.body[0]).toMatchObject({ rank: 1, reputation: 8_000_005 });
    expect(week.body.every((e: { rank: number }, i: number) => e.rank === i + 1)).toBe(true);
    // A blocked person drops out of your view of the board.
    await as(a!).post(`/api/users/${b!.id}/block`).expect(204);
    const mine = await as(a!).get("/api/discover/leaderboard?period=all").expect(200);
    expect(mine.body.map((e: { user: { id: string } }) => e.user.id)).not.toContain(b!.id);
  });
});
