import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientIp, newContext, newUser, signIn, signOut, uniq, verificationLink } from "../helpers";

test("sign up in the UI, confirm from the email, stay signed in across a reload, sign out", async ({ browser, request }) => {
  const ip = clientIp();
  const ctx = await newContext(browser, ip);
  const page = await ctx.newPage();
  const username = uniq("su");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;

  await test.step("sign up in the UI", async () => {
    await page.goto("/signup");
    await page.locator("#email").fill(email);
    await page.locator("#displayName").fill("Signup Tester");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByTestId("signup-submit").click();
    await expect(page.getByTestId("signup-check-email")).toContainText("Check your email");
    await expect(page.getByTestId("signup-check-email")).toContainText(email);
  });

  await test.step("open the emailed link and land signed in", async () => {
    const link = await verificationLink(request, email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
  });

  await test.step("the session survives a reload (refresh cookie)", async () => {
    await page.reload();
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  await test.step("sign out", async () => {
    await signOut(page);
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
  });

  await ctx.close();
});

test("a wrong password is refused, the right one signs in by username, and the session survives a reload", async ({ browser, request }) => {
  const user = await newUser(request);
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();
  const { email, username, password } = user;

  await test.step("a wrong password is refused", async () => {
    await page.goto("/login");
    await page.locator("#login").fill(email);
    await page.locator("#password").fill(`${password}-wrong`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "is not right" })).toBeVisible();
    await expect(page.getByTestId("avatar-menu")).toBeHidden();
  });

  await test.step("sign in again with the username", async () => {
    await signIn(page, { email: username, password });
    await page.reload();
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
  });

  await ctx.close();
});
