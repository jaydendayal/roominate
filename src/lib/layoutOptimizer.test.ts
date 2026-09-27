import { describe, expect, it } from "vitest";
import { physicalIssues } from "./calculations";
import { createBlankProject } from "./demo";
import { generateLayoutCandidates, optimizeLayout } from "./layoutOptimizer";
import type { Item, Product, Project } from "./types";

function product(id: string, category: string, width: number, depth: number, height = 1): Product {
  return {
    id, name: id, store: "Housing", sourceURL: null, category, variant: "",
    dimensions: { width, depth, height }, price: null, fieldEvidence: {}, tags: ["housing-provided"],
  };
}

function item(id: string, productId: string, ownerId = "person-jay", locked = false): Item {
  return {
    id, productId, ownerId, acquisitionStatus: "owned", purchaseStatus: "not_purchasing", quantity: 1,
    essentiality: "essential", needsServed: [], transform: { position: { x: 0.4, y: 0.4 }, rotationZ: 0 },
    placementType: "floor", locked,
  };
}

function project(products: Product[], items: Item[]): Project {
  const blank = createBlankProject("Optimizer test");
  return {
    ...blank,
    room: { ...blank.room, width: 4, length: 4, height: 2.6, providedBed: "none", clearanceZones: [] },
    products,
    items,
  };
}

describe("whole-room layout optimizer", () => {
  it("turns an overlapping furniture pile into a collision-free layout", () => {
    const products = [
      product("wardrobe", "wardrobe", 1.1, 0.6, 2.1),
      product("desk", "desk", 1.2, 0.65, 0.76),
      product("chair", "chair", 0.6, 0.6, 0.9),
      product("dresser", "dresser", 1, 0.5, 0.8),
    ];
    const source = project(products, products.map((entry) => item(`item-${entry.id}`, entry.id)));
    expect(physicalIssues(source).filter((issue) => issue.type === "fit").length).toBeGreaterThan(0);

    const result = optimizeLayout(source);

    expect(result.placedItemIds).toHaveLength(4);
    expect(result.unplacedItemIds).toEqual([]);
    expect(physicalIssues(result.project).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
  });

  it("keeps locked furniture fixed and arranges everything else around it", () => {
    const products = [product("bed", "bed", 1, 2, 0.6), product("desk", "desk", 1.2, 0.6, 0.75), product("chair", "chair", 0.6, 0.6, 0.9)];
    const lockedBed = { ...item("item-bed", "bed", "person-jay", true), transform: { position: { x: 0.5, y: 2 }, rotationZ: 0 } };
    const result = optimizeLayout(project(products, [lockedBed, item("item-desk", "desk"), item("item-chair", "chair")]));

    expect(result.project.items.find((entry) => entry.id === "item-bed")?.transform).toEqual(lockedBed.transform);
    expect(physicalIssues(result.project).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
  });

  it("only moves the requested imported items", () => {
    const products = [product("existing", "dresser", 1, 0.5), product("new-desk", "desk", 1.1, 0.6)];
    const existing = { ...item("existing-item", "existing"), transform: { position: { x: 2, y: 3.75 }, rotationZ: 0 } };
    const result = optimizeLayout(project(products, [existing, item("new-item", "new-desk")]), { movableItemIds: new Set(["new-item"]) });

    expect(result.project.items.find((entry) => entry.id === existing.id)?.transform).toEqual(existing.transform);
    expect(result.project.items.find((entry) => entry.id === "new-item")?.transform).not.toBeNull();
    expect(physicalIssues(result.project).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
  });

  it("handles a crowded dorm import without leaving placed items colliding", () => {
    const products = [
      product("wardrobe-a", "wardrobe", 1.1, 0.6, 2.1),
      product("wardrobe-b", "wardrobe", 1.1, 0.6, 2.1),
      product("desk-a", "desk", 1.2, 0.65, 0.76),
      product("desk-b", "desk", 1.2, 0.65, 0.76),
      product("chair-a", "chair", 0.6, 0.6, 0.9),
      product("chair-b", "chair", 0.6, 0.6, 0.9),
      product("dresser-a", "dresser", 1, 0.5, 0.8),
      product("dresser-b", "dresser", 1, 0.5, 0.8),
    ];
    const source = project(products, products.map((entry) => item(`item-${entry.id}`, entry.id)));
    source.room = { ...source.room, width: 3.96, length: 2.74 };

    const candidates = generateLayoutCandidates(source);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(physicalIssues(candidate.project).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
    }
  });

  it("rejects invalid room measurements without throwing", () => {
    const source = project([product("desk", "desk", 1.2, 0.65)], [item("item-desk", "desk")]);
    source.room = { ...source.room, width: Number.NaN };

    expect(generateLayoutCandidates(source)).toEqual([]);
  });

  it("preserves a lofted bed height while optimizing its floor position", () => {
    const bed = { ...item("item-bed", "bed"), transform: { position: { x: 0.4, y: 0.4 }, rotationZ: 0, elevation: 1.524 } };
    const source = project([product("bed", "bed", 1, 2, 0.9)], [bed]);

    const result = optimizeLayout(source);

    expect(result.project.items[0].transform?.elevation).toBe(1.524);
  });
});
