import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { anon, as, createUser } from "./harness";
import { addMember, allPages, notificationsOf, world } from "./social-fixtures";

async function ask(user: Parameters<typeof as>[0], communityId: string, title = "How do we plan the next release?") {
  return (await as(user).post("/api/questions").send({ communityId, title, body: "Looking for a process #planning", tags: ["Process"] }).expect(201)).body;
}

describe("questions and answers", () => {
  test("a question names its community (and keeps communityId), in reads and lists", async () => {
    const { community, members } = await world({ members: 1 });
    const q = await ask(members[0]!, community.id, "Where does the community link point?");
    expect(q).toMatchObject({ communityId: community.id, community: { id: community.id, slug: community.slug, name: community.name } });
    expect(Object.keys(q.community).sort()).toEqual(["id", "name", "slug"]);
    expect((await anon().get(`/api/questions/${q.id}`).expect(200)).body.community.slug).toBe(community.slug);
    const listed = await anon().get(`/api/questions?communityId=${community.id}`).expect(200);
    expect(listed.body.items[0].community).toEqual({ id: community.id, slug: community.slug, name: community.name });
  });

  test("viewer.canDelete / canModerate match who the delete and status endpoints allow", async () => {
    const { owner, community, members } = await world({ members: 3 });
    const [asker, answerer, member] = members;
    const mod = await createUser();
    await addMember(community.id, mod, "MODERATOR");
    const staff = await createUser({ role: "MODERATOR" });
    const q = await ask(asker!, community.id);
    const a = (await as(answerer!).post(`/api/questions/${q.id}/answers`).send({ body: "An answer to moderate" }).expect(201)).body;
    const rights = async (u: Parameters<typeof as>[0]) => {
      const question = (await as(u).get(`/api/questions/${q.id}`).expect(200)).body.viewer;
      const answer = (await as(u).get(`/api/questions/${q.id}/answers`).expect(200)).body.items[0].viewer;
      return { canDelete: question.canDelete, canModerate: question.canModerate, answerCanDelete: answer.canDelete };
    };
    expect(await rights(asker!)).toEqual({ canDelete: true, canModerate: false, answerCanDelete: false });
    expect(await rights(answerer!)).toEqual({ canDelete: false, canModerate: false, answerCanDelete: true });
    expect(await rights(member!)).toEqual({ canDelete: false, canModerate: false, answerCanDelete: false });
    expect(await rights(null)).toEqual({ canDelete: false, canModerate: false, answerCanDelete: false });
    expect(await rights(mod)).toEqual({ canDelete: true, canModerate: true, answerCanDelete: true });
    expect(await rights(owner)).toEqual({ canDelete: true, canModerate: true, answerCanDelete: true });
    expect(await rights(staff)).toEqual({ canDelete: true, canModerate: true, answerCanDelete: true });
    // The flags agree with the endpoints: a plain member is refused, a mod is allowed.
    await as(member!).post(`/api/questions/${q.id}/status`).send({ status: "CLOSED" }).expect(403);
    await as(member!).delete(`/api/questions/answers/${a.id}`).expect(403);
    await as(member!).delete(`/api/questions/${q.id}`).expect(403);
    await as(mod).post(`/api/questions/${q.id}/status`).send({ status: "CLOSED" }).expect(200);
    await as(mod).delete(`/api/questions/answers/${a.id}`).expect(204);
    // A suspended moderator loses the rights, in the flags and at the endpoint.
    await db.updateTable("community_members").set({ status: "SUSPENDED", suspended_until: new Date(Date.now() + 86400_000) }).where("community_id", "=", community.id).where("user_id", "=", mod.id).execute();
    expect((await as(mod).get(`/api/questions/${q.id}`).expect(200)).body.viewer).toMatchObject({ canDelete: false, canModerate: false });
    await as(mod).delete(`/api/questions/${q.id}`).expect(403);
    await as(owner).delete(`/api/questions/${q.id}`).expect(204);
  });

  test("ask, answer, vote idempotently, accept (author only)", async () => {
    const { owner, community, members } = await world({ members: 3 });
    const [asker, answerer, voter] = members;
    const q = await ask(asker!, community.id);
    expect(q.tags.sort()).toEqual(["planning", "process"]);
    const a = (await as(answerer!).post(`/api/questions/${q.id}/answers`).send({ body: "Use a weekly cadence." }).expect(201)).body;
    const posted = (await notificationsOf(asker!.id)).find((n) => n.type === "ANSWER_POSTED");
    expect(posted?.entity_id).toBe(a.id);

    expect((await as(voter!).post(`/api/questions/${q.id}/vote`).send({ value: 1 }).expect(200)).body).toEqual({ score: 1, vote: 1 });
    expect((await as(voter!).post(`/api/questions/${q.id}/vote`).send({ value: 1 }).expect(200)).body).toEqual({ score: 1, vote: 1 });
    expect((await as(voter!).post(`/api/questions/${q.id}/vote`).send({ value: -1 }).expect(200)).body).toEqual({ score: -1, vote: -1 });
    expect((await as(voter!).post(`/api/questions/${q.id}/vote`).send({ value: 0 }).expect(200)).body).toEqual({ score: 0, vote: 0 });
    expect((await as(asker!).post(`/api/questions/${q.id}/vote`).send({ value: 1 }).expect(403)).body.code).toBe("SELF_VOTE");
    expect((await as(voter!).post(`/api/questions/answers/${a.id}/vote`).send({ value: 1 }).expect(200)).body).toEqual({ score: 1, vote: 1 });
    await as(voter!).post(`/api/questions/answers/${a.id}/vote`).send({ value: 1 }).expect(200);

    // Only the asker accepts: not a moderator, not the answerer.
    expect((await as(owner).post(`/api/questions/${q.id}/accept`).send({ answerId: a.id }).expect(403)).body.code).toBe("NOT_QUESTION_AUTHOR");
    await as(answerer!).post(`/api/questions/${q.id}/accept`).send({ answerId: a.id }).expect(403);
    const accepted = await as(asker!).post(`/api/questions/${q.id}/accept`).send({ answerId: a.id }).expect(200);
    expect(accepted.body).toMatchObject({ acceptedAnswerId: a.id, status: "RESOLVED" });
    const acc = (await notificationsOf(answerer!.id)).find((n) => n.type === "ANSWER_ACCEPTED");
    expect(acc?.data).toMatchObject({ questionId: q.id });

    const later = (await as(voter!).post(`/api/questions/${q.id}/answers`).send({ body: "A later answer with more votes" }).expect(201)).body;
    await as(answerer!).post(`/api/questions/answers/${later.id}/vote`).send({ value: 1 }).expect(200);
    await as(owner).post(`/api/questions/answers/${later.id}/vote`).send({ value: 1 }).expect(200);
    const answers = await anon().get(`/api/questions/${q.id}/answers`).expect(200);
    expect(answers.body.items.map((x: { id: string }) => x.id)).toEqual([a.id, later.id]);
    expect(answers.body.items[0].isAccepted).toBe(true);

    const unaccepted = await as(asker!).post(`/api/questions/${q.id}/accept`).send({ answerId: null }).expect(200);
    expect(unaccepted.body).toMatchObject({ acceptedAnswerId: null, status: "OPEN" });
  });

  test("views count once per viewer per hour", async () => {
    const { community, members } = await world({ members: 2 });
    const q = await ask(members[0]!, community.id);
    await as(members[1]!).get(`/api/questions/${q.id}`).expect(200);
    const again = await as(members[1]!).get(`/api/questions/${q.id}`).expect(200);
    expect(again.body.viewCount).toBe(1);
  });

  test("closed questions take no answers; status by author or mod", async () => {
    const { owner, community, members } = await world({ members: 2 });
    const q = await ask(members[0]!, community.id);
    await as(members[1]!).post(`/api/questions/${q.id}/status`).send({ status: "CLOSED" }).expect(403);
    await as(owner).post(`/api/questions/${q.id}/status`).send({ status: "CLOSED" }).expect(200);
    expect((await as(members[1]!).post(`/api/questions/${q.id}/answers`).send({ body: "late" }).expect(409)).body.code).toBe("QUESTION_CLOSED");
  });

  test("lists: new, top, unanswered, tag; pages are complete", async () => {
    const { community, members } = await world({ members: 2 });
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await ask(members[0]!, community.id, `Question number ${i} about things`)).id);
    await as(members[1]!).post(`/api/questions/${ids[2]}/vote`).send({ value: 1 }).expect(200);
    await as(members[1]!).post(`/api/questions/${ids[3]}/answers`).send({ body: "answered" }).expect(201);
    const all = await allPages(async (c) => (await anon().get(`/api/questions?communityId=${community.id}&limit=2${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(all.map((x: { id: string }) => x.id)).toEqual([...ids].reverse());
    const top = await allPages(async (c) => (await anon().get(`/api/questions?communityId=${community.id}&sort=top&limit=2${c ? `&cursor=${c}` : ""}`).expect(200)).body);
    expect(top[0].id).toBe(ids[2]);
    expect(top).toHaveLength(5);
    const unanswered = await anon().get(`/api/questions?communityId=${community.id}&sort=unanswered`).expect(200);
    expect(unanswered.body.items.map((x: { id: string }) => x.id)).not.toContain(ids[3]);
    const tagged = await anon().get(`/api/questions?communityId=${community.id}&tag=process`).expect(200);
    expect(tagged.body.items).toHaveLength(5);
    await anon().get("/api/questions").expect(400);
  });

  test("deleting the accepted answer reopens the question", async () => {
    const { community, members } = await world({ members: 2 });
    const q = await ask(members[0]!, community.id);
    const a = (await as(members[1]!).post(`/api/questions/${q.id}/answers`).send({ body: "short" }).expect(201)).body;
    await as(members[0]!).post(`/api/questions/${q.id}/accept`).send({ answerId: a.id }).expect(200);
    await as(members[1]!).delete(`/api/questions/answers/${a.id}`).expect(204);
    const after = await anon().get(`/api/questions/${q.id}`).expect(200);
    expect(after.body).toMatchObject({ acceptedAnswerId: null, status: "OPEN", answerCount: 0 });
  });

  test("non-members cannot ask or answer", async () => {
    const { community, members } = await world({ members: 1 });
    const stranger = await createUser();
    await as(stranger).post("/api/questions").send({ communityId: community.id, title: "A question from outside", body: "" }).expect(403);
    const q = await ask(members[0]!, community.id);
    await as(stranger).post(`/api/questions/${q.id}/answers`).send({ body: "drive-by" }).expect(403);
  });
});
