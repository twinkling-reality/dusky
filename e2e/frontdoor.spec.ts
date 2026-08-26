import { expect, test } from "@playwright/test";

/**
 * The path a judge actually takes.
 *
 * Nobody arriving at Dusky owns a pair of glasses, and the first thing they
 * used to meet was a form asking for a code off a lens they do not have. This
 * covers the replacement: one click, no typing, everything in one tab.
 */

const SITE = "http://localhost:7803";

test("the front door states what it is, once, without an acronym in the headline", async ({
  page,
}) => {
  await page.goto(SITE);

  // Exactly one h1, and it is the page's own: the panel in the examples drops
  // to an h2 so it does not compete with the document around it.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("what your glasses show");

  // No acronym in the headline itself. The subtitle names the protocol once,
  // which is where a judge scoring WebMCP leverage looks and where it costs a
  // stranger one clause rather than the whole hero.
  // The whole opening cell, not just the headline. A stranger meeting an
  // acronym in the sentence under the headline has met it before being told
  // what Dusky is, which is what this rule was written to prevent.
  const opening = page.getByRole("heading", { level: 1 }).locator("xpath=..");
  await expect(opening).not.toContainText("WebMCP");
});

test("the requirements are one press away, and stated whether or not this browser meets them", async ({
  page,
}) => {
  await page.goto(SITE);

  // Shut by default, because this suite runs the browser that meets them and a
  // list telling a working browser that it works is a third of a front door
  // spent on nothing.
  await expect(page.getByText("This browser speaks WebMCP")).toHaveCount(0);

  // The verdict is on screen the whole time even so, so nobody has to press
  // anything to learn whether they are fine.
  const button = page.getByRole("button", { name: /Requirements/ });
  await expect(button).toHaveAttribute("data-state", "ok");
  await expect(button).toHaveAccessibleName(/all met in this browser/);

  await button.click();

  // All three are stated, including the two that passed. A requirement that
  // only appears once it is unmet is a requirement nobody read in time.
  await expect(page.getByText("This browser speaks WebMCP")).toBeVisible();
  await expect(page.getByText("Tools register and read back")).toBeVisible();
  await expect(page.getByText("Dusky's relay answers")).toBeVisible();

  // And they are probed, not decorative: Chrome with the flag is exactly what
  // this suite runs, so all three have to come back met.
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();

  // It closes the way everything closes.
  await page.keyboard.press("Escape");
  await expect(page.getByText("This browser speaks WebMCP")).toHaveCount(0);
});

test("a browser that cannot run Dusky is told so without pressing anything", async ({ page }) => {
  // The judge who has not set the flag is the one visitor who must not have to
  // find the remedy, so the panel opens itself rather than waiting to be asked.
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", { get: () => undefined, configurable: true });
  });
  await page.goto(SITE);

  await expect(page.getByRole("button", { name: /Requirements/ })).toHaveAttribute(
    "data-state",
    "bad",
  );
  await expect(page.getByText("This browser speaks WebMCP")).toBeVisible();

  // The unmet one is open on arrival, so the remedy needs no second press.
  await expect(page.getByText("chrome://flags/#enable-webmcp-testing")).toBeVisible();

  // Untestable is not failed. With no API there is nothing to register against,
  // and saying so beats inventing either answer.
  await expect(
    page.getByText("Nothing to test against until the line above passes."),
  ).toBeVisible();
});

test("the argument is a route of its own, reachable by keyboard", async ({ page }) => {
  await page.goto(SITE);

  // The front door carries the claim and the product. It does not carry the
  // proof: that was a drawer unfolding a second screenful underneath a hero,
  // which made one page pretend to be two.
  await expect(page.getByLabel("Tool definition")).toHaveCount(0);
  await expect(page.locator("div[data-kind]")).toHaveCount(0);

  // A page arguing that six keys are enough cannot need a mouse at its door.
  const open = page.getByRole("link", { name: "Proof" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/proof$/);
  await expect(page.getByLabel("Tool definition")).toBeVisible();

  // And the panel travelled with the declaration that drives it. On its own it
  // proves that something moves; next to the declaration it compiled from,
  // editable, it proves the claim the site is actually making.
  const panel = page.getByTestId("sandbox-panel");
  await expect(panel.getByRole("button", { name: /Add to cart/ })).toBeVisible();
  await page.getByRole("button", { name: /A restaurant/ }).click();
  await expect(panel.getByRole("button", { name: /Book table/ })).toBeVisible();

  // The demonstration above it needs nobody to press anything: one property
  // added to product_id, and the same code draws a composer on one side and
  // three buttons on the other.
  await expect(page.getByText("Only three values are valid")).toBeVisible();
  await expect(page.getByRole("button", { name: "oat-2" })).toBeVisible();
});

test("one click opens a running Dusky, pre-paired, with nothing else to press", async ({
  page,
}) => {
  await page.goto(SITE);
  await page.getByRole("link", { name: "Open Dusky" }).click();
  await expect(page).toHaveURL(/\/demo/);

  // No second button. The front door used to land on a page whose middle was
  // another button, which is most of why its own label had to be "the demo".
  await expect(page.getByRole("button", { name: /Try it now/ })).toHaveCount(0);

  // A code was minted and put in the URL, so the session is shareable and
  // survives a reload. `start` is spent, not carried: a link with it still in
  // would mint a second session for whoever opened it.
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expect(page).not.toHaveURL(/start=/);

  // Everything in one tab: the glasses view, the partner site, the log.
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart")).toHaveText(
    "empty",
  );
  await expect(page.getByText("getTools({fromOrigins})")).toBeVisible();

  // And the thing a judge must not have to discover by closing the tab. It is
  // the first words of a sentence now rather than the middle of one, so the
  // match cannot depend on the case of the T.
  await expect(page.getByText(/tools run/i)).toBeVisible();
  await expect(page.getByText(/closing this tab ends the session/)).toBeVisible();

  // The bar carries the live session state, and a way back to the argument.
  await expect(page.getByRole("banner").getByText(/open/)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "How it works" })).toBeVisible();
});

test("the start card still works for somebody who arrives at /demo directly", async ({ page }) => {
  // `?start=1` is what the front door links to. The card behind it is the only
  // way to pair real glasses, so it cannot quietly rot.
  await page.goto(`${SITE}/demo`);
  await page.getByRole("button", { name: /Try it now/ }).click();
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expect(
    page.frameLocator('iframe[title="Dusky on the glasses"]').getByRole("button", {
      name: /Add to cart/,
    }),
  ).toBeVisible();
});

test("a gesture in the embedded panel changes the partner site in the same tab", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo?start=1`);

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
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  await page.getByRole("button", { name: "Amber & Oak" }).click();

  // Same session, same panel, same code. A different menu, because a
  // different site declared different tools.
  await expect(lens.getByRole("button", { name: /Book table/ })).toBeVisible();
  await expect(lens.getByRole("button", { name: /Add to cart/ })).toHaveCount(0);
});
