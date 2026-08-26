import { expect, type Page, test } from "@playwright/test";

/**
 * The same Dusky, pointed at a site it has never seen.
 *
 * `roundtrip.spec.ts` proves a wearer can drive Verdant Market. This one
 * proves the claim that matters: nothing in @dusky/frames, @dusky/policy,
 * @dusky/session or apps/display knows either site exists. Amber & Oak shares
 * no vocabulary with a shop, declares a different number of tools, and returns
 * `reservation_id` and `party_size` where the market returns `cart_total`.
 * Not one line inside Dusky changed to support it.
 *
 * It also reaches three branches of the frame compiler that the market cannot,
 * because every parameter over there is a bare string: a string enum, an
 * integer enum, and a boolean. Each produces a different frame, derived from
 * the schema alone.
 *
 * NOTE: the frame's source eyebrow still reads whatever DUSKY_SOURCE says,
 * because the label has not yet been made to travel with the console
 * handshake. Nothing here asserts it.
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

/** Pair a console holding Amber & Oak rather than the market. */
async function pair(page: Page, code: string) {
  await page.goto(`http://localhost:7803/?session=${code}&source=reservations`);
  await page.getByLabel("Pairing code from your glasses").fill(code);
  await page.getByRole("button", { name: "Pair" }).click();
}

test("the console discovers a second, unrelated site cross-origin", async ({ page }) => {
  await pair(page, "RES001");

  // Three tools, and only because Amber & Oak named this origin in exposedTo.
  await expect(page.getByText("Available actions")).toBeVisible();
  await expect(page.locator("li", { hasText: "http://localhost:7804" })).toHaveCount(3);

  // The console shows what the site actually registered. One tool supplied a
  // title, the other two did not and are listed under their raw names. A tool
  // with no title used to render a blank row here, because Chrome returns an
  // empty string rather than omitting the field.
  await expect(page.getByText("Find a table")).toBeVisible();
  await expect(page.getByText("book_table")).toBeVisible();
  await expect(page.getByText("change_reservation")).toBeVisible();
});

test("policy classifies a site it has never seen, from the schema alone", async ({ page }) => {
  await pair(page, "RES002");

  // readOnlyHint honored: looking up tables changes nothing.
  const find = page.locator("li", { hasText: "Find a table" }).first();
  await expect(find.locator("text=read")).toBeVisible();

  // Not read-only, and "booking" is a domain word the policy already knew.
  // No rule was added for this site.
  const book = page.locator("li", { hasText: "book_table" }).first();
  await expect(book.locator("text=gated")).toBeVisible();

  // Default deny: nothing in change_reservation matches any lexicon, so it is
  // treated as a state change rather than waved through.
  const change = page.locator("li", { hasText: "change_reservation" }).first();
  await expect(change.locator("text=gated")).toBeVisible();
});

test("an enum in the schema becomes buttons, with no code in between", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  await pair(consolePage, "RES003");
  await expect(consolePage.getByText("Find a table")).toBeVisible();

  await displayPage.goto("http://localhost:7802/?session=RES003");

  // The menu is three tools deep, and the words come from two different
  // places: the site supplied a title for one, and `label()` derived the
  // other two from their snake_case names.
  await expect(displayPage.getByRole("button", { name: /Find a table/ })).toBeVisible();
  await expect(displayPage.getByRole("button", { name: /Book table/ })).toBeVisible();
  await expect(displayPage.getByRole("button", { name: /Change reservation/ })).toBeVisible();

  await focusChoice(displayPage, /Find a table/);
  await displayPage.keyboard.press("Enter");

  // A string enum: one button per declared value, and NO composer. The market
  // has never produced this frame because it declares no enums at all.
  await expect(displayPage.getByRole("button", { name: /tomorrow/ })).toBeVisible();
  await expect(displayPage.locator('input[type="text"]')).toHaveCount(0);
  await focusChoice(displayPage, /tomorrow/);
  await displayPage.keyboard.press("Enter");

  // An INTEGER enum, which is a different branch again: the choice ids are
  // strings on the wire and the declared number is what reaches the site.
  await expect(displayPage.getByRole("button", { name: /^2$/ })).toBeVisible();
  await focusChoice(displayPage, /2/);
  await displayPage.keyboard.press("Enter");

  // find_times is read-only, so it runs with no gate at all.
  await expect(displayPage.locator('[data-kind="result"]')).toBeVisible();
  // The facts are the site's own key names humanized, and its own values.
  await expect(displayPage.getByText("Slots")).toBeVisible();
  await expect(displayPage.getByText(/7:30 PM/)).toBeVisible();

  await ctx.close();
});

test("a booking runs, stops for a human, and reports the site's own words", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  await pair(consolePage, "RES004");
  await expect(consolePage.getByText("book_table")).toBeVisible();

  await displayPage.goto("http://localhost:7802/?session=RES004");
  await expect(displayPage.getByRole("button", { name: /Book table/ })).toBeVisible();

  await focusChoice(displayPage, /Book table/);
  await displayPage.keyboard.press("Enter");

  // A bare string still opens the composer, exactly as the market's does.
  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("ao-m-1930");
  await compose.press("Enter");

  await focusChoice(displayPage, /2/);
  await displayPage.keyboard.press("Enter");

  // A declared boolean becomes Yes and No. Nothing else could produce this
  // frame, and nothing about it mentions restaurants.
  await expect(displayPage.getByRole("button", { name: /^Yes$/ })).toBeVisible();
  await expect(displayPage.getByRole("button", { name: /^No$/ })).toBeVisible();
  await focusChoice(displayPage, /No/);
  await displayPage.keyboard.press("Enter");

  // Not read-only, so the wearer MUST be asked before anything happens.
  await expect(displayPage.getByRole("button", { name: /Confirm/ })).toBeVisible();

  // And nothing has happened: the site's own book is still empty.
  const book = consolePage.frameLocator("iframe").getByTestId("book");
  await expect(book).toHaveText("none");

  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  // The site's own DOM changes, in its own document, in its own session.
  await expect(book).toContainText("AO-4417");

  // The result frame is read out of a shape nothing in Dusky has seen. These
  // labels are the site's key names humanized, and the vocabulary is its own.
  await expect(displayPage.getByText("Reservation id")).toBeVisible();
  await expect(displayPage.getByText("AO-4417")).toBeVisible();
  await expect(displayPage.getByText("Party size")).toBeVisible();
  await expect(displayPage.getByText("Cart total")).toHaveCount(0);

  await displayPage.screenshot({ path: "test-results/display-reservation.png" });
  await ctx.close();
});

/**
 * The other half of rule 3, which the market cannot exercise.
 *
 * `add_to_cart` THROWS for an unknown product, which surfaces as a transport
 * error. `change_reservation` RETURNS `{"ok": false}` for an unknown booking,
 * which is a result, and that result is a failure. Calling it a success
 * because a value came back is the exact mistake `outcomeFromResult` exists to
 * prevent, and until this site existed nothing exercised it in a real browser.
 */
test("a returned error is reported as a failure, not as a success", async ({ browser }) => {
  const ctx = await browser.newContext();
  const consolePage = await ctx.newPage();
  const displayPage = await ctx.newPage();
  await pair(consolePage, "RES005");
  await expect(consolePage.getByText("change_reservation")).toBeVisible();

  await displayPage.goto("http://localhost:7802/?session=RES005");
  await focusChoice(displayPage, /Change reservation/);
  await displayPage.keyboard.press("Enter");

  const compose = displayPage.locator('input[type="text"]');
  await expect(compose).toBeVisible();
  await compose.fill("AO-9999");
  await compose.press("Enter");

  await focusChoice(displayPage, /9:00 PM/);
  await displayPage.keyboard.press("Enter");

  await focusChoice(displayPage, /Confirm/);
  await displayPage.keyboard.press("Enter");

  // The call came back. The wearer is still told it did not work, and told
  // what the site said about why.
  await expect(displayPage.getByText(/did not work/)).toBeVisible();
  await expect(displayPage.getByText(/No booking called AO-9999/)).toBeVisible();

  await ctx.close();
});
