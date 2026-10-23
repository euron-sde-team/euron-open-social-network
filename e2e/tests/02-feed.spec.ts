import { expect, test } from "@playwright/test";
import { createCommunity, join, newUser, pageFor, pngBytes, postCard, uniq } from "../helpers";

test("post a photo through the real S3 upload, react with LOVE, get notified live, comment and reply", async ({ browser, request }) => {
  const author = await newUser(request, { displayName: "Ava Author" });
  const fan = await newUser(request, { displayName: "Finn Fan" });
  const community = await createCommunity(request, author);
  await join(request, fan, community);

  const a = await pageFor(browser, author);
  const body = `Sunrise over the bay ${uniq("p")}`;
  let postId = "";

  await test.step("the author posts a photo from the home feed", async () => {
    await a.getByTestId("composer").click();
    const dialog = a.getByTestId("composer-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("composer-input").fill(body);
    await dialog.getByTestId("composer-file-input").setInputFiles({ name: "sunrise.png", mimeType: "image/png", buffer: pngBytes(24) });
    await expect(dialog.getByTestId("upload-previews")).toBeVisible();
    // The bytes go straight to the presigned S3 (Floci) URL, then the upload is completed.
    const created = a.waitForResponse((r) => r.url().endsWith("/api/posts") && r.request().method() === "POST");
    await expect(dialog.getByTestId("composer-submit")).toBeEnabled();
    await dialog.getByTestId("composer-submit").click();
    const res = await created;
    expect(res.status()).toBe(201);
    postId = (await res.json()).id;
    await expect(dialog).toBeHidden();
  });

  await test.step("the post shows in the feed with the image served from S3", async () => {
    const card = postCard(a, postId);
    await expect(card).toContainText(body);
    const img = card.getByTestId("media-mosaic").locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as unknown as { complete: boolean; naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
  });

  const bell = a.getByTestId("notifications-bell");
  const unreadBefore = Number(((await bell.getAttribute("aria-label")) ?? "").match(/(\d+) unread/)?.[1] ?? 0);

  const f = await pageFor(browser, fan, `/posts/${postId}`);
  await test.step("a second member reacts with LOVE through the picker", async () => {
    const card = postCard(f, postId);
    await expect(card).toContainText(body);
    await card.getByTestId("reaction-button").hover();
    await expect(card.getByTestId("reaction-picker")).toBeVisible();
    await card.getByTestId("reaction-love").click();
    await expect(card.getByTestId("reaction-button")).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByTestId("reaction-button")).toContainText("Love");
  });

  await test.step("the author's bell counts it without a reload", async () => {
    await expect(bell).toHaveAttribute("aria-label", `Notifications, ${unreadBefore + 1} unread`);
    await bell.click();
    await expect(a.getByTestId("notifications-dropdown").getByTestId("notification-item").first()).toContainText("Finn Fan");
    await a.keyboard.press("Escape");
  });

  const comment = `Gorgeous light ${uniq("c")}`;
  await test.step("the fan comments", async () => {
    const card = postCard(f, postId);
    await card.getByTestId("comment-input").first().fill(comment);
    await card.getByTestId("comment-submit").first().click();
    await expect(card.getByTestId("comment").filter({ hasText: comment })).toBeVisible();
  });

  const reply = `Thank you ${uniq("r")}`;
  await test.step("the author replies to the comment", async () => {
    await a.goto(`/posts/${postId}`);
    const card = postCard(a, postId);
    const thread = card.getByTestId("comment").filter({ hasText: comment }).first();
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    const input = card.getByLabel("Write a reply");
    await input.fill(reply);
    await input.locator("xpath=ancestor::*[.//*[@data-testid='comment-submit']][1]").getByTestId("comment-submit").click();
    // Replies nest inside their parent comment: pick the innermost one.
    await expect(card.getByTestId("comment").filter({ hasText: reply, hasNotText: comment })).toBeVisible();
  });

  await test.step("the fan sees the reply after a reload", async () => {
    await f.reload();
    const card = postCard(f, postId);
    await expect(card.getByTestId("comment").filter({ hasText: comment }).first()).toBeVisible();
    await card.getByTestId("view-replies").click();
    // Replies nest inside their parent comment: pick the innermost one.
    await expect(card.getByTestId("comment").filter({ hasText: reply, hasNotText: comment })).toBeVisible();
  });

  await a.context().close();
  await f.context().close();
});
