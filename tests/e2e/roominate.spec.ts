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

test("product picture creates a preview model and places the confirmed item", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific picture-model flow");
  await page.route("**/api/v1/extract-product/screenshot", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "complete",
      message: "Picture analyzed; confirm the model and measurements.",
      product: {
        name: "Photo Chair",
        store: null,
        source_url: null,
        category: "chair",
        variant: "rust fabric",
        dimensions: { width_m: 0.62, depth_m: 0.66, height_m: 0.88 },
        price: null,
        visual_profile: {
          archetype: "chair", style: "modern", material: "fabric", silhouette: "rounded",
          has_arms: true, has_back: true, leg_style: "four_leg", color_hex: "#A65E45",
          confidence: 0.91, evidence: "Visible upholstered chair with arms and four legs",
          parts: [
            { primitive: "box", role: "seat", position: { x: 0, y: -0.08, z: 0 }, size: { x: 0.72, y: 0.12, z: 0.64 }, rotation: { x: 0, y: 0, z: 0 }, material: "fabric", color_hex: "#A65E45" },
            { primitive: "box", role: "back", position: { x: 0, y: 0.25, z: -0.27 }, size: { x: 0.72, y: 0.42, z: 0.1 }, rotation: { x: 0, y: 0, z: 0 }, material: "fabric", color_hex: "#A65E45" },
            { primitive: "box", role: "leg", position: { x: -0.28, y: -0.34, z: -0.23 }, size: { x: 0.08, y: 0.32, z: 0.08 }, rotation: { x: 0, y: 0, z: 0 }, material: "wood", color_hex: "#5D3B2E" },
            { primitive: "box", role: "leg", position: { x: 0.28, y: -0.34, z: -0.23 }, size: { x: 0.08, y: 0.32, z: 0.08 }, rotation: { x: 0, y: 0, z: 0 }, material: "wood", color_hex: "#5D3B2E" },
            { primitive: "box", role: "leg", position: { x: -0.28, y: -0.34, z: 0.23 }, size: { x: 0.08, y: 0.32, z: 0.08 }, rotation: { x: 0, y: 0, z: 0 }, material: "wood", color_hex: "#5D3B2E" },
            { primitive: "box", role: "leg", position: { x: 0.28, y: -0.34, z: 0.23 }, size: { x: 0.08, y: 0.32, z: 0.08 }, rotation: { x: 0, y: 0, z: 0 }, material: "wood", color_hex: "#5D3B2E" },
          ],
        },
      },
    }),
  }));

  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: "Products" }).first().click();
  await page.getByRole("button", { name: /Import product/ }).click();
  await page.getByRole("button", { name: "Screenshot" }).click();
  await page.getByLabel("Product picture").setInputFiles({
    name: "chair.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });

  await expect(page.getByLabel("Interactive 3D preview of Photo Chair")).toBeVisible();
  await expect(page.getByText("modern chair")).toBeVisible();
  await page.getByRole("button", { name: "Confirm & add to cart" }).click();
  await expect(page.getByText("Photo Chair")).toBeVisible();

  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("roominate.projects.v1") ?? "{}");
    const project = stored.projects?.find((candidate: { products: Array<{ name: string }> }) => candidate.products.some((product) => product.name === "Photo Chair"));
    const product = project?.products.find((candidate: { name: string }) => candidate.name === "Photo Chair");
    const item = project?.items.find((candidate: { productId: string }) => candidate.productId === product?.id);
    return { archetype: product?.visualProfile?.archetype, parts: product?.visualProfile?.parts?.length, placed: Boolean(item?.transform) };
  })).toEqual({ archetype: "chair", parts: 6, placed: true });
});

test("shortlist library items are placed into the 3D room when added", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific library placement flow");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: "Products" }).first().click();
  await page.getByPlaceholder("Search products, categories, stores…").fill("MARKUS");
  const card = page.locator("article.product-card").filter({ hasText: "MARKUS" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /^Add$/ }).click();
  await page.getByRole("button", { name: "3D Studio" }).first().click();
  await expect(page.getByRole("button", { name: /MARKUS/ })).toContainText("placed");
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("roominate.projects.v1") ?? "{}");
    const project = stored.projects?.find((candidate: { id: string }) => candidate.id === "project-demo");
    const item = project?.items.find((candidate: { productId: string }) => candidate.productId === "shortlist-markus");
    return Boolean(item?.transform?.position);
  })).toBe(true);
});

test("room analysis turns detected structure into reviewable 3D features", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific room reconstruction flow");
  await page.route("**/api/v1/analyze-room", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "complete",
      schema_version: "1.0",
      message: "Review detected structure.",
      palette: [{ hex: "#E5E0D8", label: "wall", confidence: 0.8, evidence: "Rear wall" }],
      room: {
        width_m: 3,
        length_m: 3.4,
        height_m: 2.4,
        notes: [],
        features: [{
          kind: "window", label: "Detected rear window", wall: "north", offset_ratio: 0.68,
          width_m: 1.1, depth_m: 0.08, height_m: 1, elevation_m: 0.9,
          confidence: 0.86, evidence: "Frame 1 rear wall opening",
        }],
      },
      corners: [],
      surfaces: [],
      dimension_estimates: [
        { dimension: "width", meters: 3, confidence: 1, basis: "confirmed_reference", evidence: "Confirmed" },
        { dimension: "length", meters: 3.4, confidence: 1, basis: "confirmed_reference", evidence: "Confirmed" },
        { dimension: "height", meters: 2.4, confidence: 1, basis: "confirmed_reference", evidence: "Confirmed" },
      ],
      uncertainties: [],
    }),
  }));

  await page.getByRole("button", { name: "Create a room" }).click();
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "room.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByRole("button", { name: "Analyze selected media" }).click();

  await expect(page.getByText("Detected rear window")).toBeVisible();
  await expect(page.getByText("1 structural feature modeled")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/north wall · confirmed/)).toBeVisible();
  await expect(page.locator(".capture-canvas canvas")).toBeVisible();
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
