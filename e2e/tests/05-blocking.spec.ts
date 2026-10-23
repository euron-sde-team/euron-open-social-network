import { expect, test } from "@playwright/test";
import { API, as, call, createCommunity, createPost, join, newUser, pageFor, postCard, uniq } from "../helpers";

test("blocking hides the profile (404), the blocker's posts and DMs from the blocked person", async ({ browser, request }) => {
  const alice = await newUser(request, { displayName: "Bea Blocker" });
  const bob = await newUser(request, { displayName: "Bo Blocked" });
  const club = await createCommunity(request, alice);
  await join(request, bob, club);
  const post = await createPost(request, alice, club, `Only for friends ${uniq("p")}`);

  const b = await pageFor(browser, bob, `/c/${club.slug}`);
  await test.step("before the block, Bo sees Bea's post and can message her", async () => {
    await expect(postCard(b, post.id)).toBeVisible();
    expect((await as<{ allowed: boolean }>(request, bob, "GET", `/dms/eligibility/${alice.id}`)).allowed).toBe(true);
  });

  const a = await pageFor(browser, alice, `/u/${bob.username}`);
  await test.step("Bea blocks Bo from his profile", async () => {
    await a.getByTestId("profile-menu").click();
    await a.getByTestId("block-user").click();
    const dialog = a.getByTestId("block-confirm");
    await expect(dialog).toContainText("Block Bo Blocked?");
    await dialog.getByTestId("confirm-action").click();
    await expect(a.getByTestId("blocked-notice")).toContainText("You blocked Bo Blocked");
  });

  await test.step("Bo gets a 404 for Bea's profile", async () => {
    await b.goto(`/u/${alice.username}`);
    await expect(b.getByText("This page is not available")).toBeVisible();
    await expect(b.getByTestId("profile-header")).toHaveCount(0);
    await call(request, "GET", `/users/${alice.username}`, { token: bob.accessToken, ip: bob.ip, expect: 404 });
    // 404s, never 403s: nothing confirms that the profile or the post exists.
    expect((await request.get(`${API}/posts/${post.id}`, { headers: { Authorization: `Bearer ${bob.accessToken}`, "X-Forwarded-For": bob.ip } })).status()).toBe(404);
  });

  await test.step("Bea's posts disappear from Bo's view of the shared community", async () => {
    await b.goto(`/c/${club.slug}`);
    await expect(b.getByTestId("community-header")).toBeVisible();
    await expect(b.getByTestId("composer-card")).toBeVisible();
    await expect(b.getByTestId("post-skeleton")).toHaveCount(0);
    await expect(b.getByText(post.body)).toHaveCount(0);
    await expect(postCard(b, post.id)).toHaveCount(0);
  });

  await test.step("Bo can not message Bea", async () => {
    const elig = await as<{ allowed: boolean; reason: string }>(request, bob, "GET", `/dms/eligibility/${alice.id}`);
    expect(elig).toMatchObject({ allowed: false, reason: "BLOCKED" });
    const r = await request.post(`${API}/dms/threads`, { headers: { Authorization: `Bearer ${bob.accessToken}`, "X-Forwarded-For": bob.ip }, data: { userId: alice.id } });
    expect([403, 404]).toContain(r.status());
    // And Bea is not offered as a contact in Bo's messenger.
    const contacts = await as<{ user: { id: string } }[]>(request, bob, "GET", "/dms/contacts");
    expect(contacts.map((c) => c.user.id)).not.toContain(alice.id);
  });

  await a.context().close();
  await b.context().close();
});
