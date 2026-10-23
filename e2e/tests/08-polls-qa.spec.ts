import { expect, test } from "@playwright/test";
import { as, createCommunity, createPost, join, newUser, pageFor, postCard, uniq } from "../helpers";

test("vote in a poll and see the results", async ({ browser, request }) => {
  const author = await newUser(request);
  const voter = await newUser(request);
  const club = await createCommunity(request, author);
  await join(request, voter, club);
  const post = await createPost(request, author, club, `Team lunch poll ${uniq("p")}`, { poll: { question: "Where should we eat?", options: ["Noodle bar", "Taco stand"] } });
  const noodles = post.poll!.options.find((o) => o.label === "Noodle bar")!;
  await as(request, author, "POST", `/polls/${post.poll!.id}/vote`, { optionIds: [noodles.id] });

  const v = await pageFor(browser, voter, `/posts/${post.id}`);
  const poll = postCard(v, post.id).getByTestId("poll");
  await expect(poll).toContainText("Where should we eat?");
  await poll.getByTestId("poll-option").filter({ hasText: "Taco stand" }).click();
  await expect(poll.getByTestId("poll-result")).toHaveCount(2);
  await expect(poll.getByTestId("poll-result").filter({ hasText: "Taco stand" })).toContainText("50%");
  await expect(poll.getByTestId("poll-result").filter({ hasText: "Taco stand" }).getByLabel("Your vote")).toBeVisible();
  await expect(poll.getByTestId("poll-result").filter({ hasText: "Noodle bar" })).toContainText("50%");
  await expect(poll).toContainText("2 people voted");
  await v.reload();
  await expect(postCard(v, post.id).getByTestId("poll")).toContainText("2 people voted");
  await v.context().close();
});

test("ask a question, another member answers, the asker accepts the answer", async ({ browser, request }) => {
  const asker = await newUser(request, { displayName: "Quin Asker" });
  const expert = await newUser(request, { displayName: "Eve Expert" });
  const club = await createCommunity(request, asker);
  await join(request, expert, club);
  const title = `How do I rotate the refresh cookie safely? ${uniq("q")}`;

  const a = await pageFor(browser, asker, `/c/${club.slug}?tab=qa`);
  let questionUrl = "";
  await test.step("the asker posts a question from the Q&A tab", async () => {
    await a.getByTestId("ask-question").click();
    const dialog = a.getByTestId("ask-dialog");
    await dialog.getByTestId("question-title").fill(title);
    await dialog.getByTestId("question-body").fill("Two tabs refresh at the same time and one of them is signed out. What is the usual fix?");
    await dialog.getByTestId("question-submit").click();
    await expect(a).toHaveURL(/\/questions\/[0-9A-Z]{26}$/);
    await expect(a.getByTestId("question-detail")).toContainText(title);
    questionUrl = new URL(a.url()).pathname;
  });

  const answer = `Serialise the refresh across tabs with a Web Lock. ${uniq("a")}`;
  const e = await pageFor(browser, expert, questionUrl);
  await test.step("another member answers", async () => {
    await e.getByTestId("answer-input").fill(answer);
    await e.getByTestId("answer-submit").click();
    await expect(e.getByTestId("answer-list").getByTestId("answer-card").filter({ hasText: answer })).toBeVisible();
    await expect(e.getByTestId("answer-accept")).toHaveCount(0);
  });

  await test.step("the asker accepts it", async () => {
    await a.reload();
    const card = a.getByTestId("answer-card").filter({ hasText: answer });
    await card.getByTestId("answer-accept").click();
    await expect(card.getByTestId("answer-accept")).toHaveText(/Unaccept/);
    await expect(card).toContainText("Accepted answer");
    await e.reload();
    await expect(e.getByTestId("answer-card").filter({ hasText: answer })).toContainText("Accepted answer");
  });

  await a.context().close();
  await e.context().close();
});
