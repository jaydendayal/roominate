import { productFor, rotatedFootprint } from "./calculations";
import type { Project, Vec2 } from "./types";

const WALL_PREFERENCE_M = 0.02;
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
