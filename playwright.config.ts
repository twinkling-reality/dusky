import { defineConfig } from "@playwright/test";

/**
 * WebMCP is not on by default in any stable browser, so the whole suite runs
 * against the locally installed Chrome with the testing flag enabled. That is
 * the documented way to turn WebMCP on, so CI exercises a real user's browser
 * rather than an approximation of it.
 */
export default defineConfig({
  testDir: "./e2e",
  // production.spec.ts hits the deployed system and has its own config.
  testIgnore: "production.spec.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    launchOptions: { args: ["--enable-features=WebMCPTesting"] },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @dusky/app-server start",
      url: "http://localhost:7900/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @dusky/app-market dev",
      url: "http://localhost:7801",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @dusky/app-reservations dev",
      url: "http://localhost:7804",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @dusky/app-display dev",
      url: "http://localhost:7802",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @dusky/app-console dev",
      url: "http://localhost:7803",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
