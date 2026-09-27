import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your rooms" })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? [], "Browser page errors").toEqual([]);
});

test("desktop demo supports review, proposal decisions, apply, and undo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific walkthrough");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await expect(page.getByRole("heading", { name: "In the room" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("checkbox", { name: "Snap furniture" }).click();
  await expect(page.getByRole("checkbox", { name: "Snap furniture" })).toBeChecked();

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

test("collapsed navigation labels its icons and checkout links to each product", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific checkout flow");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.setViewportSize({ width: 900, height: 800 });

  const productsTab = page.getByRole("button", { name: "Products", exact: true }).first();
  await productsTab.hover();
  await expect(productsTab.locator(".nav-tooltip")).toHaveText("Products");
  await expect(productsTab.locator(".nav-tooltip")).toBeVisible();
  await productsTab.click();

  await page.getByRole("button", { name: /Group cart/ }).click();
  await page.getByRole("button", { name: "Checkout by store" }).click();
  await expect(page.getByRole("heading", { name: "Finish each order at its store." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Visit store/ }).first()).toBeVisible();
  const ikea = page.locator("article.checkout-store.ikea");
  await expect(ikea.getByRole("link", { name: /View product/ }).first()).toHaveAttribute("href", /ikea\.com\/us\/en\/p\//);
});

test("3D Studio exposes the door as a perimeter-editable room feature", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific room feature flow");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: /Entry door.*Room feature/ }).click();

  await expect(page.getByText("Selected room feature")).toBeVisible();
  await expect(page.getByText(/Drag the door in the 3D room/)).toBeVisible();
  await expect(page.getByText(/Door position is constrained to the room boundary/)).toBeVisible();

  await page.getByRole("button", { name: "Add door" }).click();
  await expect(page.getByRole("button", { name: /Door 2.*Room feature/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Door 2" })).toBeVisible();
});

test("AI layout generation selects a collision-tested whole-room candidate", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific layout flow");
  await page.route("**/api/v1/recommend-layout", (route) => {
    const body = route.request().postDataJSON();
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0].positions.length).toBeGreaterThan(0);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "complete", schema_version: "1.0", processing_status: "complete",
        candidate_id: body.candidates[0].candidate_id,
        rationale: "Selected the clearest collision-tested arrangement.",
      }),
    });
  });
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: "Generate optimal layout" }).click();
  await expect(page.getByText(/Selected the clearest collision-tested arrangement/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/locked items stayed fixed/i)).toBeVisible();
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

test("shop items are placed into the 3D room when added", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific shop placement flow");
  await page.getByRole("button", { name: "Open room" }).first().click();
  await page.getByRole("button", { name: "Products" }).first().click();
  const card = page.locator("article.listing-card").filter({ has: page.getByRole("heading", { name: /^MARKUS/ }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Add to Roominate" }).click();
  await page.getByRole("button", { name: "3D Studio" }).first().click();
  // Anchored so it matches the item row, not the row's "Lock position and rotation of MARKUS" button.
  await expect(page.getByRole("button", { name: /^MARKUS/ })).toContainText("placed");
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("roominate.projects.v1") ?? "{}");
    const project = stored.projects?.find((candidate: { id: string }) => candidate.id === "project-demo");
    const item = project?.items.find((candidate: { productId: string }) => candidate.productId === "shortlist-markus");
    return Boolean(item?.transform?.position);
  })).toBe(true);
});

test("floor plan scan traces an L-shaped room and scales it from a printed wall length", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific floor plan flow");
  await page.route("**/api/v1/read-floor-plan", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "complete",
      schema_version: "1.0",
      processing_status: "complete",
      message: "Choose which printed dimensions to use. Doors and windows are added unconfirmed.",
      dimensions: [{ text: "12'-0\"", meters: 3.6576, spans: "wall", wall_label: "A", confidence: 0.9, evidence: "Label above the top wall" }],
      openings: [{ kind: "door", label: "Plan entry door", wall_label: "B", position: { x: 0.835, y: 0.28 }, width_ratio: 0.4, confidence: 0.8, evidence: "Swing arc on wall B" }],
      uncertainties: [],
    }),
  }));

  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByRole("button", { name: /Read a floor plan or diagram/ }).click();
  await page.getByLabel("Choose a floor plan image").setInputFiles(path.join(__dirname, "fixtures", "floor-plan-l-room.png"));
  await expect(page.getByRole("heading", { name: "Check the traced walls" })).toBeVisible();
  // An L has six walls, but the simplified form shows only the one wall being measured.
  await expect(page.locator(".plan-wall-tag")).toHaveCount(6);
  await page.getByLabel("Choose wall to measure").selectOption("F");
  await expect(page.getByLabel(/Measured length of wall F/)).toBeVisible();
  await expect(page.getByText("Scale not measured.")).toBeVisible();

  await page.getByRole("button", { name: "Read printed dimensions with AI" }).click();
  await page.getByRole("list", { name: "Printed dimensions" }).getByRole("button", { name: "Use" }).click();
  await expect(page.getByText("Measured scale.")).toBeVisible();
  await expect(page.getByLabel(/Measured length of wall A/)).toHaveValue("12");
  await page.getByRole("button", { name: "Use this shape" }).click();

  await expect(page.getByRole("heading", { name: "Check the traced walls" })).toHaveCount(0);
  await expect(page.getByText("Traced shape", { exact: true })).toBeVisible();
  await expect(page.getByText(/^6 walls/)).toBeVisible();
  await expect(page.getByLabel("Overall width")).toHaveValue("12");
  await expect(page.getByText("Plan entry door")).toBeVisible();
  await expect(page.getByText(/east wall · needs review/)).toBeVisible();
  await expect(page.locator(".capture-canvas canvas")).toBeVisible();

  // Typing a measured length keeps the traced proportions.
  const length = Number(await page.getByLabel("Overall length").inputValue());
  await page.getByLabel("Overall width").fill("24");
  await page.getByLabel("Overall width").blur();
  await expect.poll(async () => Number(await page.getByLabel("Overall length").inputValue())).toBeCloseTo(length * 2, 1);
});

test("official dorm research applies unconfirmed room and furniture dimensions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-specific dorm research flow");
  let requestCount = 0;
  await page.route("**/api/v1/research-dorm", (route) => {
    requestCount += 1;
    const request = route.request().postDataJSON();
    expect(request.college).toBe("Georgia Institute of Technology");
    expect(request.residence_hall).toBe("Glenn Hall");
    expect(request.room_type).toBe("Traditional double");
    if (requestCount === 1) {
      expect(request.urls).toEqual([]);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "partial", schema_version: "1.0", processing_status: "partial",
          college: request.college, residence_hall: request.residence_hall, room_type: null,
          room_width_m: null, room_length_m: null, room_height_m: null, room_confidence: 0,
          room_evidence: [], items: [], uncertainties: ["No dimensions were published on the discovered page."],
          sources: [], discovered_sources: [{ url: "https://housing.gatech.edu/glenn", title: "Glenn Hall" }], failures: [],
          needs_manual_sources: true,
          message: "The automatic search found pages, but no useful dimensions. Add an official housing or furniture link.",
        }),
      });
    }
    expect(request.urls).toEqual(["https://housing.gatech.edu/glenn-dimensions"]);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "complete",
        schema_version: "1.0",
        processing_status: "complete",
        college: "Georgia Institute of Technology",
        residence_hall: "Glenn Hall",
        room_type: "Traditional double",
        room_width_m: 3.65,
        room_length_m: 4.57,
        room_height_m: 2.44,
        room_confidence: 0.91,
        room_evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Room dimensions are 12 by 15 feet." }],
        items: [
          { name: "Twin Bed extra-long mattress", category: "bed", width_m: 0.9652, depth_m: 2.1717, height_m: null, quantity: 2, included_with_room: true, confidence: 0.9, evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Twin extra-long mattress 38 by 85.5 inches." }] },
          { name: "Housing-provided desk", category: "desk", width_m: 1.0668, depth_m: 0.6096, height_m: 0.762, quantity: 1, included_with_room: true, confidence: 0.9, evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Desk 42 by 24 by 30 inches." }] },
          { name: "Desk chair", category: "chair", width_m: 0.508, depth_m: 0.5842, height_m: 0.8382, quantity: 1, included_with_room: true, confidence: 0.9, evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Desk chair 20 by 23 by 33 inches." }] },
          { name: "Dresser", category: "dresser", width_m: 0.762, depth_m: 0.6096, height_m: 0.762, quantity: 1, included_with_room: true, confidence: 0.9, evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Dresser 30 by 24 by 30 inches." }] },
          { name: "Wardrobe", category: "wardrobe", width_m: 0.9144, depth_m: 0.6096, height_m: 1.9304, quantity: 1, included_with_room: true, confidence: 0.9, evidence: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", quote: "Wardrobe 36 by 24 by 76 inches." }] },
        ],
        uncertainties: ["Confirm the room assignment and layout."],
        sources: [{ source_url: "https://housing.gatech.edu/glenn-dimensions", raw_hash: "abc", fetched_at: "2026-09-26", fetch_method: "http" }],
        discovered_sources: [],
        failures: [],
        needs_manual_sources: false,
        message: "Review and confirm every extracted measurement before using it for fit decisions.",
      }),
    });
  });

  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("School").fill("Georgia Institute of Technology");
  await page.getByLabel("Dorm or residence hall").fill("Glenn Hall");
  await page.getByLabel(/Room design or type/).fill("Traditional double");
  await expect(page.getByLabel("Official housing or furniture links")).toHaveCount(0);
  await page.getByRole("button", { name: "Search official dorm sources" }).click();
  await expect(page.getByText(/no useful dimensions/i)).toBeVisible();
  await page.getByRole("button", { name: "Upload diagram" }).click();
  await expect(page.getByRole("heading", { name: "Read your room from a screenshot" })).toBeVisible();
  await page.getByRole("button", { name: "Close floor plan scan" }).click();
  await page.getByLabel("Official housing or furniture links").fill("https://housing.gatech.edu/glenn-dimensions");
  await page.getByRole("button", { name: "Research with added links" }).click();
  await expect(page.getByText("Traditional double · 91% evidence confidence")).toBeVisible();
  await expect(page.getByRole("button", { name: /Added to 3D room/ })).toBeVisible();
  await expect(page.getByText(/Dorm research applied as unconfirmed evidence/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("roominate.projects.v1") ?? "{}");
    const project = stored.projects?.find((candidate: { name: string }) => candidate.name === "Untitled room");
    const product = project?.products.find((candidate: { name: string }) => candidate.name === "Housing-provided desk");
    const desks = project?.items.filter((item: { productId: string }) => item.productId === product?.id) ?? [];
    const dormProducts = project?.products.filter((candidate: { tags: string[] }) => candidate.tags.some((tag) => tag.startsWith("dorm-source-"))) ?? [];
    const dormProductIds = new Set(dormProducts.map((candidate: { id: string }) => candidate.id));
    const dormItems = project?.items.filter((item: { productId: string }) => dormProductIds.has(item.productId)) ?? [];
    const bedProduct = dormProducts.find((candidate: { category: string }) => candidate.category === "bed");
    return {
      width: project?.room.width,
      source: project?.room.dimensionEvidence.width.source,
      confirmed: project?.room.dimensionEvidence.width.confirmedByUser,
      productWidth: product?.dimensions.width,
      placedDesks: desks.filter((item: { transform: unknown }) => item.transform).length,
      distinctPositions: new Set(desks.map((item: { transform?: { position: { x: number; y: number } } }) => `${item.transform?.position.x},${item.transform?.position.y}`)).size,
      dormItems: dormItems.length,
      placedDormItems: dormItems.filter((item: { transform: unknown }) => item.transform).length,
      beds: project?.items.filter((item: { productId: string }) => item.productId === bedProduct?.id).length,
      bedHeight: bedProduct?.dimensions.height,
      roomType: project?.roomType,
    };
  })).toEqual({ width: 3.65, source: "url", confirmed: false, productWidth: 1.0668, placedDesks: 2, distinctPositions: 2, dormItems: 10, placedDormItems: 10, beds: 2, bedHeight: 0.95, roomType: "Traditional double" });
  await page.getByLabel(/Loft height/).fill("5");
  await page.getByLabel(/Loft height/).blur();
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("roominate.projects.v1") ?? "{}");
    const project = stored.projects?.find((candidate: { name: string }) => candidate.name === "Untitled room");
    const bedProductIds = new Set(project?.products.filter((product: { category: string }) => product.category === "bed").map((product: { id: string }) => product.id));
    return project?.items.filter((item: { productId: string }) => bedProductIds.has(item.productId)).map((item: { transform?: { elevation?: number } }) => item.transform?.elevation);
  })).toEqual([1.524, 1.524]);
  await page.getByRole("button", { name: "Generate optimal layout" }).click();
  await expect(page.getByText(/movable items were placed|could not fit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate optimal layout" })).toBeEnabled();
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
