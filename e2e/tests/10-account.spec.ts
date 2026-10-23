import { expect, test, type Page } from "@playwright/test";
import { newUser, pageFor, signOut, totpCode, type TestUser } from "../helpers";

async function passwordStep(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.locator("#login").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Two-factor authentication" })).toBeVisible();
}

test("two-factor: enable with the setup key, keep the recovery codes, sign in with a code and with a recovery code", async ({ browser, request }) => {
  const user = await newUser(request);
  const page = await pageFor(browser, user, "/settings?section=two-factor");

  let secret = "";
  let recovery: string[] = [];
  await test.step("enable two-factor from settings with a code computed from the key", async () => {
    const setup = page.waitForResponse((r) => r.url().endsWith("/api/auth/totp/setup"));
    await page.getByTestId("totp-start").click();
    const { secret: issued, otpauthUrl } = await (await setup).json();
    await expect(page.getByTestId("totp-qr")).toBeVisible();
    secret = (await page.getByText(issued, { exact: true }).textContent())?.trim() ?? "";
    expect(secret).toBe(issued);
    expect(new URL(otpauthUrl).searchParams.get("secret")).toBe(secret);
    await page.locator("#totp-code").fill(await totpCode(secret));
    await page.getByTestId("totp-enable").click();

    const codes = page.getByTestId("recovery-codes");
    await expect(codes.locator("li")).toHaveCount(10);
    recovery = (await codes.locator("li").allTextContents()).map((c) => c.trim());
    expect(recovery[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/i);
    await expect(page.getByTestId("recovery-done")).toBeDisabled();
    await page.getByTestId("recovery-saved").click();
    await page.getByTestId("recovery-done").click();
    await expect(page.getByTestId("totp-disable")).toBeVisible();
  });

  await test.step("sign out, then sign in with a code from the authenticator", async () => {
    await signOut(page);
    await passwordStep(page, user);
    // The next time step: the current one was spent turning two-factor on (no replays).
    await page.getByTestId("totp-input").fill(await totpCode(secret, 1));
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
  });

  await test.step("sign out, then sign in with a recovery code instead", async () => {
    await signOut(page);
    await passwordStep(page, user);
    await page.getByTestId("recovery-toggle").click();
    await page.getByTestId("recovery-code-input").fill(recovery[0]!);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
  });

  await test.step("a recovery code works only once", async () => {
    await signOut(page);
    await passwordStep(page, user);
    await page.getByTestId("recovery-toggle").click();
    await page.getByTestId("recovery-code-input").fill(recovery[0]!);
    await page.getByTestId("login-submit").click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("avatar-menu")).toBeHidden();
  });

  await page.context().close();
});
