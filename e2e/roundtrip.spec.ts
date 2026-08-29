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
  await expect(page.locator("text=getTools({fromOrigins})")).toBeVisible();
});

test("policy classifies discovered tools without any site-specific rule", async ({ page }) => {
  await pairConsole(page);
  const row = discovered(page).locator("li", { hasText: "Add to cart" }).first();
  await expect(row.locator("text=gated")).toBeVisible();
  const readRow = discovered(page).locator("li", { hasText: "Search catalog" }).first();
  await expect(readRow.locator("text=read")).toBeVisible();
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

  await displayPage.screenshot({ path: "test-results/display-result.png" });

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

  await ctx.close();
});
