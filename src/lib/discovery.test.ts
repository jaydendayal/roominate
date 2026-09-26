import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { evaluateCandidateFit } from "./discovery";

describe("retailer candidate fit", () => {
  it("never confirms fit with missing dimensions", () => {
    const project = createDemoProject();
    expect(evaluateCandidateFit(project, { ...project.products[0], id: "unknown", dimensions: { width: null, depth: 0.5, height: 0.7 } }).status).toBe("unverified");
  });

  it("finds a collision-tested placement for a compact candidate", () => {
    const project = createDemoProject();
    project.items = project.items.filter((item) => item.id !== "item-desk");
    expect(evaluateCandidateFit(project, { ...project.products[1], id: "candidate" }).status).toBe("fits");
  });

  it("rejects an item larger than the room", () => {
    const project = createDemoProject();
    expect(evaluateCandidateFit(project, { ...project.products[0], id: "huge", dimensions: { width: 8, depth: 8, height: 3 } }).status).toBe("does_not_fit");
  });
});

