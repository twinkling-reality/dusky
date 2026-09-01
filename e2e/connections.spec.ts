import { expect, test } from "@playwright/test";
import { clickChoiceIn } from "./drive.js";

const CONSOLE = "http://localhost:7803";

/**
 * The product-facing proof that provider configuration is not a source-code
 * registry. This drives the same live origin set that discovery, the relay,
 * the Display, and the topology all consume.
 */
test("sample and added WebMCP websites can be selected into the live graph", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?start=1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);
  await expect(page.locator('[data-node-id^="provider:"]')).toHaveCount(3);

  const websites = page.locator('button[aria-haspopup="dialog"]');
  await expect(websites).toHaveAttribute("data-tooltip", "Configure Websites");
  await expect(page.getByRole("button", { name: /^Flow:/ })).toHaveAttribute(
    "data-tooltip",
    "Switch to top-to-bottom flow",
  );
  await websites.click();
  const panel = page.getByRole("dialog", { name: "Websites" });
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();
  const connected = panel.getByRole("list", { name: "Connected Websites" });
  await expect(connected.getByText("Verdant Market", { exact: true })).toBeVisible();
  await expect(connected.getByText("Amber & Oak", { exact: true })).toBeVisible();
  await expect(connected.getByText("Northstar Dispatch", { exact: true })).toBeVisible();

  const disconnectNorthstar = panel.getByRole("button", {
    name: "Disconnect Northstar Dispatch",
  });
  await expect(disconnectNorthstar).toHaveAttribute(
    "data-tooltip",
    "Disconnect Northstar Dispatch",
  );
  await expect(panel.getByRole("button", { name: "Close Configured Websites" })).toHaveAttribute(
    "data-tooltip",
    "Close Configured Websites",
  );
  await disconnectNorthstar.click();
  await expect(page.getByRole("dialog", { name: "Websites" })).toHaveCount(0);
  await expect(websites).toBeFocused();
  await expect(page.locator('[data-node-id^="provider:"]')).toHaveCount(2);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(7);
  await expect(
    page.locator("[data-runtime-status]").getByText("7 actions", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("from 2 websites", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/connection=/);
  await expect(page).not.toHaveURL(/[?&](site|source)=/);

  await page.getByRole("button", { name: "Manage 2 connected websites" }).click();
  await page.getByLabel("Reconnect a Configured Website").selectOption("dispatch");
  await expect(page.getByRole("dialog", { name: "Websites" })).toHaveCount(0);
  await expect(page.locator('[data-node-id^="provider:"]')).toHaveCount(3);
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(11);

  await page.getByRole("button", { name: "Manage 3 connected websites" }).click();
  const configured = page.getByRole("dialog", { name: "Websites" });
  await configured.getByRole("button", { name: "Add Website" }).click();
  const addPanel = page.getByRole("region", { name: "Add Website" });
  await expect
    .poll(async () => {
      const configured = await page.getByTestId("configured-websites-panel").boundingBox();
      const add = await page.getByTestId("add-website-panel").boundingBox();
      return Math.abs((configured?.height ?? 0) - (add?.height ?? 0));
    })
    .toBeLessThan(0.5);
  const configuredBox = await page.getByTestId("configured-websites-panel").boundingBox();
  const addressBox = await page.getByTestId("add-website-panel").boundingBox();
  expect(Math.abs((configuredBox?.height ?? 0) - (addressBox?.height ?? 0))).toBeLessThan(0.5);
  await expect(addPanel.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(addPanel.getByRole("heading", { name: "Connect a Supported Site" })).toBeVisible();
  await expect(addPanel).toContainText("Regular homepages, restaurant pages, and chat URLs");
  await addPanel.getByLabel("Website URL").fill("http://localhost:7806");
  await addPanel.getByRole("button", { name: "Verify Connection" }).click();
  await expect(addPanel.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(addPanel.getByRole("heading", { name: "Name This Website" })).toBeVisible();
  await expect(addPanel.getByText("Verified", { exact: true })).toBeVisible();
  await expect(addPanel.getByText(/1 action/)).toBeVisible();
  await expect(addPanel.getByRole("button", { name: "Skip", exact: true })).toBeVisible();
  await expect(addPanel.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const nameBox = await page.getByTestId("add-website-panel").boundingBox();
      return Math.abs((nameBox?.height ?? 0) - (addressBox?.height ?? 0));
    })
    .toBeLessThan(0.5);
  await addPanel.getByRole("button", { name: "Back", exact: true }).click();
  await expect(addPanel.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(addPanel.getByLabel("Website URL")).toHaveValue("http://localhost:7806");
  await addPanel.getByRole("button", { name: "Verify Connection" }).click();
  await addPanel.getByLabel(/Display name/).fill("Canopy Lab");
  await addPanel.getByRole("button", { name: "Add Website", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Websites" })).toHaveCount(0);
  await expect(page.locator('[data-node-id^="provider:"]')).toHaveCount(4);
  const canopy = page.locator('[data-node-id="provider:http://localhost:7806"]');
  await expect(canopy).toContainText("Canopy Lab");
  await expect(page.getByText(/3 samples and 1 added website supply/)).toBeVisible();
  await expect(page.getByTestId("actions").locator("li")).toHaveCount(12);
  await expect(page.getByText("Estimate shade", { exact: true })).toBeVisible();
  await expect(page.locator("canvas[data-provider-branches]")).toHaveAttribute(
    "data-provider-branches",
    "4",
  );
  await page.getByRole("button", { name: "Manage 4 connected websites" }).click();
  const appliedPanel = page.getByRole("dialog", { name: "Websites" });
  await expect(appliedPanel.getByText("Update graph", { exact: true })).toHaveCount(0);
  await expect(appliedPanel.getByText("Will connect", { exact: true })).toHaveCount(0);
  await expect(appliedPanel.getByRole("listitem").filter({ hasText: "Canopy Lab" })).toContainText(
    "1 action",
  );
});

test("an optional website name can be skipped", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?start=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Manage 3 connected websites" }).click();
  const panel = page.getByRole("dialog", { name: "Websites" });
  await panel.getByRole("button", { name: "Add Website" }).click();
  const addPanel = page.getByRole("region", { name: "Add Website" });
  await addPanel.getByLabel("Website URL").fill("http://localhost:7806");
  await addPanel.getByRole("button", { name: "Verify Connection" }).click();
  await addPanel.getByRole("button", { name: "Skip", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Websites" })).toHaveCount(0);
  await expect(page.locator('[data-node-id="provider:http://localhost:7806"]')).toContainText(
    "localhost:7806",
  );
});

test("an ordinary tracked link explains why it cannot connect and offers grounded options", async ({
  page,
}) => {
  await page.goto(`${CONSOLE}/demo?start=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Manage 3 connected websites" }).click();
  const panel = page.getByRole("dialog", { name: "Websites" });
  await panel.getByRole("button", { name: "Add Website" }).click();
  const addPanel = page.getByRole("region", { name: "Add Website" });

  await addPanel.getByLabel("Website URL").fill("http://localhost:7802/?ref=campaign");
  await addPanel.getByRole("button", { name: "Verify Connection" }).click();
  await expect(addPanel.getByRole("status")).toContainText(/Opening|Checking|Reading/);
  await expect(addPanel.getByText("Reading available actions", { exact: true })).toBeVisible();

  const feedback = addPanel.locator("#connections-feedback");
  await expect(feedback).toContainText("This isn’t a supported connection page.");
  await expect(feedback).toContainText("If it did not give you a specific connection link");
  const cleanAddress = feedback.getByRole("button", { name: /Try Without Tracking/ });
  await expect(cleanAddress).toBeVisible();
  await cleanAddress.click();
  await expect(addPanel.getByLabel("Website URL")).toHaveValue("http://localhost:7802/");
  await expect(feedback).toHaveCount(0);
});

test("website changes cannot replace a wearer decision", async ({ page }) => {
  await page.goto(`${CONSOLE}/demo?start=1`);
  const lens = page.frameLocator('iframe[title="Dusky on the glasses"]');
  await clickChoiceIn(lens, /Add to cart/);
  const composer = lens.locator('input[type="text"]');
  await composer.fill("oat-1");
  await composer.press("Enter");
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();

  await page.getByRole("button", { name: "Manage 3 connected websites" }).click();
  const panel = page.getByRole("dialog", { name: "Websites" });
  await expect(panel.getByRole("button", { name: "Disconnect Northstar Dispatch" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Add Website" })).toBeDisabled();
  await expect(lens.getByRole("button", { name: /Confirm/ })).toBeVisible();
});
