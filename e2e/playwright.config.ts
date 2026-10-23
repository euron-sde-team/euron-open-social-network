import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against the running local stack (`make up && make demo`):
 * the web app (which proxies /api and /socket.io), the API and worker, Postgres, Redis,
 * S3 and SES on the Floci emulator, and Mailpit for the mail SES relays.
 *
 *   pnpm e2e                         every spec
 *   pnpm e2e tests/02-feed.spec.ts   one spec
 *   E2E_HEADED=1 pnpm e2e            watch it
 *
 * Every spec creates its own users and communities, but they all share one stack
 * (and the platform settings 09-admin changes), so they run in a single worker.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  outputDir: ".results",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3510",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !process.env.E2E_HEADED,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
