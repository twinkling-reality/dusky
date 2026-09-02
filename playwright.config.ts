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
  /*
   * Retries in CI only, and never locally.
   *
   * A shared runner is roughly ten times slower than this laptop: the booking
   * walk takes 1.7s here and 17.2s there, which is close enough to the 15s
   * expect ceiling that a slow frame loses the race. It failed twice in four
   * runs on commits that provably could not have caused it, and a gate that
   * red-lights half the time stops being read.
   *
   * Retrying does not hide it. Playwright reports a test that passed on retry
   * as FLAKY, distinct from passed, so the signal survives while the block
   * does not. Zero locally, because a flake on this machine is a real finding
   * and should not be smoothed over.
   */
  retries: process.env["CI"] ? 2 : 0,
  /*
   * The HTML reporter exists so CI has something to upload.
   *
   * `trace: retain-on-failure` has been writing traces to `test-results/` all
   * along, and the workflow was uploading `playwright-report/`, which the list
   * reporter never creates. Every failed run therefore attached nothing, and
   * this flake went four runs without anyone being able to see the frame that
   * was actually on screen.
   */
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : [["list"]],
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
      command: "pnpm --filter @dusky/app-dispatch dev",
      url: "http://localhost:7805",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command:
        "pnpm --filter @dusky/app-market exec vite ../../e2e/runtime-provider --host 127.0.0.1 --port 7806 --strictPort",
      url: "http://localhost:7806",
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
