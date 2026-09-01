import { expect, type Page, test } from "@playwright/test";
import { expectReachable, focusChoice } from "./drive.js";
import { freshCode } from "./session-code.js";

/**
 * The load-bearing test for the entire product.
 *
 * A gesture on the Display must cause a real WebMCP tool to run inside the
 * partner site's own document, change that site's visible state, and return a
 * verified result to the Display. If this test passes, Dusky works. If it
 * fails, nothing else in the repository matters.
 */

const CODE = freshCode();

/**
 * A code in the URL pairs the console with no typing, which is what the
 * website's "try it now" does. `mode=glasses` suppresses the embedded panel,
 * because these tests open their own Display page and a session takes exactly
 * one Display: a second would close the first.
 */
async function pairConsole(page: Page) {
  await page.goto(`http://localhost:7803/demo?session=${CODE}&mode=glasses`);
}

/**
 * The list of tools the console actually discovered.
 *
 * Scoped deliberately, and by a test id rather than by page text. A bare
 * `getByText("Add to cart")` matched one element for as long as the console
 * had one place a tool name could appear, and became ambiguous the moment the
 * page also showed a schema being compiled. Filtering by a printed origin
 * then broke when the rows stopped printing it. A locator that depends on the
 * rest of the page staying still is a locator that breaks for reasons
 * unrelated to what it is testing.
 */
function discovered(page: Page) {
  return page.getByTestId("actions");
}

test("WebMCP is actually enabled in this browser", async ({ page }) => {
  await page.goto("http://localhost:7801");
  const kind = await page.evaluate(
    () => typeof (document as unknown as Record<string, unknown>).modelContext,
  );
  expect(kind, "run with --enable-features=WebMCPTesting").toBe("object");
});

test("console discovers the partner site's tools cross-origin", async ({ page }) => {
  await pairConsole(page);
  // Four tools, exposed to this origin only because the site named it.
  const tools = discovered(page);
  await expect(tools.getByText("Search catalog")).toBeVisible();
  await expect(tools.getByText("Add to cart")).toBeVisible();
  await expect(tools.locator("li")).toHaveCount(11);
  await expect(page.getByRole("region", { name: "Execution log" })).toBeVisible();
  await expect(page.getByText("11 actions", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("from 3 websites", { exact: true }).first()).toBeVisible();
});

test("a genuinely new runtime provider works without a rebuild or adapter", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  const code = freshCode();
  const source = JSON.stringify({
    name: "Canopy Lab",
    url: "http://localhost:7806",
  });
  const query = new URLSearchParams({
    session: code,
    mode: "glasses",
    site: source,
  });
  await consolePage.goto(`http://localhost:7803/demo?${query.toString()}`);

  // This origin and its vocabulary appear nowhere in the fixture registry.
  // The console has only its URL and the descriptors returned by WebMCP.
  const providerFrame = consolePage.locator('iframe[title="Canopy Lab"]');
  await expect(providerFrame).toHaveCount(1);
  await expect(providerFrame).toHaveAttribute("aria-hidden", "true");
  await expect(discovered(consolePage).getByText("Estimate shade")).toBeVisible();
  await expect(discovered(consolePage).getByText("Search catalog")).toHaveCount(0);
  await expect(consolePage.locator('iframe[title="Amber & Oak"]')).toHaveCount(0);
  await expect(consolePage.locator('iframe[title="Northstar Dispatch"]')).toHaveCount(0);

  await displayPage.goto(`http://localhost:7802/?session=${code}`);
  await focusChoice(displayPage, /Estimate shade/);
  await displayPage.keyboard.press("Enter");

  // The enum arrives from the unfamiliar provider's schema and becomes rows
  // without a provider-specific frame or parser inside Dusky.
  await expect(displayPage.getByRole("button", { name: /^garden$/i })).toBeVisible();
  await expect(displayPage.getByRole("button", { name: /Back/ })).toBeVisible();
  await focusChoice(displayPage, /^garden$/i);
  await displayPage.keyboard.press("Enter");

  // readOnlyHint means no confirmation. The provider's own document records
  // the real invocation and the glasses render its unfamiliar result keys.
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toHaveCount(0);
  const survey = consolePage.frameLocator('iframe[title="Canopy Lab"]').getByTestId("last-survey");
  await expect(survey).toHaveText("garden: 62% shade, healthy");
  await expect(displayPage.getByText("Survey zone")).toBeVisible();
  await expect(displayPage.getByText("garden", { exact: true })).toBeVisible();
  await expect(displayPage.getByText("Shade percent")).toBeVisible();
  await expect(displayPage.getByText("62", { exact: true })).toBeVisible();
  await expect(displayPage.getByText("Canopy condition")).toBeVisible();
  await expect(displayPage.getByText("Cart total")).toHaveCount(0);

  await ctx.close();
});

test("policy classifies discovered tools without any site-specific rule", async ({ page }) => {
  await pairConsole(page);
  const row = discovered(page).locator("li", { hasText: "Add to cart" }).first();
  await expect(row.getByText("approval required", { exact: true })).toBeVisible();
  const readRow = discovered(page).locator("li", { hasText: "Search catalog" }).first();
  await expect(readRow.getByText("no approval needed", { exact: true })).toBeVisible();
});

test("a gesture on the Display runs a real tool and changes the site", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`http://localhost:7803/demo?session=${CODE}&mode=glasses`);
  await expect(discovered(consolePage).getByText("Add to cart")).toBeVisible();

  await displayPage.goto(`http://localhost:7802/?session=${CODE}`);

  // The Display shows a menu built entirely from discovered tools, and it is
  // now built from SEVERAL sites' tools at once, so the row may be a page in.
  // Reachable is the claim, not visible: a row the wearer can get to with the
  // gestures they have is a row the product offers them.
  await expectReachable(displayPage, /Add to cart/);

  // Drive it the way the glasses do: arrow keys and Enter, nothing else.
  await focusChoice(displayPage, /Add to cart/);
  await displayPage.keyboard.press("Enter");

  // A bare string parameter opens the composer.
  const actionRow = consolePage.locator(
    '[data-topology-tool-origin="http://localhost:7801"][data-topology-tool-name="add_to_cart"]',
  );
  await expect(actionRow).toHaveAttribute("data-action-state", "preparing");
  const inputStatus = actionRow.getByText("Input on Display", { exact: true });
  await expect(inputStatus).toBeVisible();
  const inputSelectionStyle = await inputStatus.evaluate((element) => {
    const status = getComputedStyle(element);
    const row = getComputedStyle(element.closest("li")!);
    const icon = element.querySelector<HTMLElement>('[data-state="preparing"]');
    return {
      borderLeft: status.borderLeftWidth,
      borderRight: status.borderRightWidth,
      textTransform: status.textTransform,
      fontSize: Number.parseFloat(status.fontSize),
      rowPaddingTop: Number.parseFloat(row.paddingTop),
      iconWidth: icon?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(inputSelectionStyle).toMatchObject({
    borderLeft: "0px",
    borderRight: "0px",
    textTransform: "none",
  });
  expect(inputSelectionStyle.rowPaddingTop / inputSelectionStyle.fontSize).toBeGreaterThanOrEqual(
    0.4,
  );
  expect(inputSelectionStyle.iconWidth / inputSelectionStyle.fontSize).toBeGreaterThanOrEqual(1.1);
  await actionRow.screenshot({ path: "test-results/action-selection.png" });

  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");

  // add_to_cart is not read-only, so the wearer MUST be asked first.
  await expect(displayPage.getByText("Add to cart")).toBeVisible();
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();

  // Nothing has run yet: the partner site is untouched.
  const cart = consolePage.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart");
  await expect(cart).toHaveText("empty");
  await expect(actionRow).toHaveAttribute("data-action-state", "approval");
  await expect(actionRow).toContainText("Awaiting wearer approval");
  const actionSideBorders = await actionRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return { left: style.borderLeftWidth, right: style.borderRightWidth };
  });
  expect(actionSideBorders).toEqual({ left: "0px", right: "0px" });
  await expect(
    consolePage.getByRole("region", { name: "Execution log" }).getByRole("listitem"),
  ).toHaveCount(0);
  const topology = consolePage.locator("canvas[data-activity-phase]");
  await expect(topology).toHaveAttribute("data-activity-phase", "awaiting-approval");
  await expect(topology).not.toHaveAttribute("data-activity-origin", /.+/);

  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  // The site's own DOM changes, in its own document, in its own session.
  await expect(cart).toContainText("Organic oat milk");
  // And the Display reports the site's returned value, not a guess.
  await expect(displayPage.getByText(/Organic oat milk/)).toBeVisible();

  // The result frame is built from the site's OWN returned JSON: these labels
  // are its key names humanized, not anything Dusky knows about this site.
  // A site Dusky has never seen gets the same treatment or the claim is false.
  await expect(displayPage.getByText("Cart total")).toBeVisible();
  await expect(displayPage.getByText("$4.29")).toBeVisible();

  // One browser invocation is one Execution log row. Settlement updates that
  // row in place instead of appending a detached result, and the row keeps the
  // provider origin that owns the live handle.
  const technicalLog = consolePage.getByRole("region", { name: "Execution log" });
  const logRows = technicalLog.getByRole("listitem");
  await expect(logRows).toHaveCount(1);
  await expect(logRows.first()).toHaveAttribute("data-status", "succeeded");
  await expect(logRows.first()).toHaveAttribute("data-provider-hit", "true");
  await expect(logRows.first()).toHaveAttribute("data-tool-name", "add_to_cart");
  await expect(logRows.first()).toContainText("Add to cart");
  await expect(logRows.first()).toContainText("Verdant Market");
  await expect(logRows.first()).toContainText("Succeeded");
  await expect(actionRow).toHaveAttribute("data-action-state", "succeeded");
  await expect(actionRow).toHaveAttribute("data-provider-hit", "true");
  await expect(technicalLog.getByText("1 action", { exact: true })).toBeVisible();
  await expect(technicalLog).not.toContainText(
    /registry|discovery|tools changed|provider origins|localhost/i,
  );

  await consolePage.locator("[data-runtime-panel]").screenshot({
    path: "test-results/console-runtime-log-component.png",
  });
  await consolePage.screenshot({ path: "test-results/console-runtime-log.png", fullPage: true });
  await displayPage.screenshot({ path: "test-results/display-result.png" });

  await ctx.close();
});

test("a provider return with ok false is visibly failed, never painted as success", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  const code = freshCode();

  await consolePage.goto(`http://localhost:7803/demo?session=${code}&mode=glasses`);
  await expect(discovered(consolePage).getByText("Change reservation")).toBeVisible();
  await displayPage.goto(`http://localhost:7802/?session=${code}`);
  await expectReachable(displayPage, /Change reservation/);

  await focusChoice(displayPage, /Change reservation/);
  await displayPage.keyboard.press("Enter");
  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("AO-9999");
  await compose.press("Enter");
  await focusChoice(displayPage, /^6:00 PM$/);
  await displayPage.keyboard.press("Enter");
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();

  const actionRow = consolePage.locator(
    '[data-topology-tool-origin="http://localhost:7804"][data-topology-tool-name="change_reservation"]',
  );
  await expect(actionRow).toHaveAttribute("data-action-state", "approval");
  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  await expect(displayPage.getByText(/No booking called AO-9999/)).toBeVisible();
  const row = consolePage
    .getByRole("region", { name: "Execution log" })
    .getByRole("listitem")
    .filter({ hasText: "Change reservation" });
  await expect(row).toHaveAttribute("data-status", "failed");
  await expect(row).toHaveAttribute("data-provider-hit", "true");
  await expect(row).toContainText("Failed");
  await expect(row).not.toContainText("Succeeded");
  await expect(actionRow).toHaveAttribute("data-action-state", "failed");

  await ctx.close();
});

/**
 * Two invocations, one document.
 *
 * Dusky never holds a partner's state: `add_to_cart` and `review_cart` are
 * separate calls into the same live page, and the second only sees the first
 * because both ran inside that page's own React tree in the user's session.
 * If this ever fails, either the console is reloading the partner frame
 * between calls or the bridge has stopped reusing the live tool handles.
 */
test("a second tool call sees what the first one did", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  const code = freshCode();

  await consolePage.goto(`http://localhost:7803/demo?session=${code}&mode=glasses`);
  await expect(discovered(consolePage).getByText("Add to cart")).toBeVisible();

  await displayPage.goto(`http://localhost:7802/?session=${code}`);
  await expectReachable(displayPage, /Add to cart/);

  await focusChoice(displayPage, /Add to cart/);
  await displayPage.keyboard.press("Enter");
  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");
  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");
  await expect(displayPage.getByText("Cart total")).toBeVisible();

  // Back to the menu, then ask the site what it thinks is in the cart.
  await focusChoice(displayPage, /Do something else/);
  await displayPage.keyboard.press("Enter");
  await focusChoice(displayPage, /Review cart/);
  await displayPage.keyboard.press("Enter");

  // review_cart is read-only, so it runs with no gate and reports the item
  // add_to_cart put there a moment ago.
  await expect(displayPage.getByText("Organic oat milk")).toBeVisible();
  await expect(displayPage.getByText("Total")).toBeVisible();

  const logRows = consolePage.getByRole("region", { name: "Execution log" }).getByRole("listitem");
  await expect(logRows).toHaveCount(2);
  await expect(logRows.filter({ hasText: "Add to cart" })).toContainText("Succeeded");
  await expect(logRows.filter({ hasText: "Review cart" })).toContainText("Succeeded");
  await consolePage.locator("[data-runtime-panel]").screenshot({
    path: "test-results/console-runtime-log-multiple.png",
  });

  await ctx.close();
});
