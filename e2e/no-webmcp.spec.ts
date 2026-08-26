import { expect, test } from "@playwright/test";

/**
 * What a wearer is told when the BROWSER is the problem.
 *
 * This file deliberately launches Chrome without the WebMCP flag, which is the
 * one condition the rest of the suite is set up to avoid. It is also the
 * likeliest condition in the wild: the flag is off by default everywhere.
 *
 * The console cannot discover anything here, and it used to report that
 * failure to the relay as an empty tool list. The glasses then said "This
 * source declared no usable tools", which is a confident claim about a site
 * that was never reached. FIELD-NOTES has a section on the last time the first
 * thing a wearer saw was untrue.
 */
test.use({ launchOptions: { args: [] } });

const CODE = "WMCPXA";

test("a browser that cannot speak WebMCP is not reported as an empty site", async ({ context }) => {
  const display = await context.newPage();
  await display.goto(`http://localhost:7802/?session=${CODE}`);

  const console_ = await context.newPage();
  await console_.goto(`http://localhost:7803/demo?session=${CODE}&mode=glasses`);

  const panel = display.locator("div[data-kind]");
  await expect(panel).toBeVisible();

  // The truth: we could not look. Generous, because the first frame only
  // arrives once the console has connected, and a cold dev server can take a
  // while to compile before it does.
  await expect(panel).toContainText(/cannot reach this source/i, { timeout: 30_000 });
  await expect(panel).toContainText(/WebMCP is not enabled/i);

  // Not a claim about somebody else's page.
  await expect(panel).not.toContainText(/declared/i);
  await expect(panel).not.toContainText(/has not offered any actions/i);
});
