import { expect, test } from "@playwright/test";
import { clickChoiceIn, expectReachableIn } from "./drive.js";

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
  // The claim, in the words the product now supports. It used to be about
  // turning web actions into AR, which was true of one site at a time and is
  // the smaller half of what happens when the browser holds all of them.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "everything you are signed into",
  );

  // No acronym in the headline itself. The subtitle names the protocol once,
  // which is where a judge scoring WebMCP leverage looks and where it costs a
  // stranger one clause rather than the whole hero.
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("WebMCP");
});

test("the front door offers both ways in as controls, and asks once", async ({ page }) => {
  await page.goto(SITE);

  /*
   * The same question used to be asked twice: a button and a floating
   * underlined sentence here, and the whole question again on the start card
   * behind /demo, which `?start=1` exists to skip.
   */
  const actions = page.locator("main").getByRole("link");
  await expect(actions.filter({ hasText: "Open Dusky" })).toHaveCount(1);
  await expect(actions.filter({ hasText: "I have glasses" })).toHaveCount(1);
  await expect(page.getByText(/pair them instead/i)).toHaveCount(0);

  // Requirements is a verdict, not a third way in, so it is not in that row.
  await expect(page.locator("main").getByRole("button", { name: /Requirements/ })).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: /Requirements/ }),
  ).toBeVisible();

  // And the second one lands on the card that explains pairing.
  await actions.filter({ hasText: "I have glasses" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByLabel(/send it to your Ray-Ban Display/i)).toBeVisible();
  await expect(page.getByText("The six letters on the lens.")).toBeVisible();
});

test("the requirements are one press away, and stated whether or not this browser meets them", async ({
  page,
}) => {
  await page.goto(SITE);

  // Shut by default, always. Nothing on this page opens itself over the
  // product: the button below carries the verdict whether or not it is good.
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);

  const button = page.getByRole("button", { name: /Requirements/ });
  await expect(button).toHaveAttribute("data-state", "ok");
  await expect(button).toHaveAccessibleName(/all met/);

  await button.click();
  const panel = page.getByRole("region", { name: "Requirements" });

  // All three are stated, including the two that passed. A requirement that
  // only appears once it is unmet is a requirement nobody read in time. Each
  // is a subject and this browser's answer, with no sentence between them.
  await expect(panel.getByText("WebMCP", { exact: true })).toBeVisible();
  await expect(panel.getByText("Tool registration", { exact: true })).toBeVisible();
  await expect(panel.getByText("Relay", { exact: true })).toBeVisible();
  await expect(panel.getByText("enabled", { exact: true })).toBeVisible();
  await expect(panel.getByText("connected", { exact: true })).toBeVisible();

  // And they are probed, not decorative: Chrome with the flag is exactly what
  // this suite runs, so all three have to come back met.
  await expect(panel.getByText("3/3", { exact: true })).toBeVisible();

  // It closes the way everything closes.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);
});

test("a browser that cannot run Dusky is told which part is missing, with nothing opening itself", async ({
  page,
}) => {
  // The judge who has not set the flag is the one visitor who must not have to
  // go looking. The button says which requirement failed, so the answer is on
  // screen without a panel landing over the thing they came to see.
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", { get: () => undefined, configurable: true });
  });
  await page.goto(SITE);

  const button = page.getByRole("button", { name: "WebMCP not enabled" });
  await expect(button).toHaveAttribute("data-state", "bad");
  await expect(page.getByRole("region", { name: "Requirements" })).toHaveCount(0);

  await button.click();
  const panel = page.getByRole("region", { name: "Requirements" });

  // One instruction, under the line that failed, and no paragraph above it
  // explaining why the requirement exists.
  await expect(panel.getByText(/^Turn on/)).toBeVisible();
  await expect(panel.getByText("chrome://flags/#enable-webmcp-testing")).toBeVisible();

  // Untestable is not failed. With no API there is nothing to register against,
  // and saying so beats inventing either answer.
  await expect(panel.getByText("not tested", { exact: true })).toBeVisible();
});

test("the front door carries the product, not a demonstration of it", async ({ page }) => {
  await page.goto(SITE);

  // /method is gone. It was ten rebuilds of a schema printed beside the screen
  // it compiled to, and a schema does not read at a glance: every version took
  // a minute to land an idea the page promised in five seconds. The recorded
  // demo carries that argument now, so no page here has to.
  await expect(page.getByLabel("Tool definition")).toHaveCount(0);
  await expect(page.locator("div[data-kind]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Method" })).toHaveCount(0);

  // A page arguing that six keys are enough cannot need a mouse at its door.
  const open = page.getByRole("link", { name: /Open Dusky/ });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo/);
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

  // Everything in one tab: the glasses view, EVERY partner site, the log.
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await expectReachableIn(lens, /Add to cart/);
  await expect(page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart")).toHaveText(
    "empty",
  );
  // The second business, in the same tab, at the same time. This is the claim
  // the whole product makes and it is one assertion: two sites that have never
  // heard of each other, both live, both reachable from one menu.
  await expect(page.frameLocator('iframe[title="Amber & Oak"]').getByTestId("book")).toHaveText(
    "none",
  );
  await expectReachableIn(lens, /Book table/);
  await expect(page.getByText("getTools({fromOrigins})")).toBeVisible();

  // The thing a judge must not have to discover by closing the tab. A footnote
  // at the end now, rather than a briefing sitting above the product.
  await expect(page.getByText("Closing this tab ends the session.")).toBeVisible();

  // No pair code on this page. It is a thing a wearer reads off a lens and
  // types in, and in this mode the page minted it, opened the Display and
  // paired itself. It lives on the start card, where somebody who actually
  // has glasses arrives.
  await expect(page.getByText("Pair code")).toHaveCount(0);

  // The header carries a way back and the requirements, and no session
  // plumbing. It used to print the code and the relay state, both of which the
  // page already showed below it, and a six letter code in the navigation of a
  // website reads as a glitch.
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(banner.getByText(/^[A-Z]{6}$/)).toHaveCount(0);

  // One screen. A page whose whole job is "look, it works" cannot ask anybody
  // to scroll to find out whether it did.
  await page.setViewportSize({ width: 1440, height: 900 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the demo says what you are looking at, when asked", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);
  // Seven, because both sites are held. Named rather than counted would be
  // better here, except that the count IS the claim on this page: the list is
  // one list, not one list per business.
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(7);

  // Shut by default. This page carried a paragraph about the security model
  // above the fold and a caption under every heading, all of it cut because a
  // stranger did not need any of it. Cutting it left four labelled boxes and no
  // way to find out what they are.
  await expect(page.getByRole("region", { name: "What is this" })).toHaveCount(0);

  await page.getByRole("button", { name: "What is this?" }).click();
  const what = page.getByRole("region", { name: "What is this" });

  // Every box on the page is named, including the one holding the sites. That
  // box used to be labelled with the single site's name; no business name is
  // true above a box containing another business, so it is labelled plainly.
  await expect(what.getByText("Glasses", { exact: true })).toBeVisible();
  await expect(what.getByText("Sites", { exact: true })).toBeVisible();
  await expect(what.getByText("Declared actions", { exact: true })).toBeVisible();
  await expect(what.getByText("Activity", { exact: true })).toBeVisible();

  // And the line that says what to do, which is the point of the whole panel.
  await expect(what.getByText(/Press a row on the glasses/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "What is this" })).toHaveCount(0);
});

test("somebody who owns glasses can reach the pairing form from a running session", async ({
  page,
}) => {
  /*
   * The front door's one button mints a session and embeds the panel, and the
   * pairing form lives on the start card that button skips. So a visitor who
   * actually owns a pair had no route to it at all.
   */
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(7);

  await page.getByRole("button", { name: "Pair glasses" }).click();

  await expect(page.getByRole("heading", { name: /Where do you want the screen/ })).toBeVisible();
  await expect(page.getByLabel(/send it to your Ray-Ban Display/i)).toBeVisible();
  await expect(page.getByText("The six letters on the lens.")).toBeVisible();

  // The session left the URL too, so a reload does not drop straight back into
  // the embedded panel it was just backed out of.
  await expect(page).not.toHaveURL(/session=/);
});

test("the start card still works for somebody who arrives at /demo directly", async ({ page }) => {
  // `?start=1` is what the front door links to. The card behind it is the only
  // way to pair real glasses, so it cannot quietly rot.
  await page.goto(`${SITE}/demo`);
  await page.getByRole("button", { name: /Run it in this browser/ }).click();
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expectReachableIn(page.frameLocator('iframe[title="Dusky on the glasses"]'), /Add to cart/);
});

test("a gesture in the embedded panel changes the partner site in the same tab", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  const cart = page.frameLocator('iframe[title="Verdant Market"]').getByTestId("cart");

  await clickChoiceIn(lens, /Add to cart/);
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

  /*
   * And you can SEE it change without scrolling the shop.
   *
   * The cart used to sit under the catalogue, about 200px below the fold of the
   * panel this page embeds the shop in. It is the only element that moves when
   * a tool runs, so the proof that anything happened was the one thing off
   * screen: the lens said "Add to cart done" and the shop appeared inert.
   */
  const frame = await page.locator('iframe[title="Verdant Market"]').boundingBox();
  const seat = await page
    .frameLocator('iframe[title="Verdant Market"]')
    .getByTestId("cart")
    .boundingBox();
  expect(frame).not.toBeNull();
  expect(seat).not.toBeNull();
  if (frame && seat) expect(seat.y - frame.y + seat.height).toBeLessThanOrEqual(frame.height);
});

/*
 * Found by wearing the glasses, 2026-08-28.
 *
 * The composer commits on Enter or on blur, and on real hardware neither was
 * reachable. A tap on a focused text field is taken by the OS to open its own
 * writing surface, so it never arrives as `Enter`, and `useDpad` wraps focus
 * with `% count`, which for a frame offering only the composer never moves.
 * A wearer could write `oat`, watch it sit in the field, and have no way to
 * send it. "Done" is what focus moves to, and leaving the input is what
 * commits.
 */
test("free text has somewhere for focus to go, and only once there is text", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await clickChoiceIn(lens, /Add to cart/);

  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();

  // Nothing written yet, so there is nothing to send and no row offering to.
  // A row that accepts a press and does nothing reads as a hang on a panel
  // with no cursor.
  await expect(lens.getByRole("button", { name: "Done" })).toHaveCount(0);

  await compose.fill("oat-1");

  // Now there is something to send, so there is somewhere for focus to go.
  const done = lens.getByRole("button", { name: "Done" });
  await expect(done).toBeVisible();

  // And moving focus off the input is what commits, which is the whole point:
  // clicking Done blurs the field, and the blur sends the value.
  await done.click();
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();
});

test("a tool with no arguments is not named twice on the confirm frame", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');

  // empty_cart is gated and takes no arguments, which is the combination that
  // used to print the label as the title AND as the target: the wearer read
  // "Empty cart" over "Empty cart" and had to confirm it.
  await clickChoiceIn(lens, /Empty cart/);

  await expect(lens.getByText("This cannot be undone")).toBeVisible();
  await expect(lens.getByText("Empty cart", { exact: true })).toHaveCount(1);

  // A tool that DOES take arguments still names what it is acting on, so the
  // fix removed a duplicate rather than the line. product_id is a plain string
  // on this site, so it arrives through the composer rather than as buttons.
  await lens.getByRole("button", { name: "Cancel" }).click();
  await clickChoiceIn(lens, /Add to cart/);
  const compose = lens.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("oat-1");
  await compose.press("Enter");
  await expect(lens.getByText("oat-1", { exact: true })).toBeVisible();
  await expect(lens.getByText("Add to cart", { exact: true })).toHaveCount(1);
});

/**
 * What replaced "the same tab can be pointed at a completely different site".
 *
 * That test drove the source switcher, and the switcher is gone with the
 * restriction it controlled. Its real subject survives and is stronger stated
 * this way: one tab, one session, one code, one menu, and two businesses that
 * have never heard of each other reachable from it at the same time. Pointing
 * at one site at a time was the thing being demonstrated; holding both is.
 */
test("one tab holds two unrelated businesses, on one menu", async ({ page }) => {
  await page.goto(`${SITE}/demo?start=1`);

  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');

  /*
   * Never accused of granting nothing while it is still answering.
   *
   * The sites load independently and the first discovery legitimately returns
   * zero for a site whose frame has not registered yet. The console reported
   * that as "the grant is missing", which is a real failure with a real remedy,
   * about a site that was fine. Holding several sites makes this worse rather
   * than better, because one site arriving is not evidence about another, so
   * the console now settles each origin on its own. Polled rather than asserted
   * once, because the bug lives in a window of a few hundred milliseconds and a
   * single check would step over it.
   */
  for (let i = 0; i < 12; i++) {
    await expect(page.getByText("offered nothing")).toHaveCount(0);
    await page.waitForTimeout(60);
  }

  // Both sites' actions, in one list, ordered by what a press costs rather than
  // by which business published them.
  const actions = page.getByTestId("actions");
  await expect(actions.getByText("Add to cart")).toBeVisible();
  await expect(actions.getByText("book_table")).toBeVisible();
  await expect(actions.locator("li")).toHaveCount(7);

  // And the rows say whose they are, which is the only new thing a wearer
  // needs when a menu stops belonging to one place. Counted rather than looked
  // for: EVERY row carries its site, so finding one proves nothing about the
  // other six, and the shop's four plus the restaurant's three is the whole
  // list accounted for.
  await expect(actions.getByText("Verdant Market")).toHaveCount(4);
  await expect(actions.getByText("Amber & Oak")).toHaveCount(3);

  // Same session, same panel, same code: both reachable from the one menu.
  await expectReachableIn(lens, /Add to cart/);
  await expectReachableIn(lens, /Book table/);
});
