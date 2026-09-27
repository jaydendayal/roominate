import { describe, expect, it } from "vitest";
import { convexInsidePolygon, floorGridSegments, hasShapedOutline, nearestWallFacing, outlineFromPolygon, pointOnWall, roomArea, roomPolygon, wallSegments } from "./roomShape";

// An L: the full 4 × 3 m box minus its 2 × 1.5 m north-east corner.
const lRoom = {
  width: 4,
  length: 3,
  outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }],
};
const square = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

describe("room polygons", () => {
  it("treats a room without an outline as its width × length rectangle", () => {
    const room = { width: 3.66, length: 3.05 };
    expect(hasShapedOutline(room)).toBe(false);
    expect(roomPolygon(room)).toEqual([{ x: 0, y: 0 }, { x: 3.66, y: 0 }, { x: 3.66, y: 3.05 }, { x: 0, y: 3.05 }]);
    expect(roomArea(room)).toBeCloseTo(3.66 * 3.05, 6);
  });

  it("scales a traced outline with the room's width and length", () => {
    expect(hasShapedOutline(lRoom)).toBe(true);
    expect(roomPolygon(lRoom)[3]).toEqual({ x: 2, y: 1.5 });
    expect(roomArea(lRoom)).toBeCloseTo(9, 6);
    expect(roomArea({ ...lRoom, width: 8 })).toBeCloseTo(18, 6);
  });

  it("ignores a malformed outline", () => {
    expect(hasShapedOutline({ width: 3, length: 3, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).toBe(false);
    expect(hasShapedOutline({ width: 3, length: 3, outline: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }] })).toBe(false);
    expect(roomPolygon({ width: 3, length: 2, outline: [] })).toHaveLength(4);
  });
});

describe("footprint containment", () => {
  const polygon = roomPolygon(lRoom);

  it("accepts a footprint inside the L and one flush against its walls", () => {
    expect(convexInsidePolygon(square(0.5, 0.5, 1), polygon)).toBe(true);
    expect(convexInsidePolygon(square(0, 0, 1.5), polygon)).toBe(true);
    expect(convexInsidePolygon(square(2.5, 0, 1.5), polygon)).toBe(true);
  });

  it("rejects a footprint in the missing corner or across the inner corner", () => {
    expect(convexInsidePolygon(square(2.8, 2, 0.8), polygon)).toBe(false);
    // Every corner of this square is on the floor, but the inner corner of the L pokes into it.
    expect(convexInsidePolygon([{ x: 1.5, y: 1.2 }, { x: 2.6, y: 1.2 }, { x: 2.6, y: 1.45 }, { x: 1.5, y: 2.2 }], polygon)).toBe(false);
    expect(convexInsidePolygon(square(1.6, 1.1, 0.8), polygon)).toBe(false);
  });
});

describe("walls", () => {
  it("names the compass direction each wall faces", () => {
    expect(wallSegments(roomPolygon(lRoom)).map((wall) => wall.facing)).toEqual(["south", "east", "north", "east", "north", "west"]);
    expect(nearestWallFacing(lRoom, { x: 3.5, y: 1.4 })).toBe("north");
    expect(nearestWallFacing({ width: 4, length: 3 }, { x: 3.9, y: 1 })).toBe("east");
  });

  it("places points on a rectangle's walls exactly as before and on an outline's longest matching wall", () => {
    const rectangle = { width: 4, length: 3 };
    expect(pointOnWall(rectangle, "south", 0.25, 0.04)).toEqual({ x: 1, y: 0.04 });
    expect(pointOnWall(rectangle, "north", 0.25, 0.04)).toEqual({ x: 1, y: 2.96 });
    expect(pointOnWall(rectangle, "east", 0.5, 0.1).x).toBeCloseTo(3.9, 9);
    expect(pointOnWall(rectangle, "west", 0.5, 0.1)).toEqual({ x: 0.1, y: 1.5 });
    // Both north-facing walls of the L are 2 m; the first one found is the inner step at y = 1.5.
    const north = pointOnWall(lRoom, "north", 0.5, 0.04);
    expect(north.y).toBeCloseTo(1.46, 9);
    expect(north.x).toBeCloseTo(3, 9);
  });
});

describe("floor grid", () => {
  it("clips grid lines to the outline", () => {
    const segments = floorGridSegments(lRoom, 1, 400)!;
    const lines: number[][] = [];
    for (let index = 0; index < segments.length; index += 4) lines.push(segments.slice(index, index + 4));
    // x = 3 runs only across the southern arm; y = 2 only across the western one.
    expect(lines).toContainEqual([3, 0, 3, 1.5]);
    expect(lines).toContainEqual([0, 2, 2, 2]);
    expect(floorGridSegments(lRoom, 0.001, 400)).toBeNull();
  });
});

describe("outlines from traced polygons", () => {
  it("stores no outline for a plain rectangle", () => {
    expect(outlineFromPolygon([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }])).toEqual({ outline: undefined, width: 4, length: 3 });
  });

  it("normalizes an L into counter-clockwise fractions of its bounding box", () => {
    // Clockwise input, offset from the origin.
    const traced = outlineFromPolygon([{ x: 10, y: 10 }, { x: 10, y: 13 }, { x: 12, y: 13 }, { x: 12, y: 11.5 }, { x: 14, y: 11.5 }, { x: 14, y: 10 }]);
    expect(traced.width).toBe(4);
    expect(traced.length).toBe(3);
    expect(roomArea({ width: 4, length: 3, outline: traced.outline })).toBeCloseTo(9, 6);
    expect(traced.outline).toHaveLength(6);
  });
});
