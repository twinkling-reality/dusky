import { expect, test } from "@playwright/test";

/**
 * The path a judge actually takes.
 *
 * Nobody arriving at Dusky owns a pair of glasses, and the first thing they
 * used to meet was a form asking for a code off a lens they do not have. This
 * covers the replacement: one click, no typing, everything in one tab.
 */

const SITE = "http://localhost:7803";

test("the front door states the browser requirement before anything breaks", async ({ page }) => {
  await page.goto(SITE);

  // Exactly one h1, and it is the page's own: the embedded panel drops to an
  // h2 so it does not compete with the document it is sitting inside.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("web made of tools");
  // Stated up front, next to the pitch, rather than discovered on failure.
  await expect(page.getByText("chrome://flags/#enable-webmcp-testing").first()).toBeVisible();
  // And the argument itself is on the front page, where it needs no WebMCP.
  await expect(page.getByText("What the site declared, and what Dusky made of it")).toBeVisible();
});

test("the checklist probes this browser and collapses when it is happy", async ({ page }) => {
  await page.goto(SITE);
  // Chrome with the flag is exactly what this suite runs, so every check
  // should pass and the panel should reduce itself to one line.
  await expect(page.getByText("Everything this needs is working in this browser")).toBeVisible();

  await page.getByRole("button", { name: "show the checks" }).click();
  await expect(page.getByText("This browser speaks WebMCP")).toBeVisible();
  await expect(page.getByText("Tools can be registered and read back")).toBeVisible();
  await expect(page.getByText("Dusky's session relay is reachable")).toBeVisible();
});

test("one click opens a working demo, pre-paired, with no typing", async ({ page }) => {
  await page.goto(SITE);
  // Two routes to the demo on purpose: the hero, and a sticky bar that stays
  // reachable after a long scroll through the derivation and the prose.
  await expect(page.getByRole("link", { name: /Try it now/ })).toHaveCount(2);
  await page
    .getByRole("banner")
    .getByRole("link", { name: /Try it now/ })
    .click();
  await expect(page).toHaveURL(/\/demo$/);

  await page.getByRole("button", { name: /Try it now/ }).click();

  // A code was minted and put in the URL, so the session is shareable and
  // survives a reload.
  await expect(page).toHaveURL(/session=[A-Z]{6}/);

  // Everything in one tab: the glasses view, the partner site, the log.
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart")).toHaveText(
    "empty",
  );
  await expect(page.getByText("getTools({fromOrigins})")).toBeVisible();

  // And the thing a judge must not have to discover by closing the tab.
  await expect(page.getByText(/tools run/)).toBeVisible();
  await expect(page.getByText(/closing this tab ends the session/)).toBeVisible();

  // The bar carries the live session state, and a way back to the argument.
  await expect(page.getByRole("banner").getByText(/open/)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "How it works" })).toBeVisible();
});

test("a gesture in the embedded panel changes the partner site in the same tab", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo`);
  await page.getByRole("button", { name: /Try it now/ }).click();

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  const cart = page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart");

  await lens.getByRole("button", { name: /Add to cart/ }).click();
  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");

  // Gated, so nothing has happened yet.
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();
  await expect(cart).toHaveText("empty");

  await lens.getByRole("button", { name: /Confirm/ }).click();
  await expect(cart).toContainText("Organic oat milk");
  await expect(lens.getByText("Cart total")).toBeVisible();
});

test("the same tab can be pointed at a completely different site", async ({ page }) => {
  await page.goto(`${SITE}/demo`);
  await page.getByRole("button", { name: /Try it now/ }).click();

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  await page.getByRole("button", { name: "Amber & Oak" }).click();

  // Same session, same panel, same code. A different menu, because a
  // different site declared different tools.
  await expect(lens.getByRole("button", { name: /Book table/ })).toBeVisible();
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toHaveCount(0);
});
