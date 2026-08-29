/**
 * Render representative task frames through the real lens component at the
 * glasses' exact 600 by 600 viewport. This is visual review evidence, not a
 * substitute for the browser tests that drive live WebMCP.
 *
 * Needs the Display development server on port 7802.
 *
 *   node scripts/frame-review.mjs [output-directory]
 */

import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const output = process.argv[2] ?? "review/frames";
const component = `/@fs/${process.cwd()}/packages/lens/src/FrameView.tsx`;
const reviewValue =
  "Reference id: AO-4417; Party size: 4; Date: Friday; Time: 7:30 PM; Seating: indoors; Note: quiet table, please.";
mkdirSync(output, { recursive: true });

const frames = [
  {
    name: "transfer",
    frame: {
      kind: "transfer",
      source: "Dusky",
      title: "Share this information?",
      from: "Amber & Oak",
      to: "Northstar Dispatch",
      argument: "Body",
      preview: reviewValue,
      note: "This shares data only. The action is checked next.",
      choices: [
        { id: "__share", label: "Share", meta: "enter" },
        { id: "__cancel", label: "Cancel", meta: "esc", tone: "danger" },
      ],
    },
  },
  {
    name: "confirmation",
    frame: {
      kind: "confirm",
      source: "Northstar Dispatch",
      title: "Send message",
      target: `ns-dana, ${reviewValue}`,
      consequence: "This changes something on the site",
      choices: [
        { id: "__confirm", label: "Confirm", meta: "enter" },
        { id: "__cancel", label: "Cancel", meta: "esc", tone: "danger" },
      ],
    },
  },
  {
    name: "working",
    frame: {
      kind: "working",
      source: "Northstar Dispatch",
      title: "Send message",
      note: "invoking send_message",
    },
  },
  {
    name: "progress",
    frame: {
      kind: "result",
      source: "Amber & Oak",
      ok: true,
      title: "Book table done",
      facts: [
        { label: "Reference id", value: "AO-4417" },
        { label: "Party size", value: "4" },
      ],
      choices: [{ id: "__next", label: "Next: Send message", meta: "2/2" }],
      note: "Each action is checked and approved separately",
    },
  },
  {
    name: "final-result",
    frame: {
      kind: "result",
      source: "Dusky",
      ok: true,
      title: "Task complete",
      facts: [
        { label: "Amber & Oak", value: "Book table: AO-4417" },
        { label: "Northstar Dispatch", value: "Send message: MSG-001" },
      ],
      choices: [{ id: "__home", label: "Do something else", meta: "enter" }],
    },
  },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:7802");

await page.evaluate(async (componentPath) => {
  const ReactModule = await import("/@id/react");
  const React = ReactModule.default ?? ReactModule;
  const ReactDomModule = await import("/@id/react-dom/client");
  const ReactDom = ReactDomModule.default ?? ReactDomModule;
  const { FrameView } = await import(componentPath);
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const root = ReactDom.createRoot(host);
  window.__duskyFrameReview = {
    render(shown) {
      root.render(
        React.createElement(FrameView, {
          frame: shown,
          frameKey: `review-${shown.kind}`,
          keyboard: false,
          onBack: () => {},
          onChoose: () => {},
        }),
      );
    },
  };
}, component);

for (const { name, frame } of frames) {
  await page.evaluate((shown) => window.__duskyFrameReview.render(shown), frame);
  const screen = page.locator(`div[data-kind="${frame.kind}"]`);
  await screen.waitFor();
  await page.waitForTimeout(600);
  const layout = await screen.evaluate((element) => ({
    screen: element.getBoundingClientRect().toJSON(),
    choices: [...element.querySelectorAll("button")].map((button) =>
      button.getBoundingClientRect().toJSON(),
    ),
  }));
  if (layout.screen.width !== 600 || layout.screen.height !== 600) {
    throw new Error(`${name} did not render at 600 by 600`);
  }
  for (const choice of layout.choices) {
    if (choice.height < 88 || choice.top < 0 || choice.bottom > 600) {
      throw new Error(`${name} has a clipped or undersized choice`);
    }
  }
  await page.screenshot({ path: `${output}/${name}.png` });
}

await browser.close();
console.log(frames.map(({ name }) => `${output}/${name}.png`).join("\n"));
