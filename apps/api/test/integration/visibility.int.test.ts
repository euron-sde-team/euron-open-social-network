/**
 * The two visibility rules on every content endpoint:
 *   1. private community content is a 404 for non-members (never a 403);
 *   2. a block hides content both ways.
 */
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { newId } from "../../src/core/ids";
import { as, createUser, type TestUser } from "./harness";
import { addMember, makePost, notificationsOf, uniq, world } from "./social-fixtures";

async function privateWorld() {
  const w = await world({ members: 2, visibility: "PRIVATE" });
  const [author, other] = w.members;
  const word = `pv${uniq("s").toLowerCase()}`;
  const tag = `tg${uniq("t").toLowerCase()}`;
  const upload = await db
    .insertInto("media_uploads")
    .values({ id: newId(), owner_id: author!.id, purpose: "POST", kind: "IMAGE", mime_type: "image/png", file_name: "a.png", declared_size: 10, size_bytes: 10, storage_key: `test/${newId()}.png`, status: "READY" })
    .returning("id")
    .executeTakeFirstOrThrow();
  const post = await makePost(author!, w.community.id, `${word} secret #${tag}`, { mediaIds: [upload.id], poll: { question: "Private poll?", options: ["yes", "no"] } });
  await as(w.owner).post(`/api/posts/${post.id}/pin`).expect(200);
  const comment = (await as(other!).post(`/api/posts/${post.id}/comments`).send({ body: "private comment" }).expect(201)).body;
  const reply = (await as(author!).post(`/api/posts/${post.id}/comments`).send({ body: "private reply", parentId: comment.id }).expect(201)).body;
  await as(other!).post(`/api/polls/${post.poll!.id}/vote`).send({ optionIds: [post.poll!.options[0]!.id] }).expect(200);
  const question = (await as(author!).post("/api/questions").send({ communityId: w.community.id, title: `Private question ${word} here`, body: "" }).expect(201)).body;
  const answer = (await as(other!).post(`/api/questions/${question.id}/answers`).send({ body: "private answer" }).expect(201)).body;
  const event = (
    await as(author!)
      .post("/api/events")
      .send({ communityId: w.community.id, title: "Private meetup", startsAt: new Date(Date.now() + 86400_000).toISOString(), endsAt: new Date(Date.now() + 90000_000).toISOString(), isVirtual: true, virtualLink: "https://meet.example.com/private" })
      .expect(201)
  ).body;
  await as(other!).put(`/api/events/${event.id}/rsvp`).send({ status: "GOING" }).expect(200);
  return { ...w, author: author!, other: other!, post, comment, reply, question, answer, event, word, tag };
}

describe("private communities: 404 for non-members on every content endpoint", () => {
  test("every endpoint, for a signed-out visitor and a signed-in non-member", async () => {
    const p = await privateWorld();
    const stranger = await createUser();
    const pending = await createUser();
    await as(pending).post(`/api/communities/${p.community.id}/join`).send({}).expect(200); // OPEN private: joins
    await as(pending).post(`/api/communities/${p.community.id}/leave`).expect(204);
    for (const viewer of [null, stranger, pending] as (TestUser | null)[]) {
      const v = as(viewer);
      const label = viewer ? "member-less user" : "anonymous";
      const urls = [
        `/api/posts/${p.post.id}`,
        `/api/communities/${p.community.id}/posts`,
        `/api/communities/${p.community.id}/posts/pinned`,
        `/api/communities/${p.community.id}/media`,
        `/api/communities/${p.community.id}/members`,
        `/api/posts/${p.post.id}/comments`,
        `/api/posts/${p.post.id}/reactions`,
        `/api/comments/${p.comment.id}/replies`,
        `/api/polls/${p.post.poll!.id}`,
        `/api/questions?communityId=${p.community.id}`,
        `/api/questions/${p.question.id}`,
        `/api/questions/${p.question.id}/answers`,
        `/api/events/${p.event.id}`,
        `/api/events/${p.event.id}/attendees`,
        `/api/events/${p.event.id}/ics`,
        `/api/events?communityId=${p.community.id}`,
      ];
      for (const url of urls) {
        const res = await v.get(url);
        expect(res.status, `${label} GET ${url}`).toBe(404);
      }
      if (viewer) {
        expect((await v.get(`/api/polls/${p.post.poll!.id}/voters`)).status).toBe(404);
        expect((await v.post(`/api/posts/${p.post.id}/comments`).send({ body: "x" })).status).toBe(404);
        expect((await v.put(`/api/posts/${p.post.id}/reaction`).send({ type: "LIKE" })).status).toBe(404);
        expect((await v.post(`/api/posts/${p.post.id}/bookmark`)).status).toBe(404);
        expect((await v.post(`/api/questions/${p.question.id}/answers`).send({ body: "x" })).status).toBe(404);
        expect((await v.put(`/api/events/${p.event.id}/rsvp`).send({ status: "GOING" })).status).toBe(404);
      }
      const search = await v.get(`/api/discover/search?q=${p.word}`).expect(200);
      expect(search.body.posts, label).toEqual([]);
      expect(search.body.questions, label).toEqual([]);
      const tagPage = await v.get(`/api/discover/tags/${p.tag}/posts`).expect(200);
      expect(tagPage.body.items, label).toEqual([]);
      const trending = await v.get("/api/discover/trending-tags").expect(200);
      expect(trending.body.map((t: { tag: string }) => t.tag), label).not.toContain(p.tag);
      const profile = await v.get(`/api/users/${p.author.username}/posts`).expect(200);
      expect(profile.body.items, label).toEqual([]);
      const media = await v.get(`/api/users/${p.author.username}/media`).expect(200);
      expect(media.body.items, label).toEqual([]);
      const events = await v.get("/api/events?limit=50").expect(200);
      expect(events.body.items.map((e: { id: string }) => e.id), label).not.toContain(p.event.id);
    }
  });

  test("members see it all; the virtual link only once GOING", async () => {
    const p = await privateWorld();
    const member = await createUser();
    await addMember(p.community.id, member);
    await as(member).get(`/api/posts/${p.post.id}`).expect(200);
    expect((await as(member).get(`/api/communities/${p.community.id}/media`).expect(200)).body.items).toHaveLength(1);
    expect((await as(member).get(`/api/polls/${p.post.poll!.id}/voters`).expect(200)).body.items).toHaveLength(1);
    expect((await as(member).get(`/api/events/${p.event.id}`).expect(200)).body.virtualLink).toBeNull();
    expect((await as(p.other).get(`/api/events/${p.event.id}`).expect(200)).body.virtualLink).toBe("https://meet.example.com/private");
    expect((await as(member).get(`/api/discover/search?q=${p.word}`).expect(200)).body.posts).toHaveLength(1);
  });

  test("a mention of a non-member creates no notification (no snippet leak)", async () => {
    const p = await privateWorld();
    const outsider = await createUser();
    await makePost(p.author, p.community.id, `hey @${outsider.username} look at this secret`);
    expect((await notificationsOf(outsider.id)).filter((n) => n.type === "MENTION")).toHaveLength(0);
  });

  test("the home feed of someone who follows the author does not include private posts", async () => {
    const p = await privateWorld();
    const follower = await createUser();
    await as(follower).post(`/api/users/${p.author.id}/follow`).expect(204);
    const feed = await as(follower).get("/api/posts/feed").expect(200);
    expect(feed.body.items.map((x: { id: string }) => x.id)).not.toContain(p.post.id);
  });
});

describe("blocks hide content both ways", () => {
  test("feed, post, comments, replies, reactions, members, search, profiles", async () => {
    const { community, members } = await world({ members: 3 });
    const [a, b, c] = members;
    const word = `bk${uniq("b").toLowerCase()}`;
    const bPost = await makePost(b!, community.id, `${word} from b`);
    const cPost = await makePost(c!, community.id, "from c");
    const bComment = (await as(b!).post(`/api/posts/${cPost.id}/comments`).send({ body: "b says hi" }).expect(201)).body;
    const cComment = (await as(c!).post(`/api/posts/${cPost.id}/comments`).send({ body: "c says hi" }).expect(201)).body;
    await as(b!).post(`/api/posts/${cPost.id}/comments`).send({ body: "b replies", parentId: cComment.id }).expect(201);
    await as(b!).put(`/api/posts/${cPost.id}/reaction`).send({ type: "LIKE" }).expect(200);

    await as(b!).post(`/api/users/${a!.id}/block`).expect(204); // b blocks a; a must not see b either

    for (const [viewer, hidden] of [
      [a!, b!],
      [b!, a!],
    ] as const) {
      const feed = await as(viewer).get("/api/posts/feed").expect(200);
      expect(feed.body.items.some((p: { author: { id: string } }) => p.author.id === hidden.id)).toBe(false);
      const cf = await as(viewer).get(`/api/communities/${community.id}/posts`).expect(200);
      expect(cf.body.items.some((p: { author: { id: string } }) => p.author.id === hidden.id)).toBe(false);
      await as(viewer).get(`/api/users/${hidden.username}`).expect(404);
      const mem = await as(viewer).get(`/api/communities/${community.id}/members`).expect(200);
      expect(mem.body.items.some((m: { user: { id: string } }) => m.user.id === hidden.id)).toBe(false);
    }
    await as(a!).get(`/api/posts/${bPost.id}`).expect(404);
    await as(a!).put(`/api/posts/${bPost.id}/reaction`).send({ type: "LIKE" }).expect(404);
    const comments = await as(a!).get(`/api/posts/${cPost.id}/comments`).expect(200);
    expect(comments.body.items.map((x: { id: string }) => x.id)).toEqual([cComment.id]);
    const replies = await as(a!).get(`/api/comments/${cComment.id}/replies`).expect(200);
    expect(replies.body.items).toEqual([]);
    await as(a!).post(`/api/posts/${cPost.id}/comments`).send({ body: "reply to b", parentId: bComment.id }).expect(404);
    const reactions = await as(a!).get(`/api/posts/${cPost.id}/reactions`).expect(200);
    expect(reactions.body.items).toEqual([]);
    const search = await as(a!).get(`/api/discover/search?q=${word}`).expect(200);
    expect(search.body.posts).toEqual([]);
    const people = await as(a!).get(`/api/discover/search?q=${b!.username}&type=people`).expect(200);
    expect(people.body.people).toEqual([]);
    // Others still see everything.
    expect((await as(c!).get(`/api/posts/${cPost.id}/reactions`).expect(200)).body.items).toHaveLength(1);
  });

  test("mentions across a block are dropped", async () => {
    const { community, members } = await world({ members: 2 });
    const [a, b] = members;
    await as(a!).post(`/api/users/${b!.id}/block`).expect(204);
    const post = await makePost(a!, community.id, `@${b!.username} hello`);
    expect(post.mentions).toEqual([]);
    expect((await notificationsOf(b!.id)).filter((n) => n.type === "MENTION")).toHaveLength(0);
  });
});
