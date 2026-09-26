import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { calculateIssues, collidingItemIds, itemExceedsRoom, purchaseSubtotal, restsOnSurface, settledElevation, stackedElevation } from "./calculations";
import { applyAcceptedProposal, generateProposal } from "./proposals";

describe("Roominate deterministic engines", () => {
  it("derives fixture issues from the project data", () => {
    const project = createDemoProject();
    const types = new Set(calculateIssues(project).map((issue) => issue.type));
    expect(types.has("fit")).toBe(true);
    expect(types.has("clearance")).toBe(true);
    expect(types.has("budget")).toBe(true);
    expect(types.has("duplicate")).toBe(true);
    expect(types.has("rule")).toBe(true);
  });

  it("does not charge owned items", () => {
    expect(purchaseSubtotal(createDemoProject()).amount).toBe(59500);
  });

  it("never calls an unplaced item a confirmed fit", () => {
    const issues = calculateIssues(createDemoProject());
    expect(issues.some((issue) => issue.id === "unplaced-item-micro-jay")).toBe(true);
  });

  it("stacks an item moved into another item on top of it", () => {
    const project = createDemoProject();
    const heater = project.items.find((item) => item.id === "item-heater")!;
    const dresser = project.items.find((item) => item.id === "item-dresser")!;
    const onDresser = { ...heater, transform: { ...heater.transform!, position: dresser.transform!.position } };
    expect(stackedElevation(project, onDresser, 0)).toBeCloseTo(0.81);
    expect(stackedElevation(project, onDresser, 1.5)).toBe(1.5);
    expect(stackedElevation(project, onDresser, 0, new Set([dresser.id]))).toBe(0);
  });

  it("treats a stacked item as clear of the item below it", () => {
    const project = createDemoProject();
    const dresser = project.items.find((item) => item.id === "item-dresser")!;
    project.items = project.items.map((item) => item.id === "item-heater" ? { ...item, transform: { position: dresser.transform!.position, rotationY: 0, elevation: 0.81 } } : item);
    const heater = project.items.find((item) => item.id === "item-heater")!;
    expect(calculateIssues(project).some((issue) => issue.type === "fit" && issue.affectedItemIds.includes("item-heater"))).toBe(false);
    expect(restsOnSurface(project, heater)).toBe(true);
    expect(collidingItemIds(project, heater)).toEqual([]);
  });

  it("drops items carried off the top of another item back to the floor", () => {
    const project = createDemoProject();
    const dresser = project.items.find((item) => item.id === "item-dresser")!;
    const heater = project.items.find((item) => item.id === "item-heater")!;
    const openFloor = { x: 1.9, z: 1.4 };
    const at = (elevation: number, position = dresser.transform!.position) => ({ ...heater, transform: { position, rotationY: 0, elevation } });
    expect(settledElevation(project, at(0.81), openFloor)).toBe(0);
    expect(settledElevation(project, at(1.4), openFloor)).toBe(0);
    expect(settledElevation(project, at(1.4, { x: 1.9, z: 0.55 }), openFloor)).toBe(1.4);
    expect(settledElevation(project, at(0, { x: 1.9, z: 0.55 }), dresser.transform!.position)).toBeCloseTo(0.81);
    expect(settledElevation(project, at(0.81), { x: 3.2, z: 0.45 })).toBeCloseTo(0.81);
  });

  it("flags items sinking through the floor or lifted through the ceiling", () => {
    const project = createDemoProject();
    project.items = project.items.map((item) => item.id === "item-heater" ? { ...item, transform: { ...item.transform!, elevation: -0.1 } } : item.id === "item-shelf" ? { ...item, transform: { ...item.transform!, elevation: 2 } } : item);
    const ids = calculateIssues(project).map((issue) => issue.id);
    expect(ids).toContain("floor-item-heater");
    expect(ids).toContain("ceiling-item-shelf");
    expect(itemExceedsRoom(project, project.items.find((item) => item.id === "item-heater")!)).toBe(true);
    expect(itemExceedsRoom(project, project.items.find((item) => item.id === "item-chair")!)).toBe(false);
  });

  it("applies individually accepted proposal changes", () => {
    const project = createDemoProject();
    const proposal = generateProposal(project);
    proposal.changes = proposal.changes.map((change) => ({ ...change, accepted: change.type !== "replace" }));
    const next = applyAcceptedProposal({ ...project, proposal });
    expect(next.items.find((item) => item.id === "item-desk")?.productId).toBe("prod-desk-wide");
    expect(purchaseSubtotal(next).amount).toBeLessThan(purchaseSubtotal(project).amount);
  });

  it("validates the complete demo proposal through the same issue engine", () => {
    const project = createDemoProject();
    const proposal = generateProposal(project);
    proposal.changes = proposal.changes.map((change) => ({ ...change, accepted: true }));
    const next = applyAcceptedProposal({ ...project, proposal });
    const remainingTypes = new Set(calculateIssues(next).map((issue) => issue.type));
    expect(purchaseSubtotal(next).amount).toBe(32700);
    expect(remainingTypes.has("fit")).toBe(false);
    expect(remainingTypes.has("clearance")).toBe(false);
    expect(remainingTypes.has("budget")).toBe(false);
    expect(remainingTypes.has("duplicate")).toBe(false);
    expect(remainingTypes.has("rule")).toBe(false);
    expect(remainingTypes.has("missing_data")).toBe(true);
  });
});
