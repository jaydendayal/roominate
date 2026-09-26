import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: /Make room for/ })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? [], "Browser page errors").toEqual([]);
});

test("desktop demo supports review, proposal decisions, apply, and undo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific walkthrough");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await expect(page.getByRole("heading", { name: "In the room" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();

  await page.getByRole("button", { name: "Issues" }).first().click();
  await expect(page.getByRole("heading", { name: /things deserve attention/ })).toBeVisible();
  await expect(page.getByText("Group duplicates", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Both are intentional" }).click();
  await expect(page.getByText("Group duplicates", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Better Cart" }).first().click();
  await page.getByRole("button", { name: "Generate Better Cart" }).click();
  await expect(page.getByRole("heading", { name: "Choose what to apply" })).toBeVisible();
  await expect(page.getByText("Prices and collisions recalculated in code")).toBeVisible();

  const acceptButtons = page.getByRole("button", { name: "Accept", exact: true });
  await expect(acceptButtons.first()).toBeVisible();
  const count = await acceptButtons.count();
  for (let index = 0; index < count; index += 1) await acceptButtons.nth(index).click();
  await page.getByRole("button", { name: "Apply accepted changes" }).click();
  await expect(page.getByRole("button", { name: "Generate Better Cart" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { name: "Choose what to apply" })).toBeVisible();
});

test("URL import preserves a blocked source and accepts confirmed manual fields", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific import flow");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: "Products" }).first().click();
  await page.getByRole("button", { name: /Import product/ }).click();
  await page.getByLabel("Product URL").fill("http://localhost:1234/product");
  await page.getByRole("button", { name: "Extract product details" }).click();
  await expect(page.getByRole("heading", { name: "Confirm product" })).toBeVisible();
  await page.getByLabel("Name *").fill("Confirmed Floor Lamp");
  await page.getByLabel("Store").fill("Local store");
  await page.getByLabel("Category").fill("lighting");
  await page.getByLabel("Width").fill("0.3");
  await page.getByLabel("Depth").fill("0.3");
  await page.getByLabel("Height").fill("1.4");
  await page.getByLabel("Observed price (USD)").fill("34.99");
  await page.getByRole("button", { name: "Confirm & add to cart" }).click();
  await expect(page.getByText("Confirmed Floor Lamp")).toBeVisible();
  await expect(page.getByText("$34.99")).toBeVisible();
});

test("phone layout keeps the 3D room and primary tabs usable without page overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-specific walkthrough");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".mobile-tabs")).toBeVisible();
  await page.locator(".mobile-tabs").getByRole("button", { name: "Products" }).click();
  await expect(page.getByRole("heading", { name: "Bring every store into one room." })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
