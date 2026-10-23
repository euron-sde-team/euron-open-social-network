import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiLogin, as, createCommunity, createPost, DEMO, join, newUser, pageFor, postCard, uniq, type TestUser } from "../helpers";

/** Waits for the asynchronous moderation scan to settle the post's status. */
async function waitForStatus(request: APIRequestContext, author: TestUser, postId: string, status: string) {
  await expect
    .poll(async () => (await as<{ status: string }>(request, author, "GET", `/posts/${postId}`)).status, { timeout: 30_000, message: `post ${postId} becomes ${status}` })
    .toBe(status);
}

async function openCase(desk: Page, snippet: string) {
  const row = desk.getByTestId("moderation-queue").getByTestId("moderation-case").filter({ hasText: snippet }).first();
  await expect(row).toBeVisible();
  await row.click();
  const drawer = desk.getByTestId("case-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("an AI-flagged post is hidden automatically; the author appeals and the moderator sees the case and the appeal", async ({ browser, request }) => {
  const owner = await newUser(request);
  const author = await newUser(request, { displayName: "Hal Heated" });
  const club = await createCommunity(request, owner);
  await join(request, author, club);
  const tag = uniq("h");
  const post = await createPost(request, author, club, `You are all clowns ${tag} [[mod:harassment=0.97]]`);
  await waitForStatus(request, author, post.id, "HIDDEN");

  const a = await pageFor(browser, author, `/posts/${post.id}`);
  const statement = `This was a joke between friends, nobody was harassed. ${tag}`;
  await test.step("the author sees the post as hidden, follows the link to the case and appeals", async () => {
    const banner = postCard(a, post.id).getByTestId("post-status-banner");
    await expect(banner).toContainText("This post is hidden from others.");
    await banner.getByRole("link", { name: "See why and appeal" }).click();
    await expect(a).toHaveURL(/\/account\/moderation$/);
    await a.getByTestId("my-cases").getByRole("link").filter({ hasText: tag }).first().click();
    await expect(a).toHaveURL(/\/account\/moderation\/[0-9A-Z]{26}$/);
    const panel = a.getByTestId("appeal-panel");
    await panel.getByLabel("Your statement").fill(statement);
    await panel.getByTestId("appeal-submit").click();
    await expect(panel).toContainText("Waiting for a decision");
  });

  const mod = await apiLogin(request, DEMO.moderator);
  const q = await pageFor(browser, mod, "/moderation");
  await test.step("the moderator finds the open case, with the appeal, on the desk", async () => {
    const drawer = await openCase(q, tag);
    await expect(drawer.getByTestId("case-author")).toContainText("Hal Heated");
    await expect(drawer.getByTestId("case-appeal")).toContainText(statement);
    await q.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  });

  await test.step("the appeal is listed under Appeals and the moderator upholds it", async () => {
    await q.getByTestId("tab-appeals").click();
    const card = q.getByTestId("appeals-list").getByTestId("appeal-card").filter({ hasText: statement });
    await expect(card).toBeVisible();
    await card.getByTestId("appeal-uphold").click();
    await expect(card).toHaveCount(0);
    await a.reload();
    await expect(a.getByTestId("appeal-panel")).toContainText("Decision upheld");
  });

  await a.context().close();
  await q.context().close();
});

test("a reported post is hidden from the moderation desk and disappears for everyone else", async ({ browser, request }) => {
  const owner = await newUser(request);
  const poster = await newUser(request, { displayName: "Pia Poster" });
  const reporter = await newUser(request, { displayName: "Rex Reporter" });
  const club = await createCommunity(request, owner);
  await join(request, poster, club);
  await join(request, reporter, club);
  const tag = uniq("s");
  const post = await createPost(request, poster, club, `Cheap watches, click my link ${tag}`);
  await waitForStatus(request, poster, post.id, "PUBLISHED");

  const r = await pageFor(browser, reporter, `/c/${club.slug}`);
  await test.step("a member reports the post", async () => {
    const card = postCard(r, post.id);
    await card.getByTestId("post-menu").click();
    await r.getByTestId("post-report").click();
    const dialog = r.getByTestId("report-dialog");
    await dialog.getByTestId("report-reason-spam").click();
    await dialog.getByTestId("report-submit").click();
    await expect(dialog).toBeHidden();
  });

  const mod = await apiLogin(request, DEMO.moderator);
  const q = await pageFor(browser, mod, "/moderation");
  await test.step("the moderator hides it from the desk", async () => {
    const drawer = await openCase(q, tag);
    const acted = q.waitForResponse((res) => /\/api\/moderation\/cases\/[^/]+\/actions$/.test(res.url()));
    await drawer.getByTestId("case-action-hide").click();
    expect((await acted).status()).toBe(200);
    await waitForStatus(request, poster, post.id, "HIDDEN");
  });

  await test.step("the post is gone for other members", async () => {
    await r.reload();
    await expect(r.getByTestId("community-header")).toBeVisible();
    await expect(r.getByTestId("composer-card")).toBeVisible();
    await expect(r.getByTestId("post-skeleton")).toHaveCount(0);
    await expect(postCard(r, post.id)).toHaveCount(0);
    await expect(r.getByText(tag)).toHaveCount(0);
  });

  await r.context().close();
  await q.context().close();
});
