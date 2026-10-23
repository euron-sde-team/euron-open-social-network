import { expect, test } from "@playwright/test";
import { as, createPost, newUser, pageFor, uniq, type TestCommunity } from "../helpers";

test("a private community with approval: request to join, approve from Requests, then see the discussion", async ({ browser, request }) => {
  const owner = await newUser(request, { displayName: "Olive Owner" });
  const asker = await newUser(request, { displayName: "Arlo Asker" });
  const name = `Private Garden ${uniq("g").slice(-6)}`;
  let community!: TestCommunity;

  const o = await pageFor(browser, owner, "/communities/new");
  await test.step("the owner creates a PRIVATE, APPROVAL community in the UI", async () => {
    const form = o.getByTestId("community-form");
    await form.getByTestId("community-name").fill(name);
    await form.getByTestId("visibility-private").click();
    await form.getByTestId("join-policy-approval").click();
    const created = o.waitForResponse((r) => r.url().endsWith("/api/communities") && r.request().method() === "POST");
    await form.getByTestId("community-submit").click();
    const res = await created;
    expect(res.status()).toBe(201);
    community = await res.json();
    expect(community).toMatchObject({ visibility: "PRIVATE", joinPolicy: "APPROVAL" });
    await expect(o).toHaveURL(new RegExp(`/c/${community.slug}$`));
    await expect(o.getByTestId("community-header").getByTestId("community-name")).toHaveText(name);
  });
  const secret = await createPost(request, owner, community, `Members-only notes ${uniq("n")}`);

  const a = await pageFor(browser, asker, `/c/${community.slug}`);
  await test.step("a non-member sees the private gate and asks to join", async () => {
    const gate = a.getByTestId("private-gate");
    await expect(gate).toContainText("This community is private");
    await expect(a.getByText(secret.body)).toHaveCount(0);
    await gate.getByTestId("join-button").click();
    await expect(gate.getByTestId("join-button")).toHaveAttribute("data-state-join", "requested");
    await expect(gate).toContainText("Your request to join is waiting for a moderator");
  });

  await test.step("the owner approves the request from the Requests tab", async () => {
    await o.goto(`/c/${community.slug}?tab=members`);
    await o.getByRole("tablist", { name: "Member status" }).getByRole("tab", { name: "Requests" }).click();
    const list = o.getByTestId("members-list");
    await expect(list).toContainText("Arlo Asker");
    await list.getByTestId("member-approve").click();
    await expect(o.getByTestId("members-list").getByTestId("member-approve")).toHaveCount(0);
  });

  await test.step("the new member now sees the discussion", async () => {
    await a.reload();
    await expect(a.getByTestId("private-gate")).toHaveCount(0);
    await expect(a.getByText(secret.body)).toBeVisible();
    await expect(a.getByTestId("community-tab-chat")).toBeVisible();
  });

  await o.context().close();
  await a.context().close();
});

test("an invite link lets someone into an invite-only private community", async ({ browser, request }) => {
  const owner = await newUser(request);
  const guest = await newUser(request, { displayName: "Gil Guest" });
  const community = await as<TestCommunity>(request, owner, "POST", "/communities", { name: `Invite Club ${uniq("i").slice(-6)}`, visibility: "PRIVATE", joinPolicy: "INVITE_ONLY" }, 201);
  const post = await createPost(request, owner, community, `Welcome, invitees ${uniq("w")}`);
  const invite = await as<{ code: string; url: string }>(request, owner, "POST", `/communities/${community.id}/invites`, { maxUses: 1 }, 201);

  const g = await pageFor(browser, guest, `/invite/${invite.code}`);
  const landing = g.getByTestId("invite-landing");
  await expect(landing).toContainText(community.name);
  await landing.getByTestId("join-button").click();
  await expect(g).toHaveURL(new RegExp(`/c/${community.slug}$`));
  await expect(g.getByText(post.body)).toBeVisible();
  await g.context().close();
});
