import type { FloorTrace } from "./floorPlanTrace";
import { closestPointOnSegment, FEATURE_DEFAULTS, nearestWall, outlineFromPolygon, roomPolygon } from "./roomShape";
import type { Room, RoomFeature, Vec2 } from "./types";

// Turns a traced plan outline (pixels) into a room (meters). Measurements the user enters, or printed
// dimensions they accept, set the scale; without any, the shape keeps its proportions at an estimated size.

export interface PlanWall {
  index: number;
  label: string;
  /** Endpoints in the straightened outline's pixels (y down). */
  start: Vec2;
  end: Vec2;
  lengthPx: number;
  /** The axis a measurement of this wall calibrates: x for a horizontal wall, y for a vertical one, both for a diagonal one. */
  axis: "x" | "y" | "both";
}

/** A, B, … Z, then AA, AB, … */
export function wallLabel(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26 ? letter : `${wallLabel(Math.floor(index / 26) - 1)}${letter}`;
}

function screenArea(points: Vec2[]) {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twice += point.x * next.y - next.x * point.y;
  });
  return twice / 2;
}

/** The outline's walls, lettered clockwise on screen starting from the top-left corner. */
export function planWalls(outline: Vec2[]): PlanWall[] {
  if (outline.length < 3) return [];
  // With y down, a positive shoelace area means the ring runs clockwise on screen.
  const clockwise = screenArea(outline) >= 0 ? outline : [...outline].reverse();
  const first = clockwise.reduce((best, point, index) => (point.x + point.y < clockwise[best].x + clockwise[best].y ? index : best), 0);
  const ordered = [...clockwise.slice(first), ...clockwise.slice(0, first)];
  return ordered.map((start, index) => {
    const end = ordered[(index + 1) % ordered.length];
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    return { index, label: wallLabel(index), start, end, lengthPx: Math.hypot(dx, dy), axis: dy * 3 <= dx ? "x" : dx * 3 <= dy ? "y" : "both" };
  });
}

export interface PlanMeasurements {
  /** Real length of a wall, in meters, by wall index. */
  walls: Record<number, number>;
  /** Overall horizontal (x) and vertical (y) extent of the room, in meters. */
  overall: { x?: number; y?: number };
}

export interface PlanScale {
  /** Meters per pixel horizontally and vertically in the straightened plan. */
  x: number;
  y: number;
  /** False when nothing was measured and the size is only an estimate. */
  measured: boolean;
  /** Largest relative spread between measurements along one axis (0 when they agree). */
  disagreement: number;
}

export function outlineBox(outline: Vec2[]) {
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const spread = (values: number[]) => (values.length > 1 ? (Math.max(...values) - Math.min(...values)) / mean(values) : 0);

/**
 * Meters per pixel from whatever was measured. One measurement scales the whole plan; measurements on
 * both axes scale each axis separately. With none, the shape is sized to `fallbackArea` square meters.
 */
export function planScale(outline: Vec2[], measurements: PlanMeasurements, fallbackArea: number): PlanScale {
  const walls = planWalls(outline);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [key, meters] of Object.entries(measurements.walls)) {
    const wall = walls[Number(key)];
    if (!wall || !(meters > 0) || wall.lengthPx <= 0) continue;
    const perPixel = meters / wall.lengthPx;
    if (wall.axis !== "y") xs.push(perPixel);
    if (wall.axis !== "x") ys.push(perPixel);
  }
  const box = outlineBox(outline);
  if (measurements.overall.x && measurements.overall.x > 0 && box.width > 0) xs.push(measurements.overall.x / box.width);
  if (measurements.overall.y && measurements.overall.y > 0 && box.height > 0) ys.push(measurements.overall.y / box.height);
  if (!xs.length && !ys.length) {
    const areaPx = Math.abs(screenArea(outline));
    const perPixel = areaPx > 0 && fallbackArea > 0 ? Math.sqrt(fallbackArea / areaPx) : 0.01;
    return { x: perPixel, y: perPixel, measured: false, disagreement: 0 };
  }
  const x = xs.length ? mean(xs) : mean(ys);
  const y = ys.length ? mean(ys) : mean(xs);
  return { x, y, measured: true, disagreement: Math.max(spread(xs), spread(ys)) };
}

export function wallMeters(wall: PlanWall, scale: PlanScale) {
  return Math.hypot((wall.end.x - wall.start.x) * scale.x, (wall.end.y - wall.start.y) * scale.y);
}

/** Where a point in the straightened outline's pixels lands in the room, in meters (y flipped so the top of the plan is north). */
export function planPointToRoom(point: Vec2, outline: Vec2[], scale: PlanScale): Vec2 {
  const box = outlineBox(outline);
  return { x: (point.x - box.minX) * scale.x, y: (box.maxY - point.y) * scale.y };
}

/** The room shape the outline describes at `scale`: overall width and length plus the outline, if it isn't a plain rectangle. */
export function planRoomShape(outline: Vec2[], scale: PlanScale): Pick<Room, "width" | "length" | "outline"> {
  const { outline: shape, width, length } = outlineFromPolygon(outline.map((point) => planPointToRoom(point, outline, scale)));
  const round = (meters: number) => Math.round(meters * 1000) / 1000;
  return { width: round(width), length: round(length), outline: shape };
}

/**
 * A pair of printed overall dimensions may be read in either order. Returns them assigned to the axes
 * whose proportions they match better.
 */
export function assignOverallDimensions(first: number, second: number, outline: Vec2[]): { x: number; y: number } {
  const box = outlineBox(outline);
  if (!(box.width > 0 && box.height > 0)) return { x: first, y: second };
  const aspect = Math.log(box.width / box.height);
  const asRead = Math.abs(Math.log(first / second) - aspect);
  const swapped = Math.abs(Math.log(second / first) - aspect);
  return swapped < asRead ? { x: second, y: first } : { x: first, y: second };
}

export interface PlanOpening {
  kind: RoomFeature["kind"];
  label: string;
  wallLabel: string | null;
  /** Center of the opening as fractions of the image's width and height. */
  position: Vec2;
  /** Share of its wall the opening spans, when the plan shows it. */
  widthRatio: number | null;
  confidence: number;
  evidence: string;
}

/**
 * Doors, windows, and fixtures read from the plan, placed on the nearest traced wall (or the lettered
 * wall the reading names) as unconfirmed features. `imageSize` is the traced image's size in pixels.
 */
export function planOpeningFeatures(
  openings: PlanOpening[],
  trace: Pick<FloorTrace, "outline" | "angle" | "center">,
  imageSize: { width: number; height: number },
  scale: PlanScale,
  room: Pick<Room, "width" | "length" | "outline">,
): RoomFeature[] {
  const walls = planWalls(trace.outline);
  const cos = Math.cos(-trace.angle);
  const sin = Math.sin(-trace.angle);
  const polygon = roomPolygon(room);
  return openings.flatMap((opening) => {
    const image = { x: opening.position.x * imageSize.width, y: opening.position.y * imageSize.height };
    const dx = image.x - trace.center.x;
    const dy = image.y - trace.center.y;
    const level = { x: trace.center.x + dx * cos - dy * sin, y: trace.center.y + dx * sin + dy * cos };
    const named = walls.find((wall) => wall.label === opening.wallLabel);
    const wall = named ?? walls.reduce<PlanWall | null>((best, candidate) => {
      if (!best) return candidate;
      return closestPointOnSegment(level, candidate.start, candidate.end).distance < closestPointOnSegment(level, best.start, best.end).distance ? candidate : best;
    }, null);
    if (!wall) return [];
    const onWall = planPointToRoom(closestPointOnSegment(level, wall.start, wall.end).closest, trace.outline, scale);
    const hit = nearestWall(polygon, onWall);
    if (!hit) return [];
    const defaults = FEATURE_DEFAULTS[opening.kind];
    const wallLength = wallMeters(wall, scale);
    const width = Math.min(wallLength, Math.max(0.3, opening.widthRatio != null ? opening.widthRatio * wallLength : defaults.width));
    const inset = defaults.depth / 2;
    return [{
      id: `plan-feature-${crypto.randomUUID()}`,
      name: opening.label,
      kind: opening.kind,
      position: { x: hit.closest.x - hit.segment.normal.x * inset, y: hit.closest.y - hit.segment.normal.y * inset },
      width,
      depth: defaults.depth,
      height: defaults.height,
      elevation: defaults.elevation,
      wall: hit.segment.facing,
      source: "imported_plan",
      confidence: opening.confidence,
      evidence: opening.evidence,
      confirmed: false,
    }];
  });
}
