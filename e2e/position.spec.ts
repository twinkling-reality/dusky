import { expect, test } from "@playwright/test";
import { focusChoice } from "./drive.js";
import { freshCode } from "./session-code.js";

/**
 * The wearer's own position, from the glasses into a site's argument.
 *
 * WebMCP has no ambient-context channel. `executeTool` takes the site's own
 * declared input and an AbortSignal, so a coordinate can only travel as a
 * parameter the site asked for, and it crosses into that parameter through the
 * consent frame this codebase already uses for a value leaving one party for
 * another.
 *
 * The provider here is a second page on the runtime-provider origin. It is
 * absent from the console registry, declares `latitude` and `longitude`
 * because that is what those numbers are called, and knows nothing about
 * Dusky beyond the console origin it authorizes.
 */

const PROVIDER = "http://localhost:7806/nearby.html";

/** Somewhere specific, and specific enough to recognise in a frame. */
const PORTLAND = { latitude: 45.5152, longitude: -122.6784 };

const runtimeQuery = (code: string) =>
  new URLSearchParams({
    session: code,
    mode: "glasses",
    site: JSON.stringify({ name: "Canopy Lab", url: PROVIDER }),
  }).toString();

/**
 * Each test builds its own context rather than using `test.use`, because the
 * grant has to exist before the Display page is created and two of these open
 * a console and a Display in the same context on purpose.
 */
test.describe("a coordinate the wearer approved", () => {
  test("reaches a real WebMCP tool only through an explicit transfer", async ({ browser }) => {
    const ctx = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: PORTLAND,
    });
    const consolePage = await ctx.newPage();
    const displayPage = await ctx.newPage();
    const code = freshCode();

    await consolePage.goto(`http://localhost:7803/demo?${runtimeQuery(code)}`);
    await expect(consolePage.getByTestId("actions").getByText("Survey a point")).toBeVisible();

    await displayPage.goto(`http://localhost:7802/?session=${code}`);
    await focusChoice(displayPage, /Survey a point/);
    await displayPage.keyboard.press("Enter");

    // The site's schema became a parameter frame, and because it names an axis
    // the device is offered as an answer alongside the composer.
    await expect(displayPage.getByText("Latitude?")).toBeVisible();
    // The composer is still there. The device is an extra way to answer this
    // parameter, never a replacement for writing it.
    await expect(displayPage.getByPlaceholder("Enter a value")).toBeVisible();
    await focusChoice(displayPage, /Use my location/);
    await displayPage.keyboard.press("Enter");

    // Pressing it did NOT fill the argument. It produced a consent frame that
    // names both parties, the destination field, and the exact value.
    await expect(displayPage.getByText("Share this information?")).toBeVisible();
    await expect(displayPage.getByText("Your device")).toBeVisible();
    await expect(displayPage.getByText("Canopy Lab")).toBeVisible();
    await expect(displayPage.getByText("Latitude", { exact: true })).toBeVisible();
    await expect(displayPage.getByText("45.5152")).toBeVisible();

    await focusChoice(displayPage, /Share/);
    await displayPage.keyboard.press("Enter");

    // One approval filled one argument. The second half is its own decision.
    await expect(displayPage.getByText("Longitude?")).toBeVisible();
    await focusChoice(displayPage, /Use my location/);
    await displayPage.keyboard.press("Enter");
    await expect(displayPage.getByText("-122.6784")).toBeVisible();
    await focusChoice(displayPage, /Share/);
    await displayPage.keyboard.press("Enter");

    // The provider's own document is the proof the tool really ran, with the
    // coordinates the wearer approved and at the precision they were shown.
    const survey = consolePage
      .frameLocator('iframe[title="Canopy Lab"]')
      .getByTestId("last-survey");
    await expect(survey).toContainText("45.5152, -122.6784");
    await expect(survey).toContainText("57% shade");

    // And the result came back through the ordinary generic path.
    await expect(displayPage.getByText("Survey point")).toBeVisible();
    await expect(displayPage.getByText("Shade percent")).toBeVisible();

    await ctx.close();
  });

  test("cancelling the transfer sends the site nothing", async ({ browser }) => {
    const ctx = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: PORTLAND,
    });
    const consolePage = await ctx.newPage();
    const displayPage = await ctx.newPage();
    const code = freshCode();

    await consolePage.goto(`http://localhost:7803/demo?${runtimeQuery(code)}`);
    await expect(consolePage.getByTestId("actions").getByText("Survey a point")).toBeVisible();
    await displayPage.goto(`http://localhost:7802/?session=${code}`);

    await focusChoice(displayPage, /Survey a point/);
    await displayPage.keyboard.press("Enter");
    await focusChoice(displayPage, /Use my location/);
    await displayPage.keyboard.press("Enter");
    await expect(displayPage.getByText("Share this information?")).toBeVisible();

    await focusChoice(displayPage, /Cancel/);
    await displayPage.keyboard.press("Enter");

    const survey = consolePage
      .frameLocator('iframe[title="Canopy Lab"]')
      .getByTestId("last-survey");
    await expect(survey).toContainText("No survey has run.");
    await expect(displayPage.getByText("Share this information?")).toHaveCount(0);

    await ctx.close();
  });

  /**
   * The failure this device makes worst, forced on purpose.
   *
   * `getCurrentPosition` starts its `timeout` only after permission is
   * granted, so a prompt nobody answers fires neither callback and the wearer
   * is left on a panel whose gesture acknowledgement sweeps forever. Here that
   * is reproduced directly by replacing the call with one that never answers.
   * The Display's own watchdog has to be what ends it.
   */
  test("answers on its own when the device never calls back", async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: PORTLAND,
    });
    const consolePage = await ctx.newPage();
    const displayPage = await ctx.newPage();
    const code = freshCode();

    await consolePage.goto(`http://localhost:7803/demo?${runtimeQuery(code)}`);
    await expect(consolePage.getByTestId("actions").getByText("Survey a point")).toBeVisible();

    await displayPage.addInitScript(() => {
      // Accepts the request and answers neither way, which is what an
      // unanswered permission prompt looks like from the page's side.
      navigator.geolocation.getCurrentPosition = () => {};
    });
    await displayPage.goto(`http://localhost:7802/?session=${code}`);

    await focusChoice(displayPage, /Survey a point/);
    await displayPage.keyboard.press("Enter");
    await focusChoice(displayPage, /Use my location/);
    await displayPage.keyboard.press("Enter");

    // Still on the parameter, told why, and able to write the value instead.
    await expect(displayPage.getByText("Locating took too long. Write it instead")).toBeVisible({
      timeout: 30_000,
    });
    await expect(displayPage.getByText("Latitude?")).toBeVisible();
    await expect(displayPage.getByPlaceholder("Enter a value")).toBeVisible();

    await ctx.close();
  });

  /**
   * The measurement the whole design rests on.
   *
   * `allow="tools"` delegates WebMCP and nothing else: Permissions Policy
   * defaults `geolocation` to `self`, so a provider in the console's frame
   * cannot read a position even while the browsing context around it holds the
   * grant and the top-level Display is reading one successfully. A site
   * therefore receives the wearer's position only when the wearer sends it.
   */
  test("a provider frame cannot read the position the Display can", async ({ browser }) => {
    const ctx = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: PORTLAND,
    });
    const consolePage = await ctx.newPage();
    const code = freshCode();
    await consolePage.goto(`http://localhost:7803/demo?${runtimeQuery(code)}`);

    const provider = consolePage.locator('iframe[title="Canopy Lab"]');
    await expect(provider).toHaveAttribute("allow", "tools");
    await expect(consolePage.getByTestId("actions").getByText("Survey a point")).toBeVisible();

    // PERMISSION_DENIED is code 1, and it arrives with no prompt because the
    // embedder never delegated the feature.
    const site = consolePage.frameLocator('iframe[title="Canopy Lab"]');
    await expect(site.getByTestId("site-geolocation")).toContainText("refused code 1");

    // Same context, same grant, top-level page: the reading works there.
    const displayPage = await ctx.newPage();
    await displayPage.goto(`http://localhost:7802/?session=${code}`);
    const read = await displayPage.evaluate(
      () =>
        new Promise<string>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (fix) => resolve(`ok ${fix.coords.latitude}`),
            (error) => resolve(`refused ${error.code}`),
            { timeout: 5000 },
          );
        }),
    );
    expect(read).toBe("ok 45.5152");

    await ctx.close();
  });
});
