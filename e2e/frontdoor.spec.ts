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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Turn web actions into augmented reality.",
  );

  // No acronym in the headline itself. The subtitle names the protocol once,
  // which is where a judge scoring WebMCP leverage looks and where it costs a
  // stranger one clause rather than the whole hero.
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("WebMCP");
  await expect(page.locator("main")).toContainText(
    "Dusky uses WebMCP to turn website capabilities into dynamic, actionable interfaces for AR displays.",
  );
});

test("the front door offers both ways in as controls, and asks once", async ({ page }) => {
  await page.goto(SITE);

  /*
   * The same question used to be asked twice: a button and a floating
   * underlined sentence here, then an equal-choice screen behind /demo.
   * The two routes now stay distinct all the way through the handoff.
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
  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByLabel("Six-letter pairing code")).toBeVisible();
  await expect(page.locator("#pair-instruction")).toHaveText(
    "Enter the six-letter code shown on your lens.",
  );
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
  // the whole product makes and it is one assertion: unrelated sites that have
  // never heard of each other, live and reachable from one menu.
  await expect(page.frameLocator('iframe[title="Amber & Oak"]').getByTestId("book")).toHaveText(
    "none",
  );
  await expect(
    page.frameLocator('iframe[title="Northstar Dispatch"]').getByTestId("outbox"),
  ).toHaveText("none sent");
  await expectReachableIn(lens, /Book table/);
  await expectReachableIn(lens, /Send message/);
  await page.getByRole("button", { name: "Technical log" }).click();
  await expect(page.getByText("11 tools available").first()).toBeVisible();

  // The thing a judge must not have to discover by closing the tab. A footnote
  // at the end now, rather than a briefing sitting above the product.
  await expect(page.getByText("Closing this tab ends the session.")).toBeVisible();

  // No pair code on this page. It is a thing a wearer reads off a lens and
  // types in, and in this mode the page minted it, opened the Display and
  // paired itself. It lives on the pairing page, where somebody who actually
  // has glasses arrives.
  await expect(page.getByText("Pair code")).toHaveCount(0);

  // The header carries a way back and the requirements, and no session
  // plumbing. It used to print the code and the relay state, both of which the
  // page already showed below it, and a six letter code in the navigation of a
  // website reads as a glitch.
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(banner.getByText(/^[A-Z]{6}$/)).toHaveCount(0);
  await expect(banner.getByRole("button", { name: /Technical log/ })).toHaveCount(0);

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
  // Eleven, because all three sites are held. Named rather than counted would be
  // better here, except that the count IS the claim on this page: the list is
  // one list, not one list per business.
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

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
  await expect(what.getByText("Display preview", { exact: true })).toBeVisible();
  await expect(what.getByText("Provider pages", { exact: true })).toBeVisible();
  await expect(what.getByText("Available actions", { exact: true })).toBeVisible();
  await expect(what.getByText("Runtime activity", { exact: true })).toBeVisible();

  // And the line that says what to do, which is the point of the whole panel.
  await expect(what.getByText(/Choose an action on the Display/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "What is this" })).toHaveCount(0);
});

test("somebody who owns glasses can reach the pairing form from a running session", async ({
  page,
}) => {
  /*
   * The front door's one button mints a session and embeds the panel, and the
   * pairing form lives on the page that button skips. So a visitor who
   * actually owns a pair had no route to it at all.
   */
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  await page.getByRole("button", { name: "Use Ray-Ban Display" }).click();

  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByLabel("Six-letter pairing code")).toBeVisible();
  await expect(page.locator("#pair-instruction")).toHaveText(
    "Enter the six-letter code shown on your lens.",
  );

  // The session left the URL too, so a reload does not drop straight back into
  // the embedded panel it was just backed out of.
  await expect(page).not.toHaveURL(/session=/);
});

test("the pairing page exposes the browser demo in the shared navigation", async ({ page }) => {
  // `?start=1` is what the front door links to. The page behind it is the only
  // way to pair real glasses, so it cannot quietly rot.
  await page.goto(`${SITE}/demo`);
  await expect(page.getByText("No glasses available?")).toHaveCount(0);
  const navigationGaps = await page
    .getByRole("banner")
    .getByRole("navigation")
    .evaluate((nav) => {
      const items = [...nav.children].map((item) => item.getBoundingClientRect());
      return items.slice(1).map((item, index) => item.left - items[index].right);
    });
  expect(navigationGaps).toHaveLength(2);
  expect(Math.abs(navigationGaps[0] - navigationGaps[1])).toBeLessThan(0.5);
  await page.getByRole("banner").getByRole("button", { name: "Open browser demo" }).click();
  await expect(page).toHaveURL(/session=[A-Z]{6}/);
  await expectReachableIn(page.frameLocator('iframe[title="Dusky on the glasses"]'), /Add to cart/);
});

test("the pairing code is the connection between this browser and the display", async ({
  page,
}) => {
  await page.goto(`${SITE}/demo`);

  const graph = page.getByTestId("pairing-graph");
  await expect(graph).toBeVisible();
  await expect(graph.locator('[data-side="browser"]')).toContainText("This tab");
  await expect(graph.locator('[data-side="display"]')).toContainText("Waiting for code");
  const connections = graph.locator("canvas");
  await expect(connections).toHaveAttribute("data-measured-edges", "2");
  await expect(connections).toHaveAttribute("data-orientation", "horizontal");
  await expect(page.getByText(/Choices|Confirmations|Results/)).toHaveCount(0);

  await page.getByLabel("Six-letter pairing code").fill("DUSKYA");
  await expect(graph).toHaveAttribute("data-ready", "");
  await expect(graph.locator('[data-side="display"]')).toContainText("Code ready");
  await expect(page.getByRole("button", { name: "Connect display" })).toBeEnabled();
});

test("the pairing page and topology canvas do not widen a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });

  await page.goto(`${SITE}/demo`);
  await expect(page.getByRole("heading", { name: "Connect your display." })).toBeVisible();
  await expect(page.getByTestId("pairing-graph").locator("canvas")).toHaveAttribute(
    "data-orientation",
    "vertical",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );

  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByRole("heading", { name: "Display preview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});

test("the shared motion system sequences entry and respects reduced motion", async ({ page }) => {
  await page.goto(SITE);
  const animatedEntry = await page.evaluate(() => ({
    rule: getComputedStyle(document.querySelector("#root") as Element, "::after").animationName,
    hero: getComputedStyle(document.querySelector("[data-motion-item]") as Element).animationName,
  }));
  expect(animatedEntry.rule).toBe("dusky-rule-draw");
  expect(animatedEntry.hero).toBe("dusky-item-enter");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const reducedEntry = await page.evaluate(() => ({
    rule: getComputedStyle(document.querySelector("#root") as Element, "::after").animationName,
    hero: getComputedStyle(document.querySelector("[data-motion-item]") as Element).animationName,
  }));
  expect(reducedEntry.rule).toBe("none");
  expect(reducedEntry.hero).toBe("none");

  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.locator("canvas[data-reduced-motion]")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
});

test("the topology meets the page rails and keeps provider rows distinct", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${SITE}/demo?start=1`);
    await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="topology-canvas"]');
      if (!canvas) throw new Error("Topology canvas is missing");
      const canvasBox = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      const frame = document.querySelector<HTMLElement>("#root");
      if (!frame) throw new Error("Shared page frame is missing");
      const frameBox = frame.getBoundingClientRect();
      const frameStyle = getComputedStyle(frame);
      const rail = frameBox.left + Number.parseFloat(frameStyle.borderLeftWidth);
      const route = document.querySelector<HTMLElement>('[data-motion-route="workspace"]');
      if (!route) throw new Error("Workspace route is missing");
      const pairs = Array.from(
        document.querySelectorAll<HTMLElement>('[data-topology-focus^="provider:"]'),
      );
      const boxes = pairs.map((pair) => {
        const pairBox = pair.getBoundingClientRect();
        const providerBox = pair.querySelector("figure")?.getBoundingClientRect();
        const actionBox = pair.querySelector("article")?.getBoundingClientRect();
        const actionList = pair.querySelector<HTMLElement>("article ul");
        return {
          top: pairBox.top,
          bottom: pairBox.bottom,
          height: pairBox.height,
          childBottom: Math.max(providerBox?.bottom ?? 0, actionBox?.bottom ?? 0),
          actionHeight: actionBox?.height ?? 0,
          listClientHeight: actionList?.clientHeight ?? 0,
          listScrollHeight: actionList?.scrollHeight ?? 0,
        };
      });
      return {
        rail,
        canvasLeft: canvasBox.left,
        canvasRight: canvasBox.right,
        borderWidth: style.borderTopWidth,
        radius: style.borderTopLeftRadius,
        frameBorderLeft: frameStyle.borderLeftWidth,
        frameBorderRight: frameStyle.borderRightWidth,
        sharedRuleHeight: getComputedStyle(frame, "::after").height,
        routeBorderTop: getComputedStyle(route).borderTopWidth,
        bodyRule: getComputedStyle(document.body, "::after").content,
        boxes,
      };
    });

    expect(Math.abs(geometry.canvasLeft - geometry.rail)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.canvasRight - (viewport.width - geometry.rail))).toBeLessThanOrEqual(
      1,
    );
    expect(geometry.borderWidth).toBe("0px");
    expect(geometry.radius).toBe("0px");
    expect(geometry.frameBorderLeft).toBe("1px");
    expect(geometry.frameBorderRight).toBe("1px");
    expect(geometry.sharedRuleHeight).toBe("1px");
    expect(geometry.routeBorderTop).toBe("0px");
    expect(geometry.bodyRule).toBe("none");
    geometry.boxes.forEach((box) => {
      expect(box.childBottom).toBeLessThanOrEqual(box.bottom + 1);
      expect(box.actionHeight).toBeLessThanOrEqual(box.height + 1);
    });
    expect(geometry.boxes[1]?.actionHeight).toBeLessThan((geometry.boxes[1]?.height ?? 0) - 4);
    expect(geometry.boxes[1]?.listScrollHeight).toBeLessThanOrEqual(
      (geometry.boxes[1]?.listClientHeight ?? 0) + 1,
    );
    for (let index = 1; index < geometry.boxes.length; index += 1) {
      expect(geometry.boxes[index]?.top).toBeGreaterThanOrEqual(
        (geometry.boxes[index - 1]?.bottom ?? 0) - 1,
      );
    }

    const overflowSizing = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('[data-node-id^="actions:"]');
      const list = card?.querySelector<HTMLElement>("ul");
      const row = list?.querySelector("li");
      if (!card || !list || !row) throw new Error("Action card is not measurable");
      for (let index = 0; index < 8; index += 1) list.append(row.cloneNode(true));
      return {
        cardHeight: card.getBoundingClientRect().height,
        maxHeight: Number.parseFloat(getComputedStyle(card).maxHeight),
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
      };
    });
    expect(overflowSizing.cardHeight).toBeLessThanOrEqual(overflowSizing.maxHeight + 1);
    expect(overflowSizing.scrollHeight).toBeGreaterThan(overflowSizing.clientHeight);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/demo?start=1`);
  await expect(page.getByRole("button", { name: "Flow: left to right" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
  const firstProviderTop = await page
    .locator('[data-topology-focus^="provider:"]')
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(firstProviderTop).toBeLessThan(844);

  await page.getByRole("button", { name: "Flow: left to right" }).click();
  await expect(page.getByRole("button", { name: "Flow: top to bottom" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(
    0,
  );
});

test("a lens code stays in glasses mode across a reload", async ({ page }) => {
  await page.goto(`${SITE}/demo`);

  const code = "DUSKYA";
  await page.getByLabel("Six-letter pairing code").fill(code);
  await page.getByRole("button", { name: "Connect display" }).click();

  await expect(page).toHaveURL(new RegExp(`session=${code}`));
  await expect(page).toHaveURL(/mode=glasses/);
  await expect(page.getByRole("heading", { name: "Ray-Ban Display" })).toBeVisible();
  await expect(page.locator('iframe[title="Dusky on the glasses"]')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Ray-Ban Display" })).toBeVisible();
  await expect(page.locator('iframe[title="Dusky on the glasses"]')).toHaveCount(0);
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
test("one tab holds three unrelated businesses, on one menu", async ({ page }) => {
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
  await expect(actions.getByText("Send message")).toBeVisible();
  await expect(actions.locator("li")).toHaveCount(11);

  // Actions are grouped beside the provider that exposed them, rather than
  // repeating the provider name on every row.
  await expect(
    page.getByRole("article", { name: "Verdant Market actions" }).locator("li"),
  ).toHaveCount(4);
  await expect(
    page.getByRole("article", { name: "Amber & Oak actions" }).locator("li"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("article", { name: "Northstar Dispatch actions" }).locator("li"),
  ).toHaveCount(4);
  await expect(
    page
      .getByRole("article", { name: "Verdant Market actions" })
      .getByRole("heading", { name: "4 actions" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Amber & Oak actions" })
      .getByRole("heading", { name: "3 actions" }),
  ).toBeVisible();
  await expect(actions.getByRole("heading", { name: "Available actions" })).toHaveCount(0);

  // One paired Display owns one shared Browser Runtime trunk. Runtime then
  // fans out through three independent cubic edges, while each origin retains
  // its own measured capability relationship.
  await expect(page.locator('[data-runtime-end="display"]')).toHaveCount(1);
  await expect(page.locator('[data-runtime-end="browser"]')).toHaveCount(1);
  await expect(page.locator('[data-provider-end="runtime"]')).toHaveCount(1);
  await expect(page.locator("[data-provider-origin]")).toHaveCount(3);
  const connections = page.locator("canvas[data-runtime-edges]");
  await expect(connections).toHaveAttribute("data-runtime-trunks", "1");
  await expect(connections).toHaveAttribute("data-provider-buses", "0");
  await expect(connections).toHaveAttribute("data-provider-branches", "3");
  await expect(connections).toHaveAttribute("data-runtime-edges", "4");
  await expect(connections).toHaveAttribute("data-action-edges", "3");
  await expect(connections).toHaveAttribute("data-connected-origins", "3");
  await expect(connections).toHaveAttribute("data-activity-edges", "1");

  // A node drag only repositions that logical group. It no longer masquerades
  // as a canvas pan and pull every other component along with it.
  const displayNode = page.locator('[data-node-id="display"]');
  const runtimeNode = page.locator('[data-node-id="runtime"]');
  const providerNode = page.locator('[data-node-id^="provider:"]').first();
  const actionNode = page.locator('[data-node-id^="actions:"]').first();
  const displayBefore = await displayNode.boundingBox();
  const runtimeBefore = await runtimeNode.boundingBox();
  const providerBefore = await providerNode.boundingBox();
  const actionBefore = await actionNode.boundingBox();
  expect(displayBefore).not.toBeNull();
  expect(runtimeBefore).not.toBeNull();
  expect(providerBefore).not.toBeNull();
  expect(actionBefore).not.toBeNull();
  if (displayBefore && runtimeBefore && providerBefore && actionBefore) {
    const actionHandleBox = await actionNode.getByRole("heading").boundingBox();
    expect(actionHandleBox).not.toBeNull();
    if (!actionHandleBox) throw new Error("Action card drag handle was not measurable");
    await page.mouse.move(
      actionHandleBox.x + actionHandleBox.width / 2,
      actionHandleBox.y + actionHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      actionHandleBox.x + actionHandleBox.width / 2 + 54,
      actionHandleBox.y + actionHandleBox.height / 2 + 24,
      { steps: 5 },
    );
    await page.mouse.up();

    const displayAfter = await displayNode.boundingBox();
    const runtimeAfter = await runtimeNode.boundingBox();
    const providerAfter = await providerNode.boundingBox();
    const actionAfter = await actionNode.boundingBox();
    expect(displayAfter?.x).toBeCloseTo(displayBefore.x, 0);
    expect(displayAfter?.y).toBeCloseTo(displayBefore.y, 0);
    expect(runtimeAfter?.x).toBeCloseTo(runtimeBefore.x, 0);
    expect(runtimeAfter?.y).toBeCloseTo(runtimeBefore.y, 0);
    expect(providerAfter?.x).toBeCloseTo(providerBefore.x, 0);
    expect(providerAfter?.y).toBeCloseTo(providerBefore.y, 0);
    expect(actionAfter?.x).toBeCloseTo(actionBefore.x + 54, 0);
    expect(actionAfter?.y).toBeCloseTo(actionBefore.y + 24, 0);

    await page.getByRole("button", { name: "Center" }).click();
    await expect(actionNode).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  }

  // Like the reference orchestration canvas, placement is deterministic but
  // the viewer can change the reading direction and pan the open field.
  const layout = page.getByRole("button", { name: "Flow: left to right" });
  await layout.click();
  await expect(page.getByRole("button", { name: "Flow: top to bottom" })).toBeVisible();
  await page.getByRole("button", { name: "Flow: top to bottom" }).click();
  await expect(layout).toBeVisible();

  const canvas = page.getByTestId("topology-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + 90);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + 125, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Center" })).toBeVisible();
  }

  // Same session, same panel, same code: both reachable from the one menu.
  await expectReachableIn(lens, /Add to cart/);
  await expectReachableIn(lens, /Book table/);
  await expectReachableIn(lens, /Send message/);
});
