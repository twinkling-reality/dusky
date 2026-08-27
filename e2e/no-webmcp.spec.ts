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

test("the embedded panel says the same thing, on the path a judge actually takes", async ({
  page,
}) => {
  /*
   * The test above drives ?mode=glasses, which is the path somebody with
   * hardware takes. Nobody without hardware takes it. The front door's one
   * button goes to ?start=1, which mints a session and embeds the Display, and
   * that path had no coverage here at all: an unflagged browser could have been
   * told this source "has not offered any actions", which is a claim about
   * somebody else's site made by a browser that never looked.
   */
  await page.goto("http://localhost:7803/demo?start=1");
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  const panel = lens.locator("div[data-kind]");

  await expect(panel).toContainText(/cannot reach this source/i, { timeout: 30_000 });
  await expect(panel).toContainText(/WebMCP is not enabled/i);
  await expect(panel).not.toContainText(/has not offered any actions/i);
  await expect(panel).not.toContainText(/No actions available/i);

  // Retrying, switching source and reloading all keep telling the truth. Each
  // one re-runs discovery, and each one is a chance to answer "empty" instead
  // of "could not look".
  await lens.getByRole("button", { name: /Try again/ }).click();
  await expect(panel).toContainText(/cannot reach this source/i);

  await page.getByRole("button", { name: "Amber & Oak" }).click();
  await expect(panel).toContainText(/cannot reach this source/i);
  await expect(panel).not.toContainText(/has not offered any actions/i);

  await page.reload();
  await expect(panel).toContainText(/cannot reach this source/i, { timeout: 30_000 });
});
