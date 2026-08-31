import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const previewPath = fileURLToPath(new URL("./visual/frame-preview.html", import.meta.url));
const preview = `http://localhost:7802/@fs${previewPath}`;

const fixtures = [
  { id: "parameter", kind: "choose", text: "Back" },
  { id: "transfer", kind: "transfer", text: "Share this information?" },
  { id: "confirmation", kind: "confirm", text: "Send message" },
  { id: "progress", kind: "result", text: "Next: Send message" },
  { id: "final", kind: "result", text: "Task complete" },
] as const;

test("critical glasses frames fit the real component and input contract", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 600 });

  for (const fixture of fixtures) {
    await page.goto(`${preview}?fixture=${fixture.id}`);
    const screen = page.locator(`[data-kind="${fixture.kind}"]`);
    await expect(screen).toBeVisible();
    await expect(page.getByText(fixture.text, { exact: false })).toBeVisible();

    const dimensions = await screen.evaluate((element) => ({
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions).toEqual({
      clientWidth: 600,
      clientHeight: 600,
      scrollWidth: 600,
      scrollHeight: 600,
    });

    const targetHeights = await screen
      .locator("button, input")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    for (const height of targetHeights) expect(height).toBeGreaterThanOrEqual(88);

    await page.screenshot({ path: `test-results/frame-${fixture.id}.png` });
  }
});
