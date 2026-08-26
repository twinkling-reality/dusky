import { expect, type Page, test } from "@playwright/test";

/**
 * Drive the Display exactly as the glasses do: arrow keys move focus, Enter
 * activates. Never assume a menu order, because `getTools` ordering is the
 * browser's business and not something the product should depend on.
 */
async function focusChoice(page: Page, label: RegExp | string) {
  const matcher = typeof label === "string" ? new RegExp(label) : label;
  for (let i = 0; i < 8; i += 1) {
    const focused = await page.locator('[data-focused="true"]').textContent();
    if (focused && matcher.test(focused)) return;
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(60);
  }
  throw new Error(`never focused a choice matching ${String(label)}`);
}

/**
 * The load-bearing test for the entire product.
 *
 * A gesture on the Display must cause a real WebMCP tool to run inside the
 * partner site's own document, change that site's visible state, and return a
 * verified result to the Display. If this test passes, Dusky works. If it
 * fails, nothing else in the repository matters.
 */

const CODE = "E2E001";

async function pairConsole(page: Page) {
  await page.goto(`http://localhost:7803/?session=${CODE}`);
  await page.getByLabel("Pairing code from your glasses").fill(CODE);
  await page.getByRole("button", { name: "Pair" }).click();
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
  await expect(page.getByText("Search catalog")).toBeVisible();
  await expect(page.getByText("Add to cart")).toBeVisible();
  await expect(page.locator("text=getTools({fromOrigins})")).toBeVisible();
});

test("policy classifies discovered tools without any site-specific rule", async ({ page }) => {
  await pairConsole(page);
  const row = page.locator("li", { hasText: "Add to cart" }).first();
  await expect(row.locator("text=gated")).toBeVisible();
  const readRow = page.locator("li", { hasText: "Search catalog" }).first();
  await expect(readRow.locator("text=read")).toBeVisible();
});

test("a gesture on the Display runs a real tool and changes the site", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();

  await consolePage.goto(`http://localhost:7803/?session=${CODE}`);
  await consolePage.getByLabel("Pairing code from your glasses").fill(CODE);
  await consolePage.getByRole("button", { name: "Pair" }).click();
  await expect(consolePage.getByText("Add to cart")).toBeVisible();

  await displayPage.goto(`http://localhost:7802/?session=${CODE}`);

  // The Display shows a menu built entirely from discovered tools.
  await expect(displayPage.getByRole("button", { name: /Add to cart/ })).toBeVisible();

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
  const cart = consolePage.frameLocator("iframe").getByTestId("cart");
  await expect(cart).toHaveText("empty");

  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  // The site's own DOM changes, in its own document, in its own session.
  await expect(cart).toContainText("Organic oat milk");
  // And the Display reports the site's returned value, not a guess.
  await expect(displayPage.getByText(/Organic oat milk/)).toBeVisible();

  await ctx.close();
});
