import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { calculateIssues, itemBounds, purchaseSubtotal } from "./calculations";
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

  it("uses X and Y for floor bounds and rotates footprints around Z", () => {
    const project = createDemoProject();
    const item = project.items.find((candidate) => candidate.id === "item-desk")!;
    item.transform = { position: { x: 1, y: 2 }, rotationZ: Math.PI / 2 };
    const bounds = itemBounds(project, item)!;
    expect(bounds.minX).toBeCloseTo(1 - 0.76 / 2);
    expect(bounds.maxY).toBeCloseTo(2 + 1.52 / 2);
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
