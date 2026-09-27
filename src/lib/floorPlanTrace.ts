import type { Vec2 } from "./types";

// Deterministic floor-plan tracing. Given a raster plan and a spot inside one room, it grows the
// room's colour region, absorbs the small pockets that door swings, labels, and furniture outlines cut
// out of it, and traces its outer boundary into a simplified polygon, optionally straightened into
// walls that meet at right angles. No model is involved; the result is a draft the user reviews.

/** An RGBA image, 4 bytes per pixel, rows top to bottom (the layout of canvas ImageData). */
export interface RasterImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export type TraceDetail = "simple" | "balanced" | "detailed";

export interface TraceOptions {
  /** A pixel inside the room; found automatically when omitted. */
  seed?: Vec2 | null;
  /** How far (0–255 RGB distance) a colour may drift from the room's and still count as floor. */
  tolerance?: number;
  detail?: TraceDetail;
  /** Straighten walls to right angles, correcting a plan photographed at a slight angle. */
  straighten?: boolean;
  /**
   * Seal doorways at least this wide (in pixels, half the gap) before tracing. Leaks to the image border
   * are sealed automatically; this is for plans whose rooms open onto each other through bare gaps.
   */
  doorways?: number;
}

export interface FloorTrace {
  /** The outline over the image, in pixels (y down), for drawing on the plan. */
  overlay: Vec2[];
  /** The same outline turned by `-angle` about `center`, so its walls run along the axes. Pixels, y down. */
  outline: Vec2[];
  /** How far the plan's walls are turned from the image axes, in radians. */
  angle: number;
  center: Vec2;
  seed: Vec2;
  /** Pixels in the traced floor. */
  area: number;
  /** The floor region reaches the image border, which usually means it leaked out of the room. */
  touchesEdge: boolean;
  /** Share of the image the floor covers. */
  coverage: number;
}

export const DEFAULT_TRACE_TOLERANCE = 42;

const DETAIL = {
  // Simplification tolerance as a share of the region's diagonal, and the smallest wall jog kept as a share of its shorter side.
  simple: { epsilon: 0.014, jog: 0.15 },
  balanced: { epsilon: 0.007, jog: 0.08 },
  detailed: { epsilon: 0.0035, jog: 0.015 },
} satisfies Record<TraceDetail, { epsilon: number; jog: number }>;

/** Edges within this angle of an axis are snapped to it when straightening. */
const AXIS_SNAP = Math.tan((16 * Math.PI) / 180);

function toRgb(image: RasterImage) {
  const count = image.width * image.height;
  const rgb = new Uint8ClampedArray(count * 3);
  for (let index = 0; index < count; index += 1) {
    // Composite over white, so transparent PNG backgrounds read as paper.
    const alpha = image.data[index * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[index * 3 + channel] = image.data[index * 4 + channel] * alpha + 255 * (1 - alpha);
    }
  }
  return rgb;
}

type Color = [number, number, number];

const colorAt = (rgb: Uint8ClampedArray, index: number): Color => [rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]];
const luminance = ([r, g, b]: Color) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function distanceSq(rgb: Uint8ClampedArray, index: number, color: Color) {
  const dr = rgb[index * 3] - color[0];
  const dg = rgb[index * 3 + 1] - color[1];
  const db = rgb[index * 3 + 2] - color[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * The nearest pixel to `point` that sits in a patch of even, not-too-dark colour, so a tap on a
 * room label, a line, or an anti-aliased edge still starts from the floor colour around it.
 */
function flatSeed(rgb: Uint8ClampedArray, width: number, height: number, point: Vec2, tolerance: number) {
  const x0 = Math.round(point.x);
  const y0 = Math.round(point.y);
  const limit = Math.max(6, Math.round(Math.max(width, height) * 0.04));
  const flatness = (tolerance / 2) ** 2;
  const isFlat = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return false;
    const color = colorAt(rgb, y * width + x);
    if (luminance(color) < 60) return false;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (distanceSq(rgb, (y + dy) * width + x + dx, color) > flatness) return false;
      }
    }
    return true;
  };
  for (let radius = 0; radius <= limit; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (isFlat(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
      }
    }
  }
  return null;
}

/** Index of the nearest pixel to `point` (within `limit`) that isn't blocked, or -1. */
function nearestOpen(blocked: Uint8Array, width: number, height: number, point: Vec2, limit: number) {
  for (let radius = 0; radius <= limit; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = point.x + dx;
        const y = point.y + dy;
        if (x >= 0 && y >= 0 && x < width && y < height && !blocked[y * width + x]) return y * width + x;
      }
    }
  }
  return -1;
}

function similarMask(rgb: Uint8ClampedArray, count: number, color: Color, tolerance: number) {
  const mask = new Uint8Array(count);
  const limit = tolerance * tolerance;
  for (let index = 0; index < count; index += 1) mask[index] = distanceSq(rgb, index, color) <= limit ? 1 : 0;
  return mask;
}

interface Region {
  mask: Uint8Array;
  area: number;
  touchesBorder: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The 4-connected region of `passable` containing `start`. */
function regionAt(passable: Uint8Array, width: number, height: number, start: number): Region {
  const mask = new Uint8Array(passable.length);
  const region: Region = { mask, area: 0, touchesBorder: false, minX: width, maxX: -1, minY: height, maxY: -1 };
  if (!passable[start]) return region;
  const queue = new Int32Array(passable.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  mask[start] = 1;
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    region.area += 1;
    if (x < region.minX) region.minX = x;
    if (x > region.maxX) region.maxX = x;
    if (y < region.minY) region.minY = y;
    if (y > region.maxY) region.maxY = y;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) region.touchesBorder = true;
    const visit = (next: number) => {
      if (passable[next] && !mask[next]) {
        mask[next] = 1;
        queue[tail++] = next;
      }
    };
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }
  return region;
}

/** Square-kernel dilation, done as a horizontal then a vertical running-window pass. Outside the image counts as empty. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return mask.slice();
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    const row = y * width;
    for (let x = 0; x < Math.min(radius, width); x += 1) count += mask[row + x];
    for (let x = 0; x < width; x += 1) {
      if (x + radius < width) count += mask[row + x + radius];
      if (x - radius - 1 >= 0) count -= mask[row + x - radius - 1];
      horizontal[row + x] = count > 0 ? 1 : 0;
    }
  }
  const result = new Uint8Array(mask.length);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < Math.min(radius, height); y += 1) count += horizontal[y * width + x];
    for (let y = 0; y < height; y += 1) {
      if (y + radius < height) count += horizontal[(y + radius) * width + x];
      if (y - radius - 1 >= 0) count -= horizontal[(y - radius - 1) * width + x];
      result[y * width + x] = count > 0 ? 1 : 0;
    }
  }
  return result;
}

const invert = (mask: Uint8Array) => mask.map((value) => 1 - value);

/** Erosion as the complement of dilating the complement, so the image border never eats into a region. */
const erode = (mask: Uint8Array, width: number, height: number, radius: number) => invert(dilate(invert(mask), width, height, radius));

/** Sets every pixel the outside can't reach through non-mask pixels, filling the region's holes. */
function fillHoles(mask: Uint8Array, width: number, height: number) {
  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let tail = 0;
  const seed = (index: number) => {
    if (!mask[index] && !outside[index]) {
      outside[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  for (let head = 0; head < tail; head += 1) {
    const index = queue[head];
    const x = index % width;
    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (index >= width) seed(index - width);
    if (index < mask.length - width) seed(index + width);
  }
  return outside.map((value) => 1 - value);
}

/** Sizes and extents of every 4-connected region in `mask`. */
function labelRegions(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(mask.length).fill(-1);
  const regions: Omit<Region, "mask">[] = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    const label = regions.length;
    const region = { area: 0, touchesBorder: false, minX: width, maxX: -1, minY: height, maxY: -1 };
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index - x) / width;
      region.area += 1;
      if (x < region.minX) region.minX = x;
      if (x > region.maxX) region.maxX = x;
      if (y < region.minY) region.minY = y;
      if (y > region.maxY) region.maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) region.touchesBorder = true;
      const visit = (next: number) => {
        if (mask[next] && labels[next] === -1) {
          labels[next] = label;
          queue[tail++] = next;
        }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
    regions.push(region);
  }
  return { labels, regions };
}

/**
 * Corners of the region's outer boundary, walking the pixel edges with the region on the right
 * (clockwise on screen). Diagonal-only contacts are treated as separate, so the walk hugs one region.
 */
function traceBoundary(mask: Uint8Array, width: number, height: number): Vec2[] {
  const start = mask.indexOf(1);
  if (start < 0) return [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  // East, south, west, north: the step, then the pixels right and left of an edge leaving vertex (x, y) that way.
  const steps = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const edgeExists = (x: number, y: number, direction: number) => {
    switch (direction) {
      case 0: return inside(x, y) && !inside(x, y - 1);
      case 1: return inside(x - 1, y) && !inside(x, y);
      case 2: return inside(x - 1, y - 1) && !inside(x - 1, y);
      default: return inside(x, y - 1) && !inside(x - 1, y - 1);
    }
  };
  const startX = start % width;
  const startY = (start - startX) / width;
  let x = startX;
  let y = startY;
  let direction = 0;
  const corners: Vec2[] = [{ x, y }];
  const limit = 4 * (width + 1) * (height + 1);
  for (let step = 0; step < limit; step += 1) {
    x += steps[direction][0];
    y += steps[direction][1];
    if (x === startX && y === startY) break;
    const next = [(direction + 1) % 4, direction, (direction + 3) % 4].find((candidate) => edgeExists(x, y, candidate));
    if (next === undefined) break;
    if (next !== direction) corners.push({ x, y });
    direction = next;
  }
  return corners;
}

function perpendicularDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
}

function simplifyOpen(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points;
  let farthest = 0;
  let index = 0;
  for (let candidate = 1; candidate < points.length - 1; candidate += 1) {
    const distance = perpendicularDistance(points[candidate], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = candidate;
    }
  }
  if (farthest <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplifyOpen(points.slice(0, index + 1), epsilon);
  const right = simplifyOpen(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Ramer–Douglas–Peucker on a closed ring, split at the point farthest from the first. */
function simplifyClosed(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 4) return points;
  let far = 0;
  let farIndex = 0;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - points[0].x, point.y - points[0].y);
    if (distance > far) {
      far = distance;
      farIndex = index;
    }
  });
  const first = simplifyOpen(points.slice(0, farIndex + 1), epsilon);
  const second = simplifyOpen([...points.slice(farIndex), points[0]], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function signedArea(points: Vec2[]) {
  let twice = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    twice += point.x * next.y - next.x * point.y;
  });
  return twice / 2;
}

function rotateAbout(points: Vec2[], angle: number, center: Vec2): Vec2[] {
  if (angle === 0) return points.map((point) => ({ ...point }));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
  });
}

/** The angle, within ±45°, that best lines the long edges up with the axes (a length-weighted mean of edge angles modulo 90°). */
function dominantAngle(points: Vec2[]) {
  let sin = 0;
  let cos = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    sin += length * length * Math.sin(4 * angle);
    cos += length * length * Math.cos(4 * angle);
  });
  const angle = Math.atan2(sin, cos) / 4;
  return Math.abs(angle) < (0.4 * Math.PI) / 180 ? 0 : angle;
}

interface WallLine {
  orientation: "h" | "v" | "d";
  /** y for a horizontal wall, x for a vertical one. */
  coord: number;
  /** The traced stretches this wall was fitted to: where each lay, and how long it was. */
  support: { coord: number; length: number }[];
  /** Two points on a diagonal wall. */
  a: Vec2;
  b: Vec2;
}

/**
 * Where most of a merged wall's length lies (a length-weighted median). A doorway lets the traced floor
 * run into the wall's thickness for a short stretch; the median keeps the wall on its long inner face.
 */
function weightedMedian(support: WallLine["support"]) {
  const sorted = [...support].sort((a, b) => a.coord - b.coord);
  const half = sorted.reduce((sum, entry) => sum + entry.length, 0) / 2;
  let running = 0;
  for (const entry of sorted) {
    running += entry.length;
    if (running >= half) return entry.coord;
  }
  return sorted[sorted.length - 1]?.coord ?? 0;
}

function intersect(first: WallLine, second: WallLine, fallback: Vec2): Vec2 {
  if (first.orientation === "h" && second.orientation === "v") return { x: second.coord, y: first.coord };
  if (first.orientation === "v" && second.orientation === "h") return { x: first.coord, y: second.coord };
  const line = (wall: WallLine): [Vec2, Vec2] => wall.orientation === "h"
    ? [{ x: 0, y: wall.coord }, { x: 1, y: wall.coord }]
    : wall.orientation === "v" ? [{ x: wall.coord, y: 0 }, { x: wall.coord, y: 1 }] : [wall.a, wall.b];
  const [p1, p2] = line(first);
  const [p3, p4] = line(second);
  const denominator = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denominator) < 1e-9) return fallback;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denominator;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

function lineVertices(lines: WallLine[], fallbacks: Vec2[]) {
  // Vertex i is where wall i - 1 meets wall i.
  return lines.map((line, index) => intersect(lines[(index + lines.length - 1) % lines.length], line, fallbacks[index] ?? line.a));
}

/**
 * Snaps near-horizontal and near-vertical edges to the axes, fits each run of edges to one wall line,
 * and removes jogs shorter than `minJog` between parallel walls. Returns null when that would break the shape.
 */
function straighten(points: Vec2[], minJog: number): Vec2[] | null {
  interface Run { orientation: WallLine["orientation"]; weight: number; sum: number; a: Vec2; b: Vec2; start: Vec2 }
  const runs: Run[] = [];
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const orientation = dy <= dx * AXIS_SNAP ? "h" : dx <= dy * AXIS_SNAP ? "v" : "d";
    const middle = orientation === "h" ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    const last = runs[runs.length - 1];
    if (last && last.orientation === orientation && orientation !== "d") {
      last.weight += length;
      last.sum += middle * length;
      last.b = b;
    } else {
      runs.push({ orientation, weight: length, sum: middle * length, a, b, start: a });
    }
  });
  // The ring may start partway along a wall; join the last run into the first when they match.
  if (runs.length > 1 && runs[0].orientation !== "d" && runs[0].orientation === runs[runs.length - 1].orientation) {
    const last = runs.pop()!;
    runs[0] = { ...runs[0], weight: runs[0].weight + last.weight, sum: runs[0].sum + last.sum, a: last.a, start: last.start };
  }
  if (runs.length < 3) return null;
  let lines: WallLine[] = runs.map((run) => ({ orientation: run.orientation, coord: run.sum / run.weight, support: [{ coord: run.sum / run.weight, length: run.weight }], a: run.a, b: run.b }));
  let fallbacks = runs.map((run) => run.start);
  for (let guard = 0; guard < 200 && lines.length >= 4; guard += 1) {
    const vertices = lineVertices(lines, fallbacks);
    const lengths = lines.map((_, index) => {
      const from = vertices[index];
      const to = vertices[(index + 1) % vertices.length];
      return Math.hypot(to.x - from.x, to.y - from.y);
    });
    const count = lines.length;
    const between = (index: number) => [lines[(index + count - 1) % count], lines[(index + 1) % count]];
    // Parallel axis walls on either side: a small step between them, removed by merging the two.
    const isJog = (index: number) => {
      const [previous, next] = between(index);
      return previous.orientation !== "d" && previous.orientation === next.orientation && previous.orientation !== lines[index].orientation;
    };
    let shortest = -1;
    lines.forEach((line, index) => {
      // A short diagonal is a clipped corner or a stray anti-aliased step; its neighbours can meet directly.
      const removable = (isJog(index) && count >= 6) || (line.orientation === "d" && count >= 4);
      if (removable && lengths[index] < minJog && (shortest < 0 || lengths[index] < lengths[shortest])) shortest = index;
    });
    if (shortest < 0) break;
    if (!isJog(shortest)) {
      lines = lines.filter((_, index) => index !== shortest);
      fallbacks = fallbacks.filter((_, index) => index !== shortest);
      continue;
    }
    const previousIndex = (shortest + count - 1) % count;
    const nextIndex = (shortest + 1) % count;
    const support = [...lines[previousIndex].support, ...lines[nextIndex].support];
    const merged: WallLine = { ...lines[previousIndex], coord: weightedMedian(support), support };
    const remove = new Set([shortest, nextIndex]);
    lines = lines.map((line, index) => (index === previousIndex ? merged : line)).filter((_, index) => !remove.has(index));
    fallbacks = fallbacks.filter((_, index) => !remove.has(index));
  }
  return lineVertices(lines, fallbacks);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const orient = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

function isSimple(points: Vec2[]) {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % count], points[j], points[(j + 1) % count])) return false;
    }
  }
  return true;
}

function withoutRedundantPoints(points: Vec2[], epsilon: number) {
  let result = points.filter((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y) > epsilon;
  });
  for (let changed = true; changed && result.length > 3;) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index + result.length - 1) % result.length];
      const next = result[(index + 1) % result.length];
      if (perpendicularDistance(result[index], previous, next) <= epsilon) {
        result = result.filter((_, candidate) => candidate !== index);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/** Every `factor`-th pixel in each direction; enough to find rooms, far cheaper to search. */
function downsample(image: RasterImage, factor: number): RasterImage {
  if (factor <= 1) return image;
  const width = Math.floor(image.width / factor);
  const height = Math.floor(image.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((y * factor + (factor >> 1)) * image.width + x * factor + (factor >> 1)) * 4;
      for (let channel = 0; channel < 4; channel += 1) data[(y * width + x) * 4 + channel] = image.data[source + channel];
    }
  }
  return { width, height, data };
}

/**
 * Likely rooms to start from, best first: regions of even colour, largest first, with those that don't
 * reach the image border (the page background usually does) ahead of those that do. Sampled on a grid.
 */
export function findRoomSeeds(image: RasterImage, tolerance = DEFAULT_TRACE_TOLERANCE): Vec2[] {
  const factor = Math.max(1, Math.floor(Math.max(image.width, image.height) / 240));
  const small = downsample(image, factor);
  const { width, height } = small;
  const rgb = toRgb(small);
  const count = width * height;
  const claimed = new Uint8Array(count);
  const found: { seed: Vec2; area: number; enclosed: boolean }[] = [];
  const samples = 12;
  const points: Vec2[] = [];
  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) points.push({ x: ((column + 0.5) / samples) * width, y: ((row + 0.5) / samples) * height });
  }
  for (const point of points) {
    const seed = flatSeed(rgb, width, height, point, tolerance);
    if (!seed || claimed[seed.y * width + seed.x]) continue;
    const region = regionAt(similarMask(rgb, count, colorAt(rgb, seed.y * width + seed.x), tolerance), width, height, seed.y * width + seed.x);
    region.mask.forEach((value, index) => { if (value) claimed[index] = 1; });
    if (region.area < count * 0.01) continue;
    // Start from the sample in the region nearest its middle rather than the first one that found it.
    const middle = { x: (region.minX + region.maxX) / 2, y: (region.minY + region.maxY) / 2 };
    const central = points
      .map((candidate) => ({ x: Math.floor(candidate.x), y: Math.floor(candidate.y) }))
      .filter((candidate) => region.mask[candidate.y * width + candidate.x])
      .reduce((best, candidate) => (Math.hypot(candidate.x - middle.x, candidate.y - middle.y) < Math.hypot(best.x - middle.x, best.y - middle.y) ? candidate : best), seed);
    found.push({ seed: central, area: region.area, enclosed: !region.touchesBorder });
  }
  return found
    .sort((a, b) => Number(b.enclosed) - Number(a.enclosed) || b.area - a.area)
    .map(({ seed }) => ({ x: seed.x * factor + (factor >> 1), y: seed.y * factor + (factor >> 1) }));
}

/** The most likely room to start from, or null when the image has no even region big enough. */
export function findRoomSeed(image: RasterImage, tolerance = DEFAULT_TRACE_TOLERANCE): Vec2 | null {
  return findRoomSeeds(image, tolerance)[0] ?? null;
}

/** Traces the room around `options.seed` (or an automatically chosen one). Null when nothing traceable is there. */
export function traceFloorPlan(image: RasterImage, options: TraceOptions = {}): FloorTrace | null {
  const { width, height } = image;
  const count = width * height;
  if (width < 8 || height < 8) return null;
  const tolerance = options.tolerance ?? DEFAULT_TRACE_TOLERANCE;
  const detail = DETAIL[options.detail ?? "balanced"];
  const rgb = toRgb(image);
  const requested = options.seed ?? findRoomSeed(image, tolerance);
  if (!requested) return null;
  const seed = flatSeed(rgb, width, height, requested, tolerance);
  if (!seed) return null;
  const seedIndex = seed.y * width + seed.x;
  const largest = Math.max(width, height);
  // Line widths scale with the image, so the seam-closing radius does too.
  const reach = Math.max(2, Math.round(largest / 220));

  // Everything that isn't floor colour, and the same with hairlines (door swings, dimension strings) erased.
  const raw = invert(similarMask(rgb, count, colorAt(rgb, seedIndex), tolerance));
  const hairline = Math.max(1, Math.round(largest / 600));
  const cleaned = dilate(erode(raw, width, height, hairline), width, height, hairline);
  // A region that reaches the border, fills the whole image, or sprawls thinly across it has leaked
  // out through a doorway. Thickening the walls closes gaps up to twice the radius; the region found
  // then grows back by the same radius, which returns it to the walls without crossing the doorway.
  const leaks = (region: Region) => {
    const box = (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1);
    return region.touchesBorder || region.area > count * 0.85 || region.area < box * 0.45;
  };
  type Traced = { region: Region; barrier: Uint8Array };
  const sealed = (barrier: Uint8Array, radius: number): Traced | null => {
    const blocked = radius ? dilate(barrier, width, height, radius) : barrier;
    const start = nearestOpen(blocked, width, height, seed, radius + 3);
    if (start < 0) return null;
    let region = regionAt(invert(blocked), width, height, start);
    if (radius) {
      const grown = dilate(region.mask, width, height, radius);
      for (let index = 0; index < count; index += 1) grown[index] = grown[index] && !barrier[index] ? 1 : 0;
      region = regionAt(grown, width, height, grown[seedIndex] ? seedIndex : start);
    }
    return region.area >= 16 ? { region, barrier } : null;
  };
  const minimum = Math.max(0, Math.round(options.doorways ?? 0));
  const radii = [minimum, ...[2, 3, 5, 8, 12, 17, 24, 32, 44].filter((radius) => radius > minimum && radius <= Math.max(4, largest * 0.06))];
  let chosen: Traced | null = null;
  let fallback: Traced | null = null;
  // With hairlines kept, a drawn door swing seals its doorway but cuts its wedge out of the room.
  let withSwings: Traced | null = null;
  for (const radius of radii) {
    const soft = sealed(cleaned, radius);
    const hard: Traced | null = withSwings ? null : sealed(raw, radius);
    fallback ??= soft ?? hard;
    if (hard && !leaks(hard.region)) withSwings = hard;
    // Erasing hairlines erases door swings too. That trace is kept once it holds without spreading far
    // beyond (or shrinking well inside) what the hairlines enclosed: the room plus the swing wedges.
    const reference = withSwings?.region.area;
    if (soft && !leaks(soft.region) && (reference == null || (soft.region.area <= reference * 1.6 && soft.region.area >= reference * 0.85))) {
      chosen = soft;
      break;
    }
  }
  chosen ??= withSwings;
  // A plan cropped tight to the room always reaches the border; the unthickened trace is best then.
  const { region: main, barrier } = chosen ?? fallback ?? { region: null, barrier: raw };
  if (!main) return null;
  const passable = invert(barrier);

  // Absorb small same-colour pockets that sit against the floor inside its extent: the wedge behind a
  // door swing, a desk drawn against a wall, the counters of a room number.
  const { labels, regions } = labelRegions(passable, width, height);
  const mainLabel = labels[seedIndex];
  const near = dilate(main.mask, width, height, reach);
  const absorbed = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const label = labels[index];
    if (!near[index] || label < 0 || label === mainLabel || absorbed.has(label)) continue;
    const pocket = regions[label];
    const inside = pocket.minX >= main.minX - reach && pocket.maxX <= main.maxX + reach && pocket.minY >= main.minY - reach && pocket.maxY <= main.maxY + reach;
    if (!pocket.touchesBorder && inside && pocket.area <= main.area * 0.35) absorbed.add(label);
  }
  const union = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (main.mask[index] || (labels[index] >= 0 && absorbed.has(labels[index]))) union[index] = 1;
  }
  // Close the hairline seams left between the floor and absorbed pockets, then fill interior holes.
  const closed = fillHoles(erode(dilate(union, width, height, reach), width, height, reach), width, height);
  const floor = regionAt(closed, width, height, closed[seedIndex] ? seedIndex : closed.indexOf(1));
  if (floor.area < 16) return null;

  const boundary = traceBoundary(floor.mask, width, height);
  if (boundary.length < 3) return null;
  const regionWidth = floor.maxX - floor.minX + 1;
  const regionHeight = floor.maxY - floor.minY + 1;
  const epsilon = Math.max(1.2, Math.hypot(regionWidth, regionHeight) * detail.epsilon);
  const simplified = withoutRedundantPoints(simplifyClosed(boundary, epsilon), 0.5);
  if (simplified.length < 3) return null;

  const center = { x: (floor.minX + floor.maxX + 1) / 2, y: (floor.minY + floor.maxY + 1) / 2 };
  let angle = 0;
  let outline = simplified;
  if (options.straighten ?? true) {
    const turn = dominantAngle(simplified);
    const level = rotateAbout(simplified, -turn, center);
    const straight = straighten(level, Math.min(regionWidth, regionHeight) * detail.jog);
    const squared = straight ? withoutRedundantPoints(straight, 0.5) : null;
    const plausible = squared && squared.length >= 3 && isSimple(squared)
      && Math.abs(signedArea(squared)) > Math.abs(signedArea(level)) * 0.75
      && Math.abs(signedArea(squared)) < Math.abs(signedArea(level)) * 1.25;
    if (plausible) {
      angle = turn;
      outline = squared;
    }
  }
  return {
    overlay: rotateAbout(outline, angle, center),
    outline,
    angle,
    center,
    seed,
    area: floor.area,
    touchesEdge: floor.touchesBorder,
    coverage: floor.area / count,
  };
}
