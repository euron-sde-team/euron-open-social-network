import { describe, expect, test } from "vitest";
import { anon, as, createUser } from "./harness";
import { makePost, world } from "./social-fixtures";

async function pollPost(opts: { allowMultiple?: boolean; isAnonymous?: boolean } = {}) {
  const w = await world({ members: 3 });
  const post = await makePost(w.members[0]!, w.community.id, "Vote please", { poll: { question: "Lunch?", options: ["Soup", "Salad", "Tacos"], ...opts } });
  return { ...w, post, poll: post.poll! };
}

describe("polls", () => {
  test("a vote replaces the previous one; totals stay exact", async () => {
    const { members, poll } = await pollPost();
    const [a, b] = members;
    const [soup, salad] = poll.options;
    let res = await as(a!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [soup!.id] }).expect(200);
    expect(res.body).toMatchObject({ totalVotes: 1, voterCount: 1 });
    res = await as(a!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [salad!.id] }).expect(200);
    expect(res.body.options.map((o: { voteCount: number }) => o.voteCount)).toEqual([0, 1, 0]);
    expect(res.body.options[1].votedByViewer).toBe(true);
    await as(b!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [salad!.id] }).expect(200);
    res = await as(a!).delete(`/api/polls/${poll.id}/vote`).expect(200);
    expect(res.body).toMatchObject({ totalVotes: 1, voterCount: 1 });
    expect((await as(a!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [soup!.id, salad!.id] }).expect(400)).body.code).toBe("SINGLE_CHOICE");
    expect((await as(a!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] }).expect(400)).body.code).toBe("INVALID_OPTION");
  });

  test("multiple choice counts each option and each voter once", async () => {
    const { members, poll } = await pollPost({ allowMultiple: true });
    const res = await as(members[1]!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [poll.options[0]!.id, poll.options[2]!.id] }).expect(200);
    expect(res.body).toMatchObject({ totalVotes: 2, voterCount: 1 });
    const voters = await as(members[0]!).get(`/api/polls/${poll.id}/voters`).expect(200);
    expect(voters.body.items.map((u: { id: string }) => u.id)).toEqual([members[1]!.id]);
    const byOption = await as(members[0]!).get(`/api/polls/${poll.id}/voters?optionId=${poll.options[1]!.id}`).expect(200);
    expect(byOption.body.items).toEqual([]);
  });

  test("voters of anonymous polls are never listed; voters are for members only", async () => {
    const { members, poll, community } = await pollPost({ isAnonymous: true });
    await as(members[1]!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [poll.options[0]!.id] }).expect(200);
    expect((await as(members[0]!).get(`/api/polls/${poll.id}/voters`).expect(403)).body.code).toBe("POLL_ANONYMOUS");
    const open = await pollPost();
    await as(await createUser()).get(`/api/polls/${open.poll.id}/voters`).expect(403);
    expect(community.id).toBeTruthy();
  });

  test("closing: author or mod; a closed poll takes no votes", async () => {
    const { owner, members, poll } = await pollPost();
    await as(members[1]!).post(`/api/polls/${poll.id}/close`).expect(403);
    expect((await as(owner).post(`/api/polls/${poll.id}/close`).expect(200)).body.isClosed).toBe(true);
    expect((await as(members[1]!).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [poll.options[0]!.id] }).expect(409)).body.code).toBe("POLL_CLOSED");
  });

  test("non-members can read a public poll but not vote", async () => {
    const { poll } = await pollPost();
    await anon().get(`/api/polls/${poll.id}`).expect(200);
    const stranger = await createUser();
    expect((await as(stranger).post(`/api/polls/${poll.id}/vote`).send({ optionIds: [poll.options[0]!.id] }).expect(403)).body.code).toBe("NOT_A_MEMBER");
  });
});
