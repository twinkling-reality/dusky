import { defineConfig } from "@playwright/test";

/**
 * The same round trip, against the deployed system.
 *
 * `playwright.config.ts` starts four local servers and proves the code works.
 * This one starts nothing and proves the DEPLOYMENT works, which is a
 * different claim: it exercises the real relay over `wss://`, the real
 * cross-origin `exposedTo` grant between two `.vercel.app` origins, and the
 * real Vercel build output rather than a dev server.
 *
 * Run it after any deploy that changes a URL or an environment variable:
 *
 *   pnpm test:prod
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "production.spec.ts",
  // Deployed hops are slower than localhost, and a cold relay is slower again.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    launchOptions: { args: ["--enable-features=WebMCPTesting"] },
    trace: "retain-on-failure",
  },
});
