/**
 * The picture on the front door's stage.
 *
 * A real capture of the real Display build, taken against a running system:
 * this boots a session through /demo, drives the panel to the confirmation
 * gate with the same clicks a wearer's gestures produce, and photographs
 * whatever the frame compiler derived. Nothing in it is drawn for the website,
 * and re-running this is what updates the page, so the picture cannot drift
 * away from what Dusky actually does.
 *
 * The gate is the frame worth showing. A menu is a menu on any product; a
 * consequential tool stopping dead for a human yes is the property this project
 * is built around, and it is the one frame a screenshot can carry on its own.
 *
 * Beside it now: every business Dusky is holding, live, in the same tab. The
 * gate says what the product refuses to do without you; the row of sites says
 * how much it is holding while it refuses.
 *
 * Temporary: this is a still standing in for the recording. The <img> in
 * Landing.tsx becomes a <video> and nothing else about the stage changes.
 *
 * Needs `pnpm dev`, and real Chrome with the WebMCP flag, because the console
 * cannot discover a single tool without it.
 *
 *   node scripts/stage.mjs
 */

import { chromium } from "@playwright/test";

const SITE = "http://localhost:7803";
const OUT = "apps/console/public/stage.png";

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--enable-features=WebMCPTesting"],
});
/*
 * Wide, because the stage is wide. A square photograph of the 600x600 panel is
 * the better picture of the DISPLAY, and it left a third of the front door's
 * stage as empty field on either side of it. This is the whole product in one
 * frame instead: what the wearer sees, the site the tools are running in, and
 * the protocol log, which is also the shape the recording that replaces it
 * will be.
 */
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 2,
});

await page.goto(`${SITE}/demo?start=1`);

const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');

/*
 * Into the shop first.
 *
 * Dusky holds every site at once, and seven actions do not fit a four-row
 * panel, so the menu a wearer lands on is a row per business. `Add to cart` is
 * behind the one that sells things. This step is the product, not a detour
 * around it: the frame it leads to is the same frame it always was.
 */
await lens.getByRole("button", { name: /Verdant Market/ }).click();
await lens.getByRole("button", { name: /Add to cart/ }).click();

const compose = lens.locator('input[type="text"]');
await compose.waitFor();
/*
 * Typed, not filled. `fill` sets the value and fires `change`, and the composer
 * commits on `change`: the frame then advances to the gate, the input unmounts,
 * and the Enter that follows has nothing to press. Typing fires `input` only,
 * which is what a wearer's handwriting or dictation does.
 */
await compose.pressSequentially("oat-1");
await compose.press("Enter");

// The gate. Asserted rather than waited on blindly: a capture of whatever
// happened to be on screen is how a stale or wrong frame ends up on the front
// page of the site.
await lens.getByRole("button", { name: /Confirm/ }).waitFor();

/*
 * The two columns, and nothing else on that page.
 *
 * The top of /demo is a paragraph about the security model and a table of
 * session facts. Both belong there and neither is a picture. What is worth
 * looking at is the pair below them: what the wearer sees, the site the tools
 * are actually running in, and the protocol log under it, all visibly in step.
 *
 * Marked in the DOM rather than clipped by coordinates, so the crop follows the
 * layout instead of a number that goes stale the next time that page moves.
 */
const clip = await page.evaluate(() => {
  const lens = document.querySelector('iframe[title="Dusky on the glasses"]');
  const sites = [...document.querySelectorAll("iframe[allow=tools]")];
  if (!lens || sites.length === 0) throw new Error("the columns are not all on screen");
  // The lens's own box is the 600x600 frame scaled into a smaller stage, so the
  // clip is taken from that stage rather than from the frame inside it.
  // Every partner site is in the picture, because two businesses that have
  // never heard of each other, live in one tab, is what there is to see.
  const boxes = [
    (lens.closest("div") ?? lens).getBoundingClientRect(),
    ...sites.map((s) => s.getBoundingClientRect()),
  ];
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  return {
    x: left + window.scrollX,
    y: top + window.scrollY,
    width: Math.max(...boxes.map((b) => b.right)) - left,
    height: Math.max(...boxes.map((b) => b.bottom)) - top,
  };
});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT, clip, fullPage: true });
console.log(OUT);

await browser.close();
