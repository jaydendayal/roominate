import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { evaluateCandidateFit, initialProductPlacement } from "./discovery";

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

  it("only confirms fit on the floor of a traced outline", () => {
    const project = createDemoProject();
    project.items = [];
    project.room.clearanceZones = [];
    // The south-west quarter, where the search starts, is not part of this room.
    project.room.outline = [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }];
    const fit = evaluateCandidateFit(project, { ...project.products[1], id: "candidate" });
    expect(fit.status).toBe("fits");
    if (fit.status !== "fits") return;
    expect(fit.position.x > project.room.width / 2 || fit.position.y > project.room.length / 2).toBe(true);
  });

  it("rejects an item larger than the room", () => {
    const project = createDemoProject();
    const product = { ...project.products[0], id: "huge", dimensions: { width: 8, depth: 8, height: 3 } };
    expect(evaluateCandidateFit(project, product).status).toBe("does_not_fit");
    expect(initialProductPlacement(project, product)).toEqual({ position: { x: project.room.width / 2, y: project.room.length / 2 }, rotationZ: 0 });
  });
});
