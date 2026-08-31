import { expect, test } from "@playwright/test";
import { freshCode } from "./session-code.js";

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

test("a browser that cannot speak WebMCP is not reported as an empty site", async ({ context }) => {
  // A relay may be reused across local Playwright invocations. A fresh code
  // keeps this test from reconnecting to task state left by an earlier run.
  const code = freshCode();
  const display = await context.newPage();
  await display.goto(`http://localhost:7802/?session=${code}`);

  const console_ = await context.newPage();
  await console_.goto(`http://localhost:7803/demo?session=${code}&mode=glasses`);

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

  // Retrying and reloading both keep telling the truth. Each one re-runs
  // discovery, and each one is a chance to answer "empty" instead of "could not
  // look". There used to be a third way in, clicking the source switcher, and
  // that control is gone with the restriction it controlled.
  await lens.getByRole("button", { name: /Try again/ }).click();
  await expect(panel).toContainText(/cannot reach this source/i);
  await expect(panel).not.toContainText(/has not offered any actions/i);

  await page.reload();
  await expect(panel).toContainText(/cannot reach this source/i, { timeout: 30_000 });

  /*
   * And no site is singled out as the one that failed.
   *
   * A browser with no WebMCP never reached ANY of them, so naming one would be
   * a confident statement about a particular business made by something that
   * never looked at it. The console's list says the same thing once per site,
   * and every one of them is about what arrived here rather than about what
   * anybody published.
   */
  const actions = page.getByTestId("actions");
  await expect(actions.getByText(/offered nothing/)).toHaveCount(0);
  await expect(actions.getByText(/exposedTo/)).toHaveCount(0);
  // What it says instead, once per site: it could not read. True of a browser
  // that never reached any of them, and true whatever those sites published.
  await expect(actions.getByText(/Could not read this page’s actions/)).toHaveCount(3);
});
