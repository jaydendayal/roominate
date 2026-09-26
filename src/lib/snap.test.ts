import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { normalizeRotation, snapItemPosition, snapPosition, snapRotation, stepPosition } from "./snap";
import { METERS_PER_FOOT } from "./units";

const room = { width: 3.66, length: 3.05 };

describe("fixed-step moves", () => {
  it("moves only in whole multiples of the step from the start position", () => {
    const step = 6 * 0.0254; // 6 in
    const moved = stepPosition({ x: 1, y: 2 }, { x: 1.2, y: 1.93 }, step);
    expect((moved.x - 1) / step).toBeCloseTo(1, 6); // 0.2 m -> one 6 in step
    expect((moved.y - 2) / step).toBeCloseTo(0, 6); // -0.07 m rounds to no move
    const far = stepPosition({ x: 1, y: 2 }, { x: 0.3, y: 2.5 }, step);
    expect(Math.round((far.x - 1) / step)).toBe(-5);
    expect((far.x - 1) / step).toBeCloseTo(-5, 6);
    expect((far.y - 2) / step).toBeCloseTo(3, 6);
  });

  it("ignores a missing or invalid step", () => {
    expect(stepPosition({ x: 1, y: 1 }, { x: 1.234, y: 0.5 }, 0)).toEqual({ x: 1.234, y: 0.5 });
  });
});

describe("snap to grid", () => {
  it("puts the nearest edge on a grid line", () => {
    // 1 m wide item, 0.5 m grid: near edge 1.03 -> 1.0, so center 1.53 -> 1.5.
    expect(snapPosition({ x: 1.53, y: 1.2 }, { width: 1, depth: 0.4 }, 0.5, room)).toEqual({ x: 1.5, y: 1.2 });
    // Near edge 1.47 -> 1.5 (or far edge 2.47 -> 2.5): center 2.0.
    expect(snapPosition({ x: 1.97, y: 1.2 }, { width: 1, depth: 0.4 }, 0.5, room).x).toBe(2);
  });

  it("can sit flush against a far wall that is not on a grid line", () => {
    // 12 ft grid lines stop at 3.6576 m; the wall is at 3.66 m, so flush-to-wall wins over the line 2 mm short of it.
    const snapped = snapPosition({ x: 3.25, y: 1 }, { width: 0.8, depth: 0.4 }, METERS_PER_FOOT, room);
    expect(snapped.x + 0.4).toBeCloseTo(3.66, 6);
  });

  it("uses the rotated footprint of the item", () => {
    const demo = createDemoProject();
    // The LAGKAPTEN / ALEX desk is about 1.40 x 0.60 m; rotated 90 degrees its x-extent is its depth.
    const desk = demo.products.find((product) => product.id === "shortlist-lagkapten-alex")!.dimensions;
    const rotated = snapItemPosition(demo, "item-desk", { x: 1.43, y: 1.5 }, 0.5, Math.PI / 2);
    // Snapped positions are rounded to 0.1 mm, so edges land within 0.1 mm of the line.
    expect(rotated.x - desk.depth! / 2).toBeCloseTo(1, 3); // near edge on the 1.0 m line
    const unrotated = snapItemPosition(demo, "item-desk", { x: 1.43, y: 1.5 }, 0.5, 0);
    expect(unrotated.x + desk.width! / 2).toBeCloseTo(2, 3); // far edge on the 2.0 m line
  });

  it("leaves the position alone for unknown dimensions or a missing grid", () => {
    expect(snapPosition({ x: 1.234, y: 2.345 }, { width: 1, depth: 1 }, 0, room)).toEqual({ x: 1.234, y: 2.345 });
    const demo = createDemoProject();
    demo.products = demo.products.map((product) => product.id === "shortlist-flintan" ? { ...product, dimensions: { width: null, depth: null, height: null } } : product);
    expect(snapItemPosition(demo, "item-chair", { x: 1.234, y: 2.345 }, 0.5)).toEqual({ x: 1.234, y: 2.345 });
  });
});

describe("rotation snapping", () => {
  it("snaps rotations to 15 degree increments", () => {
    expect(snapRotation(22 * Math.PI / 180)).toBeCloseTo(15 * Math.PI / 180);
    expect(snapRotation(24 * Math.PI / 180)).toBeCloseTo(30 * Math.PI / 180);
  });

  it("normalizes full turns to the equivalent compact angle", () => {
    expect(normalizeRotation(Math.PI * 2 + Math.PI / 4)).toBeCloseTo(Math.PI / 4);
    expect(snapRotation(-Math.PI * 2 - Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
});
