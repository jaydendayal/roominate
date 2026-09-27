import { describe, expect, it } from "vitest";
import { findRoomSeed, traceFloorPlan, type RasterImage } from "./floorPlanTrace";
import type { Vec2 } from "./types";

// Small rasterizer for synthetic plans, so the tracer is tested on known geometry.
type Color = [number, number, number];
const WHITE: Color = [255, 255, 255];
const KHAKI: Color = [201, 192, 156];
const GRAY: Color = [130, 126, 112];
const BLACK: Color = [20, 20, 20];

function blank(width: number, height: number, color: Color = WHITE) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set([...color, 255], index * 4);
  return { width, height, data };
}

function paint(image: ReturnType<typeof blank>, color: Color, test: (x: number, y: number) => boolean) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (test(x + 0.5, y + 0.5)) image.data.set([...color, 255], (y * image.width + x) * 4);
    }
  }
}

const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

function inPolygon(points: Vec2[]) {
  return (x: number, y: number) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const a = points[i];
      const b = points[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
}

function stroke(from: Vec2, to: Vec2, width: number) {
  return (x: number, y: number) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const t = Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (from.x + dx * t), y - (from.y + dy * t)) <= width / 2;
  };
}

function arc(center: Vec2, radius: number, from: number, to: number, width: number) {
  return (x: number, y: number) => {
    const angle = Math.atan2(y - center.y, x - center.x);
    return angle >= from && angle <= to && Math.abs(Math.hypot(x - center.x, y - center.y) - radius) <= width / 2;
  };
}

function expectNear(actual: number, expected: number, tolerance = 1.5) {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
}

function box(points: Vec2[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A colour-filled room like a housing plan: hairline walls, a door swing, and a bold room number. */
function filledPlan(): RasterImage {
  const image = blank(300, 220);
  paint(image, KHAKI, rect(40, 30, 240, 170));
  paint(image, GRAY, (x, y) => rect(38, 28, 242, 172)(x, y) && !rect(40, 30, 240, 170)(x, y));
  paint(image, GRAY, arc({ x: 239, y: 60 }, 40, Math.PI / 2, Math.PI, 1));
  paint(image, GRAY, stroke({ x: 239, y: 60 }, { x: 239, y: 100 }, 1));
  // "120" in heavy strokes, including the enclosed counter of the zero.
  paint(image, BLACK, rect(118, 90, 124, 112));
  paint(image, BLACK, (x, y) => rect(128, 90, 140, 112)(x, y) && !rect(131, 93, 137, 109)(x, y));
  paint(image, BLACK, (x, y) => rect(144, 90, 156, 112)(x, y) && !rect(147, 93, 153, 109)(x, y));
  return image;
}

describe("floor plan tracing", () => {
  it("traces a filled room with a door swing and a room number as a plain rectangle", () => {
    const trace = traceFloorPlan(filledPlan(), { seed: { x: 80, y: 140 } })!;
    expect(trace.outline).toHaveLength(4);
    const bounds = box(trace.outline);
    expectNear(bounds.minX, 40);
    expectNear(bounds.maxX, 240);
    expectNear(bounds.minY, 30);
    expectNear(bounds.maxY, 170);
    expect(trace.angle).toBe(0);
    expect(trace.touchesEdge).toBe(false);
  });

  it("starts from the floor colour around a tap on the room number", () => {
    const trace = traceFloorPlan(filledPlan(), { seed: { x: 121, y: 100 } })!;
    expect(trace.outline).toHaveLength(4);
    expectNear(box(trace.outline).maxX, 240);
  });

  it("finds the room without a tap", () => {
    const seed = findRoomSeed(filledPlan())!;
    expect(seed.x).toBeGreaterThan(40);
    expect(seed.x).toBeLessThan(240);
    expect(seed.y).toBeGreaterThan(30);
    expect(seed.y).toBeLessThan(170);
    expect(traceFloorPlan(filledPlan())!.outline).toHaveLength(4);
  });

  it("keeps an L-shaped room's inner corner", () => {
    const image = blank(260, 220);
    const shape = [{ x: 30, y: 30 }, { x: 230, y: 30 }, { x: 230, y: 110 }, { x: 130, y: 110 }, { x: 130, y: 190 }, { x: 30, y: 190 }];
    paint(image, KHAKI, inPolygon(shape));
    const trace = traceFloorPlan(image, { seed: { x: 60, y: 60 } })!;
    expect(trace.outline).toHaveLength(6);
    const inner = trace.outline.find((point) => Math.abs(point.x - 130) < 1.5 && Math.abs(point.y - 110) < 1.5);
    expect(inner).toBeDefined();
  });

  it("closes a doorway so a white room on a white page doesn't leak into the hall", () => {
    const image = blank(320, 240);
    // Thick black walls around a 200 × 130 room, with a 30 px doorway in the south wall.
    paint(image, BLACK, (x, y) => rect(54, 44, 266, 186)(x, y) && !rect(60, 50, 260, 180)(x, y) && !rect(150, 175, 180, 190)(x, y));
    const trace = traceFloorPlan(image, { seed: { x: 100, y: 100 } })!;
    expect(trace.touchesEdge).toBe(false);
    expect(trace.outline).toHaveLength(4);
    const bounds = box(trace.outline);
    expectNear(bounds.minX, 60);
    expectNear(bounds.maxX, 260);
    expectNear(bounds.maxY, 180);
  });

  it("traces one room of a line-drawn building, including its door swing", () => {
    // Three rooms along a hall, black walls on a white page. The room at left opens onto the hall
    // through a door drawn with a hairline leaf and swing, as housing plans usually show it.
    const image = blank(420, 300);
    const walls = (x: number, y: number) => rect(20, 20, 400, 26)(x, y) || rect(20, 274, 400, 280)(x, y)
      || rect(20, 20, 26, 280)(x, y) || rect(394, 20, 400, 280)(x, y)
      || rect(160, 20, 166, 180)(x, y) || rect(280, 20, 286, 180)(x, y)
      || (rect(20, 180, 400, 186)(x, y) && !rect(70, 180, 110, 186)(x, y) && !rect(200, 180, 240, 186)(x, y) && !rect(320, 180, 360, 186)(x, y));
    paint(image, BLACK, walls);
    paint(image, BLACK, stroke({ x: 70, y: 180 }, { x: 70, y: 140 }, 1));
    paint(image, BLACK, arc({ x: 70, y: 180 }, 40, -Math.PI / 2, 0, 1));
    const trace = traceFloorPlan(image, { seed: { x: 110, y: 90 } })!;
    expect(trace.outline).toHaveLength(4);
    const bounds = box(trace.outline);
    expectNear(bounds.minX, 26);
    expectNear(bounds.maxX, 160);
    expectNear(bounds.minY, 26);
    expectNear(bounds.maxY, 180);
  });

  it("seals bare doorways when asked, for rooms that open onto each other", () => {
    const image = blank(420, 300);
    paint(image, BLACK, (x, y) => rect(20, 20, 400, 26)(x, y) || rect(20, 274, 400, 280)(x, y)
      || rect(20, 20, 26, 280)(x, y) || rect(394, 20, 400, 280)(x, y)
      || (rect(20, 180, 400, 186)(x, y) && !rect(70, 180, 110, 186)(x, y)));
    // Unsealed, the room and the hall below it are one space.
    expectNear(box(traceFloorPlan(image, { seed: { x: 200, y: 90 } })!.outline).maxY, 274);
    const sealed = traceFloorPlan(image, { seed: { x: 200, y: 90 }, doorways: 22 })!;
    expect(sealed.outline).toHaveLength(4);
    expectNear(box(sealed.outline).maxY, 180);
  });

  it("straightens a plan photographed at a slight angle", () => {
    const image = blank(320, 260);
    const turn = (8 * Math.PI) / 180;
    const corners = [[-100, -60], [100, -60], [100, 60], [-100, 60]].map(([x, y]) => ({
      x: 160 + x * Math.cos(turn) - y * Math.sin(turn),
      y: 130 + x * Math.sin(turn) + y * Math.cos(turn),
    }));
    paint(image, KHAKI, inPolygon(corners));
    const trace = traceFloorPlan(image, { seed: { x: 160, y: 130 } })!;
    expect(trace.angle).toBeCloseTo(turn, 1);
    expect(trace.outline).toHaveLength(4);
    const bounds = box(trace.outline);
    expect((bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)).toBeCloseTo(200 / 120, 1);
    // The overlay is turned back onto the photo.
    expect(box(trace.overlay).maxX).toBeGreaterThan(bounds.maxX);
  });

  it("keeps a small corner notch only at the detailed setting", () => {
    const image = blank(260, 200);
    paint(image, KHAKI, (x, y) => rect(30, 30, 230, 170)(x, y) && !rect(30, 160, 58, 170)(x, y));
    expect(traceFloorPlan(image, { seed: { x: 100, y: 100 }, detail: "balanced" })!.outline).toHaveLength(4);
    expect(traceFloorPlan(image, { seed: { x: 100, y: 100 }, detail: "detailed" })!.outline).toHaveLength(6);
  });

  it("returns nothing for an image with no room to trace", () => {
    expect(traceFloorPlan(blank(4, 4))).toBeNull();
  });
});
