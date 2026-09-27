import type { Room, RoomFeature, Vec2 } from "./types";

// Floor geometry for rooms that are either a plain width × length rectangle or a traced outline.
// Polygons here are counter-clockwise in room meters: X east (width), Y north (length).

export type Cardinal = "north" | "south" | "east" | "west";

type RoomSize = Pick<Room, "width" | "length" | "outline">;

const MAX_OUTLINE_POINTS = 64;

export function polygonArea(points: Vec2[]) {
  let twice = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** True for an outline the app can use: 3–64 finite points inside the unit square enclosing some area. */
export function isValidOutline(outline: unknown): outline is Vec2[] {
  if (!Array.isArray(outline) || outline.length < 3 || outline.length > MAX_OUTLINE_POINTS) return false;
  const inRange = outline.every((point) => point != null
    && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= -1e-6 && point.x <= 1 + 1e-6 && point.y >= -1e-6 && point.y <= 1 + 1e-6);
  return inRange && Math.abs(polygonArea(outline)) > 1e-4;
}

/** True when the room has a usable traced outline, as opposed to the plain rectangle. */
export function hasShapedOutline(room: RoomSize) {
  return isValidOutline(room.outline);
}

/** The floor polygon in meters, counter-clockwise. A room without a traced outline is its width × length rectangle. */
export function roomPolygon(room: RoomSize): Vec2[] {
  const { width, length } = room;
  if (!isValidOutline(room.outline)) return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: length }, { x: 0, y: length }];
  const points = room.outline.map((point) => ({ x: point.x * width, y: point.y * length }));
  return polygonArea(points) < 0 ? points.reverse() : points;
}

export function roomArea(room: RoomSize) {
  return Math.abs(polygonArea(roomPolygon(room)));
}

/** Ray-casting point-in-polygon test. Points exactly on an edge may land on either side. */
export function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function cross(o: Vec2, a: Vec2, b: Vec2) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const onSegment = (p: Vec2, q: Vec2, r: Vec2) => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d1 === 0 && onSegment(c, d, a)) || (d2 === 0 && onSegment(c, d, b)) || (d3 === 0 && onSegment(a, b, c)) || (d4 === 0 && onSegment(a, b, d));
}

/** True when a convex polygon (e.g. an item's rotated footprint) lies within `polygon`; touching a wall is allowed within `tolerance` meters. */
export function convexInsidePolygon(corners: Vec2[], polygon: Vec2[], tolerance = 0.001) {
  const center = {
    x: corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length,
    y: corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length,
  };
  // Pull each corner in slightly so a footprint flush against a wall doesn't count as crossing it.
  const shrunk = corners.map((corner) => {
    const dx = center.x - corner.x;
    const dy = center.y - corner.y;
    const distance = Math.hypot(dx, dy);
    return distance <= tolerance ? center : { x: corner.x + (dx / distance) * tolerance, y: corner.y + (dy / distance) * tolerance };
  });
  if (!pointInPolygon(shrunk[0], polygon)) return false;
  // A connected shape with one point inside is wholly inside unless the outline's boundary passes through it.
  const orientation = Math.sign(polygonArea(shrunk)) || 1;
  const containsPoint = (point: Vec2) => shrunk.every((corner, index) => cross(corner, shrunk[(index + 1) % shrunk.length], point) * orientation >= 0);
  return polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    if (containsPoint(a) || containsPoint(b)) return false;
    return shrunk.every((corner, cornerIndex) => !segmentsIntersect(a, b, corner, shrunk[(cornerIndex + 1) % shrunk.length]));
  });
}

export interface WallSegment {
  start: Vec2;
  end: Vec2;
  length: number;
  /** Unit normal pointing out of the room. */
  normal: Vec2;
  /** The compass direction the wall's outside faces, to the nearest quarter turn. */
  facing: Cardinal;
}

function facingFor(normal: Vec2): Cardinal {
  if (Math.abs(normal.x) >= Math.abs(normal.y)) return normal.x > 0 ? "east" : "west";
  return normal.y > 0 ? "north" : "south";
}

/** The walls of a counter-clockwise polygon, in order. */
export function wallSegments(polygon: Vec2[]): WallSegment[] {
  return polygon.map((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    // Counter-clockwise, the inside is on the left, so the outward normal is the direction turned clockwise.
    const normal = length > 0 ? { x: (end.y - start.y) / length, y: -(end.x - start.x) / length } : { x: 0, y: -1 };
    return { start, end, length, normal, facing: facingFor(normal) };
  }).filter((segment) => segment.length > 1e-9);
}

export function closestPointOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq)) : 0;
  const closest = { x: start.x + dx * t, y: start.y + dy * t };
  return { closest, t, distance: Math.hypot(point.x - closest.x, point.y - closest.y) };
}

/** The wall nearest `point`, with the closest spot on it. */
export function nearestWall(polygon: Vec2[], point: Vec2) {
  const segments = wallSegments(polygon);
  let best: { segment: WallSegment; index: number; closest: Vec2; t: number; distance: number } | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    const hit = closestPointOnSegment(point, segments[index].start, segments[index].end);
    if (!best || hit.distance < best.distance) best = { segment: segments[index], index, ...hit };
  }
  return best;
}

/**
 * A spot `inset` meters inside the wall facing `wall`, `ratio` of the way along it (west to east for
 * north/south walls, south to north for east/west ones). A traced outline uses its longest wall facing
 * that way. For a rectangle this is the plain edge of the room.
 */
export function pointOnWall(room: RoomSize, wall: Cardinal, ratio: number, inset: number): Vec2 {
  const segments = wallSegments(roomPolygon(room)).filter((segment) => segment.facing === wall);
  const segment = segments.sort((a, b) => b.length - a.length)[0];
  if (!segment) return { x: room.width / 2, y: room.length / 2 };
  const alongX = wall === "north" || wall === "south";
  const forward = alongX ? segment.end.x >= segment.start.x : segment.end.y >= segment.start.y;
  const t = forward ? ratio : 1 - ratio;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t - segment.normal.x * inset,
    y: segment.start.y + (segment.end.y - segment.start.y) * t - segment.normal.y * inset,
  };
}

/** Which way the wall nearest `point` faces. */
export function nearestWallFacing(room: RoomSize, point: Vec2): Cardinal {
  return nearestWall(roomPolygon(room), point)?.segment.facing ?? "south";
}

/** Crossings of a polygon's boundary with the line `axis = value`, sorted, taken as inside/outside pairs. */
function insideSpans(polygon: Vec2[], axis: "x" | "y", value: number) {
  const other = axis === "x" ? "y" : "x";
  const hits: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    // Half-open on each edge, so a line through a vertex counts it once.
    if ((a[axis] <= value && value < b[axis]) || (b[axis] <= value && value < a[axis])) {
      hits.push(a[other] + ((value - a[axis]) / (b[axis] - a[axis])) * (b[other] - a[other]));
    }
  }
  hits.sort((first, second) => first - second);
  const spans: [number, number][] = [];
  for (let index = 0; index + 1 < hits.length; index += 2) spans.push([hits[index], hits[index + 1]]);
  return spans;
}

/**
 * Grid line segments (x1, y1, x2, y2 per line) every `cell` meters from the origin corner, clipped to
 * the floor, or null when there would be more than `maxLinesPerAxis` lines in either direction.
 */
export function floorGridSegments(room: RoomSize, cell: number, maxLinesPerAxis: number): number[] | null {
  const columns = Math.floor(room.width / cell + 1e-6);
  const rows = Math.floor(room.length / cell + 1e-6);
  if (!(cell > 0) || columns > maxLinesPerAxis || rows > maxLinesPerAxis) return null;
  const polygon = roomPolygon(room);
  const segments: number[] = [];
  for (let i = 1; i <= columns; i += 1) {
    for (const [from, to] of insideSpans(polygon, "x", i * cell)) segments.push(i * cell, from, i * cell, to);
  }
  for (let j = 1; j <= rows; j += 1) {
    for (const [from, to] of insideSpans(polygon, "y", j * cell)) segments.push(from, j * cell, to, j * cell);
  }
  return segments;
}

function removeRedundantPoints(points: Vec2[], epsilon: number) {
  let current = points.filter((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y) > epsilon;
  });
  let changed = true;
  while (changed && current.length > 3) {
    changed = false;
    for (let index = 0; index < current.length; index += 1) {
      const previous = current[(index + current.length - 1) % current.length];
      const next = current[(index + 1) % current.length];
      const span = Math.hypot(next.x - previous.x, next.y - previous.y);
      // Drop a vertex that sits on the straight line between its neighbours.
      if (span > 0 && Math.abs(cross(previous, current[index], next)) / span <= epsilon) {
        current = current.filter((_, candidate) => candidate !== index);
        changed = true;
        break;
      }
    }
  }
  return current;
}

/**
 * Turns a traced floor polygon (any units, Y north) into a room outline: fractions of its bounding box,
 * counter-clockwise, with the box's aspect in `width`/`length`. A plain axis-aligned rectangle needs no
 * outline, so `outline` is undefined for one.
 */
export function outlineFromPolygon(points: Vec2[]): { outline: Vec2[] | undefined; width: number; length: number } {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = maxX - minX;
  const length = maxY - minY;
  const round = (value: number) => Math.round(value * 100_000) / 100_000;
  let outline = removeRedundantPoints(points.map((point) => ({ x: round((point.x - minX) / width), y: round((point.y - minY) / length) })), 1e-4);
  if (polygonArea(outline) < 0) outline = outline.reverse();
  const rectangle = outline.length === 4 && outline.every((point) => (point.x === 0 || point.x === 1) && (point.y === 0 || point.y === 1));
  return { outline: rectangle || !isValidOutline(outline) ? undefined : outline, width, length };
}

/** Typical sizes for a door, window, or fixture whose measurements aren't known. */
export const FEATURE_DEFAULTS: Record<RoomFeature["kind"], { width: number; depth: number; height: number; elevation: number }> = {
  door: { width: 0.9, depth: 0.08, height: 2.03, elevation: 0 },
  window: { width: 1.2, depth: 0.08, height: 1.05, elevation: 0.9 },
  closet: { width: 1.1, depth: 0.58, height: 2.05, elevation: 0 },
  radiator: { width: 0.85, depth: 0.18, height: 0.62, elevation: 0.12 },
  obstacle: { width: 0.5, depth: 0.5, height: 0.8, elevation: 0 },
};
