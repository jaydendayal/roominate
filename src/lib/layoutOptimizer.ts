import { collidingItemIds, itemBounds, itemExceedsRoom, productFor, rotatedFootprint } from "./calculations";
import { frontFacesWall } from "./facing";
import { nearestWall, roomPolygon } from "./roomShape";
import type { Item, Project, Vec2 } from "./types";

const WALL_CATEGORIES = new Set(["bed", "bookshelf", "couch", "desk", "dresser", "mini_fridge", "mirror", "storage", "wardrobe"]);
const CENTER_CATEGORIES = new Set(["beanbag", "chair", "ottoman", "pouf", "seating"]);

export interface LayoutResult {
  project: Project;
  placedItemIds: string[];
  unplacedItemIds: string[];
  score: number;
  profile: LayoutProfile;
}

export type LayoutProfile = "balanced" | "open_center" | "functional_pairs";

interface Candidate {
  position: Vec2;
  rotationZ: number;
  score: number;
}

interface LayoutState {
  project: Project;
  score: number;
}

const categoryOf = (project: Project, item: Item) => (productFor(project, item)?.category ?? "other").toLowerCase().replaceAll("-", "_");

function dimensionsKnown(project: Project, item: Item) {
  const dimensions = productFor(project, item)?.dimensions;
  return dimensions != null && dimensions.width != null && dimensions.depth != null && dimensions.height != null
    && Number.isFinite(dimensions.width) && Number.isFinite(dimensions.depth) && Number.isFinite(dimensions.height)
    && dimensions.width > 0 && dimensions.depth > 0 && dimensions.height > 0;
}

function axisPoints(min: number, max: number, step: number) {
  if (![min, max, step].every(Number.isFinite) || max < min || step <= 0) return [];
  const values = [min, max, (min + max) / 2, min + (max - min) / 4, min + ((max - min) * 3) / 4];
  for (let value = min; value <= max + 1e-6; value += step) values.push(Math.min(max, value));
  return [...new Set(values.map((value) => Number(value.toFixed(3))))];
}

function distanceToFeature(project: Project, position: Vec2, kind: "door" | "window") {
  const distances = project.room.features.filter((feature) => feature.kind === kind).map((feature) => Math.hypot(position.x - feature.position.x, position.y - feature.position.y));
  return distances.length ? Math.min(...distances) : null;
}

function nearestPlaced(project: Project, item: Item, categories: ReadonlySet<string>) {
  const sameOwner: { item: Item; distance: number }[] = [];
  const anyone: { item: Item; distance: number }[] = [];
  for (const other of project.items) {
    if (other.id === item.id || !other.transform || !categories.has(categoryOf(project, other))) continue;
    const distance = Math.hypot(other.transform.position.x - (item.transform?.position.x ?? 0), other.transform.position.y - (item.transform?.position.y ?? 0));
    anyone.push({ item: other, distance });
    if (other.ownerId === item.ownerId) sameOwner.push({ item: other, distance });
  }
  return (sameOwner.length ? sameOwner : anyone).sort((a, b) => a.distance - b.distance)[0]?.item ?? null;
}

function relationshipCategories(category: string) {
  if (category === "chair") return new Set(["desk"]);
  if (category === "lamp" || category === "lighting") return new Set(["bed", "desk"]);
  if (category === "hamper" || category === "laundry_hamper") return new Set(["dresser", "storage", "wardrobe"]);
  if (category === "ottoman" || category === "pouf") return new Set(["chair", "couch", "seating"]);
  return null;
}

function candidateScore(project: Project, item: Item, position: Vec2, rotationZ: number, profile: LayoutProfile) {
  const category = categoryOf(project, item);
  const trialItem: Item = { ...item, transform: { position, rotationZ, elevation: 0 } };
  const bounds = itemBounds(project, trialItem);
  if (!bounds) return Number.POSITIVE_INFINITY;
  const wall = nearestWall(roomPolygon(project.room), position);
  const wallDistance = wall?.distance ?? Math.min(position.x, project.room.width - position.x, position.y, project.room.length - position.y);
  const centerDistance = Math.hypot(position.x - project.room.width / 2, position.y - project.room.length / 2);
  const roomRadius = Math.hypot(project.room.width, project.room.length) / 2 || 1;
  let score = 0;

  // Bulky pieces belong on the perimeter; loose seating may use the interior without filling its center.
  if (WALL_CATEGORIES.has(category)) score += wallDistance * (profile === "open_center" ? 22 : 16);
  else score += wallDistance * 2;
  score += Math.max(0, (profile === "open_center" ? 0.55 : 0.42) - centerDistance / roomRadius)
    * (CENTER_CATEGORIES.has(category) ? (profile === "open_center" ? 8 : 3) : (profile === "open_center" ? 22 : 12));

  // Align the long face with the nearest cardinal wall. This affects visual orientation even when the box is square.
  if (wall) {
    const parallelToX = Math.abs(wall.segment.end.x - wall.segment.start.x) >= Math.abs(wall.segment.end.y - wall.segment.start.y);
    const widthParallelToX = Math.abs(Math.cos(rotationZ)) >= Math.abs(Math.sin(rotationZ));
    if (parallelToX !== widthParallelToX) score += WALL_CATEGORIES.has(category) ? 1.25 : 0.2;
  }

  const doorDistance = distanceToFeature(project, position, "door");
  if (doorDistance != null) score += Math.max(0, 1.25 - doorDistance) * 18;
  const windowDistance = distanceToFeature(project, position, "window");
  if (windowDistance != null && category === "desk") score += Math.abs(windowDistance - 0.65) * 2.5;

  // Functional pairs are owner-aware first: each chair seeks its roommate's desk, for example.
  const relatedCategories = relationshipCategories(category);
  if (relatedCategories) {
    const withCandidate = { ...project, items: project.items.map((candidate) => candidate.id === item.id ? trialItem : candidate) };
    const related = nearestPlaced(withCandidate, trialItem, relatedCategories);
    if (related?.transform) {
      const relatedBounds = itemBounds(withCandidate, related);
      const desired = relatedBounds ? Math.max(0.55, Math.min(1.1, Math.max(relatedBounds.maxX - relatedBounds.minX, relatedBounds.maxY - relatedBounds.minY) * 0.65)) : 0.75;
      score += Math.abs(Math.hypot(position.x - related.transform.position.x, position.y - related.transform.position.y) - desired)
        * (profile === "functional_pairs" ? 15 : 7);
    }
  }

  // Spread repeated large pieces instead of forming one wall pile.
  for (const other of project.items) {
    if (!other.transform || other.id === item.id || categoryOf(project, other) !== category) continue;
    const distance = Math.hypot(position.x - other.transform.position.x, position.y - other.transform.position.y);
    score += Math.max(0, 1.15 - distance) * (WALL_CATEGORIES.has(category) ? 5 : 1.5);
  }

  return score;
}

function candidatesFor(project: Project, item: Item, profile: LayoutProfile) {
  const product = productFor(project, item);
  if (!product) return [];
  // About fifteen samples on the long axis at any room size. The old upper cap made large rooms
  // explode into tens of thousands of candidates and could freeze the browser.
  const step = Math.max(0.2, Math.max(project.room.width, project.room.length) / 15);
  const candidates: Candidate[] = [];
  for (const rotationZ of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const footprint = rotatedFootprint(product.dimensions, rotationZ);
    if (!footprint) continue;
    const xs = axisPoints(footprint.width / 2, project.room.width - footprint.width / 2, step);
    const ys = axisPoints(footprint.depth / 2, project.room.length - footprint.depth / 2, step);
    for (const x of xs) for (const y of ys) {
      const position = { x, y };
      // Dressers, desks, wardrobes, and fridges never get their drawers, seat side, or door against a wall.
      if (frontFacesWall(project.room, product, position, rotationZ)) continue;
      candidates.push({ position, rotationZ, score: candidateScore(project, item, position, rotationZ, profile) });
    }
  }
  return candidates.sort((a, b) => a.score - b.score).slice(0, 600);
}

function candidateBlocked(project: Project, item: Item) {
  if (itemExceedsRoom(project, item) || collidingItemIds(project, item).length) return true;
  const bounds = itemBounds(project, item);
  return bounds != null && project.room.clearanceZones.some((zone) => {
    const minX = zone.position.x - zone.width / 2;
    const maxX = zone.position.x + zone.width / 2;
    const minY = zone.position.y - zone.depth / 2;
    const maxY = zone.position.y + zone.depth / 2;
    return bounds.minX < maxX - 0.015 && bounds.maxX > minX + 0.015 && bounds.minY < maxY - 0.015 && bounds.maxY > minY + 0.015;
  });
}

function placementPriority(project: Project, item: Item) {
  const category = categoryOf(project, item);
  const product = productFor(project, item)!;
  const area = product.dimensions.width! * product.dimensions.depth!;
  const rank = category === "bed" ? 0
    : ["wardrobe", "storage", "dresser", "bookshelf"].includes(category) ? 1
      : category === "desk" ? 2
        : ["couch", "mini_fridge"].includes(category) ? 3
          : category === "chair" ? 5 : 4;
  return rank * 100 - area;
}

/**
 * Generates a collision-tested whole-room arrangement. Semantic scores decide what looks useful;
 * the existing deterministic geometry checks remain hard constraints.
 */
export function optimizeLayout(project: Project, options: { movableItemIds?: ReadonlySet<string>; profile?: LayoutProfile } = {}): LayoutResult {
  const profile = options.profile ?? "balanced";
  const validRoom = [project.room.width, project.room.length, project.room.height].every((value) => Number.isFinite(value) && value > 0);
  const movable = project.items.filter((item) => item.purchaseStatus !== "deferred" && !item.locked
    && validRoom && item.placementType === "floor" && dimensionsKnown(project, item)
    && (!options.movableItemIds || options.movableItemIds.has(item.id)));
  const movableIds = new Set(movable.map((item) => item.id));
  const base: Project = {
    ...project,
    items: project.items.map((item) => movableIds.has(item.id) ? { ...item, transform: null } : item),
  };
  const ordered = [...movable].sort((a, b) => placementPriority(project, a) - placementPriority(project, b) || a.id.localeCompare(b.id));
  let states: LayoutState[] = [{ project: base, score: 0 }];

  for (const source of ordered) {
    const expanded: LayoutState[] = [];
    for (const state of states) {
      const item = state.project.items.find((candidate) => candidate.id === source.id)!;
      let accepted = 0;
      for (const candidate of candidatesFor(state.project, item, profile)) {
        const trial: Project = {
          ...state.project,
          items: state.project.items.map((other) => other.id === item.id
            ? { ...other, transform: { position: candidate.position, rotationZ: candidate.rotationZ, elevation: source.transform?.elevation ?? 0 } }
            : other),
        };
        const placed = trial.items.find((candidateItem) => candidateItem.id === item.id)!;
        if (candidateBlocked(trial, placed)) continue;
        expanded.push({ project: trial, score: state.score + candidate.score });
        accepted += 1;
        if (accepted >= 18) break;
      }
      // A too-large item remains explicitly unplaced instead of corrupting the rest of the layout.
      if (!accepted) expanded.push({ project: state.project, score: state.score + 1_000 });
    }
    const unique = new Map<string, LayoutState>();
    for (const state of expanded.sort((a, b) => a.score - b.score)) {
      const fingerprint = state.project.items.filter((item) => movableIds.has(item.id)).map((item) => item.transform
        ? `${item.id}:${item.transform.position.x},${item.transform.position.y},${item.transform.rotationZ}` : `${item.id}:none`).join("|");
      if (!unique.has(fingerprint)) unique.set(fingerprint, state);
      if (unique.size >= 10) break;
    }
    states = [...unique.values()];
  }

  const winner = states.sort((a, b) => a.score - b.score)[0] ?? { project: base, score: 0 };
  const placedItemIds = ordered.filter((item) => winner.project.items.find((candidate) => candidate.id === item.id)?.transform).map((item) => item.id);
  return {
    project: winner.project,
    placedItemIds,
    unplacedItemIds: ordered.filter((item) => !placedItemIds.includes(item.id)).map((item) => item.id),
    score: Number(winner.score.toFixed(3)),
    profile,
  };
}

/** Collision-free alternatives for the AI adviser to compare; geometry has already been enforced in code. */
export function generateLayoutCandidates(project: Project) {
  const seen = new Set<string>();
  const candidates = (["balanced", "open_center", "functional_pairs"] as const).map((profile) => optimizeLayout(project, { profile })).filter((result) => {
    const fingerprint = result.project.items.map((item) => item.transform
      ? `${item.id}:${item.transform.position.x},${item.transform.position.y},${item.transform.rotationZ}` : `${item.id}:none`).join("|");
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
  return candidates[0] && candidates[0].placedItemIds.length + candidates[0].unplacedItemIds.length > 0 ? candidates : [];
}
