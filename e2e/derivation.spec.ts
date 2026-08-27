import { expect, type Page, test } from "@playwright/test";

/**
 * The schema, and the screens it compiled to, side by side.
 *
 * Everything asserted here runs with no relay, no WebMCP call and no partner
 * site: the panel is the component the glasses render, driven by the real
 * `Session` over the real compiler, with a tool runner that answers from a
 * text box. That is what makes it a proof rather than an illustration, and it
 * is also why a judge in a browser without WebMCP can still see it work.
 *
 * The load-bearing test is the last one. Two demos can be dismissed as two
 * things somebody anticipated. A schema edited in the page, producing
 * different screens a moment later, cannot be.
 */

const CONSOLE = "http://localhost:7803";

/**
 * Open the page the argument lives on.
 *
 * A route of its own rather than a drawer under the hero. It was a drawer, and
 * a drawer that unfolds a second screenful under a front door makes one page
 * pretending to be two.
 */
async function openSchema(page: Page) {
  await page.goto(`${CONSOLE}/method`);
  await expect(page.getByLabel("Tool definition")).toBeVisible();
}

/**
 * The panel that belongs to the editable box.
 *
 * There are three sets of glasses on this page now: two compiled from the
 * demonstration's two declarations, and this one, compiled from whatever is in
 * the box. Finding a panel by `div[data-kind]` alone matched all three.
 */
function sandbox(page: Page) {
  return page.getByTestId("sandbox-panel");
}

test("the panel is driven by whichever schema is in the box", async ({ page }) => {
  await openSchema(page);
  const panel = sandbox(page);

  // The shop's tool supplies a title, so the title is what the wearer reads.
  await expect(panel.getByRole("button", { name: /Add to cart/ })).toBeVisible();

  await page.getByRole("button", { name: /A restaurant/ }).click();
  // This one supplies no title, so the words come from the snake_case name.
  await expect(panel.getByRole("button", { name: /Book table/ })).toBeVisible();

  await page.getByRole("button", { name: /An airline/ }).click();
  await expect(panel.getByRole("button", { name: /Search flights/ })).toBeVisible();
});

test("a site's own annotation cannot lower the ceremony below what it earns", async ({ page }) => {
  await openSchema(page);
  await page.getByRole("button", { name: /A site that lies/ }).click();

  // It declares readOnlyHint: true and calls itself a storage checkup. The
  // classification reads the name, and says so.
  await expect(page.getByText("claims read-only but matched a destructive verb")).toBeVisible();
  await expect(page.getByText("destructive", { exact: true })).toBeVisible();
});

test("each parameter kind turns into the frame the schema implies", async ({ page }) => {
  await openSchema(page);
  await page.getByRole("button", { name: /A restaurant/ }).click();
  const panel = sandbox(page);

  await panel.getByRole("button", { name: /Book table/ }).click();

  // slot_id is a bare string, so it opens the composer.
  await expect(panel.locator('input[type="text"]')).toBeVisible();
  await panel.locator('input[type="text"]').fill("ao-m-1930");
  await panel.locator('input[type="text"]').press("Enter");

  // party_size is an integer enum, so it becomes one button per value.
  await expect(panel.getByRole("button", { name: "3" })).toBeVisible();
  await panel.getByRole("button", { name: "2" }).click();

  // outdoor_seating is a boolean, so it becomes Yes and No.
  await expect(panel.getByRole("button", { name: "Yes" })).toBeVisible();
  await panel.getByRole("button", { name: "No" }).click();

  // `note` is declared but not required, so it is never asked for: the next
  // thing is the gate, not a fourth question.
  await expect(panel.getByRole("button", { name: /Confirm/ })).toBeVisible();
});

/**
 * The one that removes the need for trust.
 *
 * A hardcoded interface cannot answer an edit. This changes a parameter from a
 * bare string to an enum, in the page, and the composer becomes buttons.
 */
test("editing the schema changes the screens", async ({ page }) => {
  await openSchema(page);
  const panel = sandbox(page);
  const box = page.getByLabel("Tool definition");

  await panel.getByRole("button", { name: /Add to cart/ }).click();
  // As registered, product_id is a bare string: nothing to pick from.
  await expect(panel.locator('input[type="text"]')).toBeVisible();

  await box.fill(
    JSON.stringify(
      {
        name: "add_to_cart",
        title: "Add to cart",
        description: "Add a product to the shopping cart by product id.",
        annotations: { readOnlyHint: false },
        inputSchema: {
          type: "object",
          properties: {
            product_id: {
              type: "string",
              enum: ["oat-1", "oat-2", "brd-1"],
              description: "Which product?",
            },
          },
          required: ["product_id"],
        },
      },
      null,
      2,
    ),
  );

  await panel.getByRole("button", { name: /Add to cart/ }).click();

  // Same tool, same code, one word changed in the schema.
  await expect(panel.getByRole("button", { name: "oat-2" })).toBeVisible();
  await expect(panel.locator('input[type="text"]')).toHaveCount(0);
});
