import { describe, expect, it } from "vitest";
import { isRoomBedItem } from "./beds";
import { createDemoProject } from "./demo";
import { calculateIssues, collidingItemIds, itemBounds, itemExceedsRoom, productFor, purchaseSubtotal, restsOnSurface, settledElevation, stackedElevation } from "./calculations";
import { applyAcceptedProposal, generateProposal } from "./proposals";

const item = (project: ReturnType<typeof createDemoProject>, id: string) => project.items.find((candidate) => candidate.id === id)!;
const heightOf = (project: ReturnType<typeof createDemoProject>, id: string) => productFor(project, item(project, id))!.dimensions.height!;

describe("Roominate deterministic engines", () => {
  it("derives fixture issues from the project data", () => {
    const project = createDemoProject();
    const types = new Set(calculateIssues(project).map((issue) => issue.type));
    // The demo layout is conflict-free; its issues come from the cart, rules, and roommates.
    expect(types.has("fit")).toBe(false);
    expect(types.has("clearance")).toBe(false);
    expect(types.has("budget")).toBe(true);
    expect(types.has("duplicate")).toBe(true);
    expect(types.has("rule")).toBe(true);
  });

  it("builds the demo only from real shortlist products", () => {
    const project = createDemoProject();
    // The bed that comes with the room is the one non-retail item: it has no store listing or price.
    for (const demoItem of project.items.filter((candidate) => !isRoomBedItem(candidate))) {
      const product = productFor(project, demoItem)!;
      expect(product.tags, product.name).toContain("shortlist");
      expect(product.sourceURL, product.name).toMatch(/^https:\/\/(www\.ikea\.com|www\.amazon\.com)\//);
      expect(product.price, product.name).not.toBeNull();
    }
    expect(project.products.some((product) => product.sourceURL?.includes("example.com"))).toBe(false);
  });

  it("does not charge owned items", () => {
    expect(purchaseSubtotal(createDemoProject()).amount).toBe(58995);
  });

  it("never calls an unplaced item a confirmed fit", () => {
    const issues = calculateIssues(createDemoProject());
    expect(issues.some((issue) => issue.id === "unplaced-item-lamp-maya")).toBe(true);
  });

  it("uses X and Y for floor bounds and rotates footprints around Z", () => {
    const project = createDemoProject();
    const desk = item(project, "item-desk");
    const { width, depth } = productFor(project, desk)!.dimensions;
    desk.transform = { position: { x: 1, y: 2 }, rotationZ: Math.PI / 2 };
    const bounds = itemBounds(project, desk)!;
    expect(bounds.minX).toBeCloseTo(1 - depth! / 2);
    expect(bounds.maxY).toBeCloseTo(2 + width! / 2);
  });

  it("stacks an item moved into another item on top of it", () => {
    const project = createDemoProject();
    const fridge = item(project, "item-fridge");
    const dresser = item(project, "item-dresser");
    const onDresser = { ...fridge, transform: { ...fridge.transform!, position: dresser.transform!.position } };
    expect(stackedElevation(project, onDresser, 0)).toBeCloseTo(heightOf(project, "item-dresser"));
    expect(stackedElevation(project, onDresser, 1.5)).toBe(1.5);
    expect(stackedElevation(project, onDresser, 0, new Set([dresser.id]))).toBe(0);
  });

  it("treats a stacked item as clear of the item below it", () => {
    const project = createDemoProject();
    const dresser = item(project, "item-dresser");
    const dresserTop = heightOf(project, "item-dresser");
    project.items = project.items.map((candidate) => candidate.id === "item-fridge" ? { ...candidate, transform: { position: dresser.transform!.position, rotationZ: 0, elevation: dresserTop } } : candidate);
    const fridge = item(project, "item-fridge");
    expect(calculateIssues(project).some((issue) => issue.type === "fit" && issue.affectedItemIds.includes("item-fridge"))).toBe(false);
    expect(restsOnSurface(project, fridge)).toBe(true);
    expect(collidingItemIds(project, fridge)).toEqual([]);
  });

  it("drops items carried off the top of another item back to the floor", () => {
    const project = createDemoProject();
    const dresser = item(project, "item-dresser");
    const fridge = item(project, "item-fridge");
    const dresserTop = heightOf(project, "item-dresser");
    const openFloor = { x: 2.8, y: 1.3 };
    const at = (elevation: number, position = dresser.transform!.position) => ({ ...fridge, transform: { position, rotationZ: 0, elevation } });
    expect(settledElevation(project, at(dresserTop), openFloor)).toBe(0);
    expect(settledElevation(project, at(1.4), openFloor)).toBe(0);
    expect(settledElevation(project, at(1.4, { x: 1.2, y: 1.3 }), openFloor)).toBe(1.4);
    expect(settledElevation(project, at(0, { x: 1.2, y: 1.3 }), dresser.transform!.position)).toBeCloseTo(dresserTop);
    expect(settledElevation(project, at(dresserTop), { x: 1.6, y: 0.3 })).toBeCloseTo(dresserTop);
  });

  it("keeps horizontal moves under a lofted bed instead of auto-stacking onto it", () => {
    const project = createDemoProject();
    const bed = item(project, "item-room-bed");
    const fridge = item(project, "item-fridge");
    bed.transform = { position: { x: 1.8, y: 1.5 }, rotationZ: 0, elevation: 1 };
    fridge.transform = { position: { x: 0.3, y: 0.3 }, rotationZ: 0, elevation: 0 };
    project.items = [bed, fridge];
    project.products = project.products.map((product) => product.id === fridge.productId
      ? { ...product, dimensions: { ...product.dimensions, height: 1.1 } }
      : product);

    const underBed = bed.transform.position;
    const elevation = settledElevation(project, fridge, underBed);
    const moved = { ...fridge, transform: { ...fridge.transform, position: underBed, elevation } };

    expect(elevation).toBe(0);
    expect(collidingItemIds(project, moved)).toContain(bed.id);
  });

  it("keeps an item deliberately resting on a lofted bed on that surface", () => {
    const project = createDemoProject();
    const bed = item(project, "item-room-bed");
    const fridge = item(project, "item-fridge");
    bed.transform = { position: { x: 1.8, y: 1.5 }, rotationZ: 0, elevation: 1 };
    const bedTop = 1 + heightOf(project, bed.id);
    fridge.transform = { position: bed.transform.position, rotationZ: 0, elevation: bedTop };
    project.items = [bed, fridge];

    expect(settledElevation(project, fridge, { x: 1.82, y: 1.5 })).toBeCloseTo(bedTop);
  });

  it("flags items sinking through the floor or lifted through the ceiling", () => {
    const project = createDemoProject();
    project.items = project.items.map((candidate) => candidate.id === "item-fridge" ? { ...candidate, transform: { ...candidate.transform!, elevation: -0.1 } } : candidate.id === "item-pouf" ? { ...candidate, transform: { ...candidate.transform!, elevation: 2.2 } } : candidate);
    const ids = calculateIssues(project).map((issue) => issue.id);
    expect(ids).toContain("floor-item-fridge");
    expect(ids).toContain("ceiling-item-pouf");
    expect(itemExceedsRoom(project, item(project, "item-fridge"))).toBe(true);
    expect(itemExceedsRoom(project, item(project, "item-chair"))).toBe(false);
  });

  it("checks placement against a traced L-shaped outline, not just the bounding box", () => {
    const project = createDemoProject();
    // The demo room with its north-east corner missing.
    project.room.outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.6 }, { x: 0.6, y: 0.6 }, { x: 0.6, y: 1 }, { x: 0, y: 1 }];
    const place = (position: { x: number; y: number }) => {
      project.items = project.items.map((candidate) => candidate.id === "item-chair" ? { ...candidate, transform: { ...candidate.transform!, position } } : candidate);
      return calculateIssues(project).map((issue) => issue.id);
    };
    expect(place({ x: 3.1, y: 2.4 })).toContain("boundary-item-chair");
    expect(itemExceedsRoom(project, item(project, "item-chair"))).toBe(true);
    expect(place({ x: 1, y: 2.3 })).not.toContain("boundary-item-chair");
    expect(itemExceedsRoom(project, item(project, "item-chair"))).toBe(false);
  });

  it("applies individually accepted proposal changes", () => {
    const project = createDemoProject();
    const proposal = generateProposal(project);
    proposal.changes = proposal.changes.map((change) => ({ ...change, accepted: change.type !== "replace" }));
    const next = applyAcceptedProposal({ ...project, proposal });
    expect(item(next, "item-desk").productId).toBe("shortlist-lagkapten-alex");
    expect(purchaseSubtotal(next).amount).toBeLessThan(purchaseSubtotal(project).amount);
  });

  it("validates the complete demo proposal through the same issue engine", () => {
    const project = createDemoProject();
    const proposal = generateProposal(project);
    // Swap the over-limit fridge for its permitted alternative, defer the duplicate lamp, and swap
    // the desk for its compact alternative to get under budget. The layout itself is conflict-free.
    expect(proposal.changes.map((change) => [change.type, change.itemId, change.replacementProductId ?? null])).toEqual([
      ["replace", "item-fridge", "shortlist-frigidaire-10l"],
      ["defer", "item-lamp-jay", null],
      ["replace", "item-desk", "shortlist-torald"],
    ]);
    proposal.changes = proposal.changes.map((change) => ({ ...change, accepted: true }));
    const next = applyAcceptedProposal({ ...project, proposal });
    const remainingTypes = new Set(calculateIssues(next).map((issue) => issue.type));
    expect(purchaseSubtotal(next).amount).toBe(19494);
    expect(remainingTypes.has("fit")).toBe(false);
    expect(remainingTypes.has("clearance")).toBe(false);
    expect(remainingTypes.has("budget")).toBe(false);
    expect(remainingTypes.has("duplicate")).toBe(false);
    expect(remainingTypes.has("rule")).toBe(false);
    expect(remainingTypes.has("missing_data")).toBe(true);
  });

  it("only swaps to shortlist products placed in the same alternative group", () => {
    const project = createDemoProject();
    // Without the demo's alternative groups, no shortlist desk is offered as a swap for the desk.
    project.products = project.products.map((product) => ({ ...product, alternativeGroupId: undefined }));
    const proposal = generateProposal(project);
    expect(proposal.changes.some((change) => change.itemId === "item-desk" && change.type === "replace")).toBe(false);
  });
});
