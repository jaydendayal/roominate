import { describe, expect, it } from "vitest";
import { productFor } from "./calculations";
import { createDemoProject } from "./demo";
import { frontDirection, frontFacesWall, hasFront } from "./facing";
import { optimizeLayout } from "./layoutOptimizer";
import { generateProposal } from "./proposals";
import type { Project } from "./types";

const item = (project: Project, id: string) => project.items.find((candidate) => candidate.id === id)!;

/** Every placed piece with drawers or doors, and whether its front is against a wall. */
function frontsAgainstWalls(project: Project) {
  return project.items.flatMap((candidate) => {
    const product = productFor(project, candidate);
    if (!product || !hasFront(product) || !candidate.transform) return [];
    return frontFacesWall(project.room, product, candidate.transform.position, candidate.transform.rotationZ) ? [product.name] : [];
  });
}

describe("drawers and doors face into the room", () => {
  it("knows which way a piece's front points", () => {
    // "+ 0" turns a rounded -0 into 0.
    const at = (turns: number) => { const { x, y } = frontDirection((turns * Math.PI) / 2); return [Math.round(x) + 0, Math.round(y) + 0]; };
    expect(at(0)).toEqual([0, -1]); // south
    expect(at(1)).toEqual([1, 0]); // east
    expect(at(2)).toEqual([0, 1]); // north
    expect(at(3)).toEqual([-1, 0]); // west
  });

  it("flags a front against a wall, only for pieces that have one", () => {
    const demo = createDemoProject();
    const desk = item(demo, "item-desk");
    const deskProduct = productFor(demo, desk)!;
    // The demo desk sits on the north wall facing south into the room.
    expect(frontFacesWall(demo.room, deskProduct, desk.transform!.position, 0)).toBe(false);
    // Turned round, its drawers would face the north wall.
    expect(frontFacesWall(demo.room, deskProduct, desk.transform!.position, Math.PI)).toBe(true);
    const chair = productFor(demo, item(demo, "item-chair"))!;
    expect(hasFront(chair)).toBe(false);
    expect(frontFacesWall(demo.room, chair, desk.transform!.position, Math.PI)).toBe(false);
    expect(frontsAgainstWalls(demo)).toEqual([]);
  });

  it("never moves a dresser, desk, wardrobe, or fridge to face a wall in Better Cart", () => {
    const demo = createDemoProject();
    // Push the dresser through the east wall with its drawers facing it, and unlock it so Better Cart must move it.
    demo.items = demo.items.map((candidate) => candidate.id === "item-dresser"
      ? { ...candidate, locked: false, transform: { position: { x: 3.6, y: 1.3 }, rotationZ: Math.PI / 2 } }
      : candidate);
    const proposal = generateProposal(demo);
    const move = proposal.changes.find((change) => change.itemId === "item-dresser");
    expect(move?.type).toBe("reposition");
    const dresser = productFor(demo, item(demo, "item-dresser"))!;
    expect(frontFacesWall(demo.room, dresser, move!.position!, move!.rotationZ!)).toBe(false);
    for (const change of proposal.changes.filter((candidate) => candidate.position && candidate.rotationZ != null)) {
      const product = demo.products.find((candidate) => candidate.id === (change.replacementProductId ?? item(demo, change.itemId).productId))!;
      expect(frontFacesWall(demo.room, product, change.position!, change.rotationZ!), product.name).toBe(false);
    }
  });

  it("never faces them into a wall in a generated layout", () => {
    for (const profile of ["balanced", "open_center", "functional_pairs"] as const) {
      const result = optimizeLayout(createDemoProject(), { profile });
      expect(result.placedItemIds.length, profile).toBeGreaterThan(0);
      expect(frontsAgainstWalls(result.project), profile).toEqual([]);
    }
  });
});
