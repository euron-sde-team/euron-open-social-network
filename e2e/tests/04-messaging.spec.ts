import { expect, test } from "@playwright/test";
import { as, createCommunity, join, leaveAll, newUser, pageFor, uniq } from "../helpers";

test("no shared community means no DM; after joining one, a request, accept, typing and Seen in real time", async ({ browser, request }) => {
  const alice = await newUser(request, { displayName: "Alma Reyes" });
  const bob = await newUser(request, { displayName: "Bruno Pike" });
  // New accounts join the network's default communities; take both out so they share none.
  await leaveAll(request, alice);
  await leaveAll(request, bob);
  const club = await createCommunity(request, alice);

  const b = await pageFor(browser, bob, `/u/${alice.username}`);
  await test.step("with no shared community the Message button is disabled with the reason", async () => {
    const actions = b.getByTestId("profile-actions");
    await expect(actions.getByTestId("message-button")).toBeDisabled();
    await expect(actions.locator("#message-denied")).toHaveText("Alma Reyes only accepts messages from people in their communities. Join a community they are in to message them.");
    const elig = await as<{ allowed: boolean; reason: string }>(request, bob, "GET", `/dms/eligibility/${alice.id}`);
    expect(elig).toMatchObject({ allowed: false, reason: "NO_SHARED_COMMUNITY" });
  });

  await join(request, bob, club);
  const first = `Hi Alma, saw your club ${uniq("m")}`;
  const a = await pageFor(browser, alice, "/messages");
  // Alma is already looking at her (empty) requests when the message is sent.
  await a.getByRole("tab", { name: /Requests/ }).click();
  await expect(a.getByText("No message requests")).toBeVisible();
  await test.step("after joining a community Alma is in, Bruno can message her", async () => {
    await b.reload();
    const btn = b.getByTestId("profile-actions").getByTestId("message-button");
    await expect(btn).toBeEnabled();
    await btn.click();
    const win = b.getByTestId("dock-window").last();
    await expect(win).toBeVisible();
    await win.getByTestId("message-input").fill(first);
    await win.getByTestId("message-send").click();
    await expect(win.getByTestId("message-bubble").filter({ hasText: first })).toBeVisible();
  });

  let threadId = "";
  await test.step("Alma sees it under Message requests live and accepts", async () => {
    const item = a.getByTestId("thread-list").getByTestId("thread-item").filter({ hasText: "Bruno Pike" });
    await expect(item).toBeVisible();
    threadId = (await item.getAttribute("data-thread-id")) ?? "";
    await item.click();
    const convo = a.getByTestId("conversation");
    await expect(convo.getByTestId("message-bubble").filter({ hasText: first })).toBeVisible();
    await convo.getByTestId("request-accept").click();
    await expect(convo.getByTestId("request-banner")).toHaveCount(0);
  });

  await test.step("a real-time exchange with the typing indicator and Seen", async () => {
    await b.goto(`/messages/${threadId}`);
    const bc = b.getByTestId("conversation");
    const ac = a.getByTestId("conversation");
    await expect(bc).toBeVisible();

    await ac.getByTestId("message-input").pressSequentially("Hey Bruno", { delay: 20 });
    await expect(bc.getByTestId("typing-indicator")).toBeVisible();
    const reply = `Welcome aboard ${uniq("r")}`;
    await ac.getByTestId("message-input").fill(reply);
    await ac.getByTestId("message-send").click();
    await expect(bc.getByTestId("message-bubble").filter({ hasText: reply })).toBeVisible();
    await expect(bc.getByTestId("typing-indicator")).toHaveCount(0);
    // Bruno has the thread open, so it is read and Alma's last message shows Seen.
    await expect(ac.getByTestId("dm-seen").last()).toHaveText(/Seen/);

    const back = `Thanks! ${uniq("t")}`;
    await bc.getByTestId("message-input").fill(back);
    await bc.getByTestId("message-send").click();
    await expect(ac.getByTestId("message-bubble").filter({ hasText: back })).toBeVisible();
    await expect(bc.getByTestId("dm-seen").last()).toHaveText(/Seen/);
  });

  await a.context().close();
  await b.context().close();
});
