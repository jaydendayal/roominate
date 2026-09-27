import { itemBounds, productFor, rotatedFootprint } from "./calculations";
import type { Project, Vec2 } from "./types";

const WALL_PREFERENCE_M = 0.02;
export const FURNITURE_SNAP_DISTANCE_M = 0.12;
export const ROTATION_SNAP_RADIANS = Math.PI / 12;

/** Keeps persisted rotations compact while preserving the same orientation. */
export function normalizeRotation(rotation: number) {
  return Math.atan2(Math.sin(rotation), Math.cos(rotation));
}

/** Snaps rotation to a regular angular increment (15 degrees by default). */
export function snapRotation(rotation: number, increment = ROTATION_SNAP_RADIANS) {
  if (!(increment > 0)) return normalizeRotation(rotation);
  return normalizeRotation(Math.round(rotation / increment) * increment);
}

/**
 * Snaps one axis so the item's nearest edge lands on a grid line, or its far edge sits flush
 * against the far wall (which is usually not on a grid line). Grid lines start at 0 (the near wall).
 */
function snapAxis(center: number, size: number, cell: number, wall: number) {
  const half = size / 2;
  const gridCandidates = [
    Math.round((center - half) / cell) * cell + half, // near edge on a grid line
    Math.round((center + half) / cell) * cell - half, // far edge on a grid line
  ];
  const onGrid = gridCandidates.reduce((closest, candidate) => (Math.abs(candidate - center) < Math.abs(closest - center) ? candidate : closest));
  const flush = wall - half; // far edge flush with the far wall
  // Prefer the wall when it is about as close as the nearest grid line (e.g. a 12' 0.1" room on a 1 ft grid).
  const best = Math.abs(flush - center) <= Math.abs(onGrid - center) + WALL_PREFERENCE_M ? flush : onGrid;
  return Number(best.toFixed(4));
}

/** Snaps a footprint's center so its edges align with the grid (or the far walls). */
export function snapPosition(position: Vec2, footprint: { width: number; depth: number }, cell: number, room: { width: number; length: number }): Vec2 {
  if (!(cell > 0)) return position;
  return {
    x: snapAxis(position.x, footprint.width, cell, room.width),
    y: snapAxis(position.y, footprint.depth, cell, room.length),
  };
}

/** Limits a move to whole multiples of `step` from `start` on each axis (e.g. only 6-inch increments). */
export function stepPosition(start: Vec2, target: Vec2, step: number): Vec2 {
  if (!(step > 0)) return target;
  const axis = (from: number, to: number) => Number((from + Math.round((to - from) / step) * step).toFixed(4));
  return { x: axis(start.x, target.x), y: axis(start.y, target.y) };
}

/** Snaps `position` for an item using its product's footprint at `rotationZ` (defaults to its current rotation). */
export function snapItemPosition(project: Project, itemId: string, position: Vec2, cell: number, rotationZ?: number): Vec2 {
  const item = project.items.find((candidate) => candidate.id === itemId);
  const product = item ? productFor(project, item) : undefined;
  const footprint = product ? rotatedFootprint(product.dimensions, rotationZ ?? item?.transform?.rotationZ ?? 0) : null;
  return footprint ? snapPosition(position, footprint, cell, project.room) : position;
}

interface NeighborSnap {
  position: Vec2;
  snappedX: boolean;
  snappedY: boolean;
}

/** Finds nearby furniture edges and magnetically places the moving item flush beside them. */
export function snapItemToNeighbors(project: Project, itemId: string, position: Vec2, rotationZ?: number, threshold = FURNITURE_SNAP_DISTANCE_M): NeighborSnap {
  const item = project.items.find((candidate) => candidate.id === itemId);
  const product = item ? productFor(project, item) : undefined;
  const footprint = product ? rotatedFootprint(product.dimensions, rotationZ ?? item?.transform?.rotationZ ?? 0) : null;
  if (!item || !footprint || !(threshold > 0)) return { position, snappedX: false, snappedY: false };

  const moving = {
    minX: position.x - footprint.width / 2,
    maxX: position.x + footprint.width / 2,
    minY: position.y - footprint.depth / 2,
    maxY: position.y + footprint.depth / 2,
  };
  let x = position.x;
  let y = position.y;
  let xDistance = threshold + 1;
  let yDistance = threshold + 1;

  for (const other of project.items) {
    if (other.id === itemId || other.purchaseStatus === "deferred") continue;
    const bounds = itemBounds(project, other);
    if (!bounds) continue;
    const overlapsY = moving.minY < bounds.maxY && moving.maxY > bounds.minY;
    const overlapsX = moving.minX < bounds.maxX && moving.maxX > bounds.minX;
    if (overlapsY) {
      const candidates = [bounds.minX - footprint.width / 2, bounds.maxX + footprint.width / 2];
      for (const candidate of candidates) {
        const distance = Math.abs(candidate - position.x);
        if (distance <= threshold && distance < xDistance) {
          x = candidate;
          xDistance = distance;
        }
      }
    }
    if (overlapsX) {
      const candidates = [bounds.minY - footprint.depth / 2, bounds.maxY + footprint.depth / 2];
      for (const candidate of candidates) {
        const distance = Math.abs(candidate - position.y);
        if (distance <= threshold && distance < yDistance) {
          y = candidate;
          yDistance = distance;
        }
      }
    }
  }

  return {
    position: { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) },
    snappedX: xDistance <= threshold,
    snappedY: yDistance <= threshold,
  };
}

interface ItemPlacementSnapOptions {
  grid?: boolean;
  furniture?: boolean;
  cell?: number;
  rotationZ?: number;
  threshold?: number;
}

/** Combines grid and furniture snapping; nearby furniture edges win on the axis they snap. */
export function snapItemPlacement(project: Project, itemId: string, position: Vec2, options: ItemPlacementSnapOptions = {}): Vec2 {
  const onGrid = options.grid ? snapItemPosition(project, itemId, position, options.cell ?? 0, options.rotationZ) : position;
  if (!options.furniture) return onGrid;
  const neighbor = snapItemToNeighbors(project, itemId, position, options.rotationZ, options.threshold);
  return {
    x: neighbor.snappedX ? neighbor.position.x : onGrid.x,
    y: neighbor.snappedY ? neighbor.position.y : onGrid.y,
  };
}
