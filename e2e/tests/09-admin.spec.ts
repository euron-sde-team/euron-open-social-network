import { expect, test } from "@playwright/test";
import { apiLogin, as, DEMO, newUser, pageFor, uniq, type TestUser } from "../helpers";

type Settings = { communityCreation: "EVERYONE" | "STAFF" };

let admin: TestUser;
let original: Settings["communityCreation"] = "EVERYONE";

test.beforeAll(async ({ request }) => {
  admin = await apiLogin(request, DEMO.admin);
  original = (await as<Settings>(request, admin, "GET", "/admin/settings")).communityCreation;
});

// Put the platform back however the test ends, so later specs can create communities.
// (A STAFF value found up front can only be left over from an interrupted run.)
test.afterAll(async ({ request }) => {
  await as(request, admin, "PATCH", "/admin/settings", { communityCreation: original === "STAFF" ? "EVERYONE" : original });
});

test("an admin limits community creation to staff, and a member then sees the restriction", async ({ browser, request }) => {
  const member = await newUser(request);

  const a = await pageFor(browser, admin, "/admin?tab=settings");
  await test.step("the admin sets 'Who can create communities' to moderators and admins", async () => {
    await a.locator("#communityCreation").click();
    await a.getByRole("option", { name: "Moderators and admins" }).click();
    const saved = a.waitForResponse((r) => r.url().endsWith("/api/admin/settings") && r.request().method() === "PATCH");
    await a.getByTestId("admin-settings-save").click();
    expect((await saved).status()).toBe(200);
    expect((await as<Settings>(request, admin, "GET", "/admin/settings")).communityCreation).toBe("STAFF");
  });

  const m = await pageFor(browser, member, "/communities/new");
  await test.step("a member trying to create a community gets the restriction copy", async () => {
    await m.getByTestId("community-form").getByTestId("community-name").fill(`Not allowed ${uniq("x")}`);
    await m.getByTestId("community-submit").click();
    const restricted = m.getByTestId("community-creation-restricted");
    await expect(restricted).toContainText("Community creation is limited on this network");
    await expect(restricted.getByRole("link", { name: "Browse communities" })).toBeVisible();
  });

  await test.step("the admin restores the setting in the UI and the member can create again", async () => {
    await a.reload();
    await a.locator("#communityCreation").click();
    await a.getByRole("option", { name: "Everyone" }).click();
    const saved = a.waitForResponse((r) => r.url().endsWith("/api/admin/settings") && r.request().method() === "PATCH");
    await a.getByTestId("admin-settings-save").click();
    expect((await saved).status()).toBe(200);
    await m.goto("/communities/new");
    await m.getByTestId("community-form").getByTestId("community-name").fill(`Allowed again ${uniq("y")}`);
    await m.getByTestId("community-submit").click();
    await expect(m).toHaveURL(/\/c\/allowed-again-/);
  });

  await a.context().close();
  await m.context().close();
});
