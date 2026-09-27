import { needInfo, uncoveredRequiredNeeds } from "./needs";
import { convexInsidePolygon, hasShapedOutline, nearestWallFacing, roomPolygon } from "./roomShape";
import type { Dimensions, DuplicateResolution, Issue, Item, Product, Project, RoomFeature, Vec2 } from "./types";

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function cents(amount: number, currency = "USD") {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount / 100);
}

export function productFor(project: Project, item: Item): Product | undefined {
  return project.products.find((product) => product.id === item.productId);
}

export function rotatedFootprint(dimensions: Dimensions, rotationZ: number) {
  if (dimensions.width == null || dimensions.depth == null) return null;
  const c = Math.abs(Math.cos(rotationZ));
  const s = Math.abs(Math.sin(rotationZ));
  return {
    width: dimensions.width * c + dimensions.depth * s,
    depth: dimensions.width * s + dimensions.depth * c,
  };
}

export function itemBounds(project: Project, item: Item): Bounds | null {
  if (!item.transform) return null;
  const product = productFor(project, item);
  if (!product) return null;
  const footprint = rotatedFootprint(product.dimensions, item.transform.rotationZ);
  if (!footprint) return null;
  return {
    minX: item.transform.position.x - footprint.width / 2,
    maxX: item.transform.position.x + footprint.width / 2,
    minY: item.transform.position.y - footprint.depth / 2,
    maxY: item.transform.position.y + footprint.depth / 2,
  };
}

/** Corners of the item's footprint on the floor, turned by its rotation. */
function itemCorners(project: Project, item: Item): Vec2[] | null {
  if (!item.transform) return null;
  const dimensions = productFor(project, item)?.dimensions;
  if (dimensions?.width == null || dimensions.depth == null) return null;
  const { position, rotationZ } = item.transform;
  const cos = Math.cos(rotationZ);
  const sin = Math.sin(rotationZ);
  const halfWidth = dimensions.width / 2;
  const halfDepth = dimensions.depth / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
    x: position.x + sx * halfWidth * cos - sy * halfDepth * sin,
    y: position.y + sx * halfWidth * sin + sy * halfDepth * cos,
  }));
}

/** True when the footprint crosses a wall: the room rectangle's, or a traced outline's. */
function footprintOutsideRoom(project: Project, item: Item, bounds: Bounds) {
  const { room } = project;
  if (!hasShapedOutline(room)) return bounds.minX < 0 || bounds.maxX > room.width || bounds.minY < 0 || bounds.maxY > room.length;
  const corners = itemCorners(project, item);
  return corners != null && !convexInsidePolygon(corners, roomPolygon(room));
}

/** The wall a feature belongs to: its recorded wall, or else the nearest one. */
export function featureWall(feature: RoomFeature, project: Project): NonNullable<RoomFeature["wall"]> {
  if (feature.wall && feature.wall !== "unknown") return feature.wall;
  return nearestWallFacing(project.room, feature.position);
}

export function itemElevation(item: Item) {
  return item.transform?.elevation ?? 0;
}

function overlap(a: Bounds, b: Bounds, epsilon = 0.015) {
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon && a.minY < b.maxY - epsilon && a.maxY > b.minY + epsilon;
}

const VERTICAL_EPSILON = 0.005;

function verticalOverlap(aBottom: number, aTop: number, bBottom: number, bTop: number) {
  return aBottom < bTop - VERTICAL_EPSILON && aTop > bBottom + VERTICAL_EPSILON;
}

interface ItemBox extends Bounds {
  bottom: number;
  top: number;
}

function itemBox(project: Project, item: Item): ItemBox | null {
  const bounds = itemBounds(project, item);
  const height = productFor(project, item)?.dimensions.height;
  if (!bounds || height == null) return null;
  const bottom = itemElevation(item);
  return { ...bounds, bottom, top: bottom + height };
}

/**
 * True when any part of the item's collision box pokes out of the room's bounding box: its overall
 * width and length, the floor, or the ceiling. For a rectangular room this is the same as leaving the room.
 */
export function itemExceedsRoomBox(project: Project, item: Item) {
  const box = itemBox(project, item);
  if (!box) return false;
  const { width, length, height } = project.room;
  return box.minX < 0 || box.maxX > width || box.minY < 0 || box.maxY > length
    || box.bottom < -VERTICAL_EPSILON || box.top > height + VERTICAL_EPSILON;
}

/** True when any part of the item's collision box pokes through a wall (including a traced outline's), the floor, or the ceiling. */
export function itemExceedsRoom(project: Project, item: Item) {
  const box = itemBox(project, item);
  if (!box) return false;
  return itemExceedsRoomBox(project, item) || footprintOutsideRoom(project, item, box);
}

/** Ids of other placed items whose collision boxes intersect `item` (footprint only when `footprintOnly`). */
export function collidingItemIds(project: Project, item: Item, footprintOnly = false) {
  const box = itemBox(project, item);
  if (!box) return [];
  return project.items
    .filter((other) => other.id !== item.id && other.purchaseStatus !== "deferred")
    .filter((other) => {
      const otherBox = itemBox(project, other);
      return otherBox != null && overlap(box, otherBox) && (footprintOnly || verticalOverlap(box.bottom, box.top, otherBox.bottom, otherBox.top));
    })
    .map((other) => other.id);
}

/**
 * True when `item` would get a fit or clearance issue from `physicalIssues`: crossing a wall, the
 * floor, or the ceiling, in a keep-clear area, or colliding with another item. Checks only this
 * item's pairs, so placement searches can call it per candidate spot.
 */
export function placementBlocked(project: Project, item: Item) {
  const bounds = itemBounds(project, item);
  if (!bounds) return false;
  const height = productFor(project, item)?.dimensions.height;
  const elevation = itemElevation(item);
  if (footprintOutsideRoom(project, item, bounds) || elevation < -VERTICAL_EPSILON) return true;
  if (height != null && elevation + height > project.room.height + VERTICAL_EPSILON) return true;
  if (project.room.clearanceZones.some((zone) => overlap(bounds, zoneBounds(zone.position, zone.width, zone.depth)))) return true;
  const box = itemBox(project, item);
  return project.items.some((other) => {
    if (other.id === item.id || other.purchaseStatus === "deferred") return false;
    const otherBounds = itemBounds(project, other);
    if (!otherBounds || !overlap(bounds, otherBounds)) return false;
    // Without a known height, stay conservative and treat overlapping footprints as a collision.
    const otherBox = itemBox(project, other);
    return !(box && otherBox && !verticalOverlap(box.bottom, box.top, otherBox.bottom, otherBox.top));
  });
}

/** True when the item sits on the floor or on top of another item rather than floating or sinking. */
export function restsOnSurface(project: Project, item: Item) {
  const elevation = itemElevation(item);
  if (Math.abs(elevation) <= VERTICAL_EPSILON) return true;
  return collidingItemIds(project, item, true).some((id) => {
    const other = project.items.find((candidate) => candidate.id === id);
    const otherBox = other ? itemBox(project, other) : null;
    return otherBox != null && Math.abs(otherBox.top - elevation) <= VERTICAL_EPSILON;
  });
}

/** True when some other placed item sits under the item's footprint, at or below its base (resting on it or hovering over it). */
export function isAboveItem(project: Project, item: Item, ignoreIds: ReadonlySet<string> = new Set()) {
  const box = itemBox(project, item);
  if (!box) return false;
  return collidingItemIds(project, item, true).some((id) => {
    if (ignoreIds.has(id)) return false;
    const other = project.items.find((candidate) => candidate.id === id);
    const otherBox = other ? itemBox(project, other) : null;
    return otherBox != null && otherBox.top <= box.bottom + VERTICAL_EPSILON;
  });
}

/** True when moving the item to `position` carries it off the top of another item and out over open floor. */
export function leavesSurface(project: Project, item: Item, position: Vec2, ignoreIds: ReadonlySet<string> = new Set()) {
  if (!item.transform || !isAboveItem(project, item, ignoreIds)) return false;
  return !isAboveItem(project, { ...item, transform: { ...item.transform, position } }, ignoreIds);
}

/**
 * Lowest elevation at or above `desired` where the item no longer intersects other placed items,
 * so an item moved into another one ends up resting on top of it instead of inside it.
 */
export function stackedElevation(project: Project, item: Item, desired: number, ignoreIds: ReadonlySet<string> = new Set()) {
  const candidate: Item = item.transform ? { ...item, transform: { ...item.transform, elevation: desired } } : item;
  const box = itemBox(project, candidate);
  if (!box) return desired;
  const height = box.top - box.bottom;
  // Sorted by bottom, a single upward pass settles on the first free gap: once an obstacle is
  // entirely above the item, raising past a later obstacle (with a higher bottom) never happens.
  const obstacles = collidingItemIds(project, candidate, true)
    .filter((id) => !ignoreIds.has(id))
    .map((id) => itemBox(project, project.items.find((other) => other.id === id)!))
    .filter((other): other is ItemBox => other != null)
    .sort((a, b) => a.bottom - b.bottom);
  let elevation = desired;
  for (const obstacle of obstacles) {
    if (verticalOverlap(elevation, elevation + height, obstacle.bottom, obstacle.top)) elevation = obstacle.top;
  }
  return elevation;
}

/**
 * Elevation for an item moved horizontally to `position`. Items resting on the floor or another item follow
 * surfaces, items carried off the top of another item drop back to the floor, and items moved into another
 * item end up on top of it. Only items floating over open floor keep their height. Items already intersecting
 * the moved item are ignored while their footprints still overlap, so existing collisions don't make it jump.
 */
export function settledElevation(project: Project, item: Item, position: Vec2) {
  if (!item.transform) return 0;
  const moved: Item = { ...item, transform: { ...item.transform, position } };
  const stillOverlapping = new Set(collidingItemIds(project, moved, true));
  const ignored = new Set(collidingItemIds(project, item).filter((id) => stillOverlapping.has(id)));
  // A raised bed is an under-bed zone, not an automatic stacking surface. Floor furniture that is
  // too tall stays on the floor and reports a collision instead of unexpectedly jumping onto the
  // mattress. An item that was deliberately placed on the bed remains supported while it moves.
  const currentElevation = itemElevation(item);
  const supportingIds = new Set(collidingItemIds(project, item, true).filter((id) => {
    const other = project.items.find((candidate) => candidate.id === id);
    const otherBox = other ? itemBox(project, other) : null;
    return otherBox != null && Math.abs(otherBox.top - currentElevation) <= VERTICAL_EPSILON;
  }));
  for (const other of project.items) {
    const product = productFor(project, other);
    if (product?.category.toLowerCase() === "bed" && itemElevation(other) > VERTICAL_EPSILON && !supportingIds.has(other.id)) ignored.add(other.id);
  }
  const followsSurface = restsOnSurface(project, item) || leavesSurface(project, item, position, ignored);
  const remainsOnCurrentSupport = [...supportingIds].some((id) => stillOverlapping.has(id));
  return stackedElevation(project, moved, remainsOnCurrentSupport ? currentElevation : followsSurface ? 0 : currentElevation, ignored);
}

function zoneBounds(position: Vec2, width: number, depth: number): Bounds {
  return {
    minX: position.x - width / 2,
    maxX: position.x + width / 2,
    minY: position.y - depth / 2,
    maxY: position.y + depth / 2,
  };
}

export function purchaseSubtotal(project: Project) {
  let complete = true;
  const amount = project.items.reduce((total, item) => {
    if (item.purchaseStatus !== "in_cart") return total;
    const product = productFor(project, item);
    if (!product?.price) {
      complete = false;
      return total;
    }
    return total + product.price.amount * item.quantity;
  }, 0);
  return { amount, complete };
}

export function duplicateKey(a: Item, b: Item) {
  return [a.id, b.id].sort().join("::");
}

function unresolvedDuplicate(resolution: DuplicateResolution | undefined) {
  return !resolution;
}

export interface IssueOptions {
  /** Formats a meter length for issue text; defaults to meters. */
  formatLength?: (meters: number) => string;
}

const formatMeters = (meters: number) => `${meters.toFixed(2)} m`;

/** Geometry-only checks (missing dimensions, placement, boundary, ceiling, clearance, overlap). */
export function physicalIssues(project: Project, { formatLength = formatMeters }: IssueOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const activeItems = project.items.filter((item) => item.purchaseStatus !== "deferred");

  for (const item of activeItems) {
    const product = productFor(project, item);
    if (!product) continue;
    const dimensionsKnown = Object.values(product.dimensions).every((value) => value != null && value > 0);
    if (!dimensionsKnown) {
      issues.push({
        id: `missing-${item.id}`,
        type: "missing_data",
        severity: "warning",
        confidence: "confirmed",
        affectedItemIds: [item.id],
        affectedGeometryIds: [],
        message: `${product.name} needs dimensions`,
        detail: "Fit stays unverified until width, depth, and height are confirmed.",
        suggestedActions: ["Enter dimensions", "Review source"],
        status: "open",
      });
    }
    if (item.purchaseStatus === "in_cart" && !item.transform) {
      issues.push({
        id: `unplaced-${item.id}`,
        type: "missing_data",
        severity: "info",
        confidence: "confirmed",
        affectedItemIds: [item.id],
        affectedGeometryIds: [],
        message: `${product.name} is not placed`,
        detail: "It counts toward spending, but its fit is unverified.",
        suggestedActions: ["Place in room"],
        status: "open",
      });
    }
    const bounds = itemBounds(project, item);
    if (bounds) {
      if (footprintOutsideRoom(project, item, bounds)) {
        issues.push({
          id: `boundary-${item.id}`,
          type: "fit",
          severity: "error",
          confidence: "confirmed",
          affectedItemIds: [item.id],
          affectedGeometryIds: [project.room.id],
          message: `${product.name} extends outside the room`,
          detail: "Its measured collision box crosses a confirmed room boundary.",
          suggestedActions: ["Move item", "Rotate item", "Try a smaller alternative"],
          status: "open",
        });
      }
      const elevation = itemElevation(item);
      if (elevation < -VERTICAL_EPSILON) {
        issues.push({
          id: `floor-${item.id}`,
          type: "fit",
          severity: "error",
          confidence: "confirmed",
          affectedItemIds: [item.id],
          affectedGeometryIds: [project.room.id],
          message: `${product.name} sinks below the floor`,
          detail: `Its base sits ${formatLength(Math.abs(elevation))} under the floor.`,
          suggestedActions: ["Raise item"],
          status: "open",
        });
      }
      if (product.dimensions.height != null && elevation + product.dimensions.height > project.room.height + VERTICAL_EPSILON) {
        issues.push({
          id: `ceiling-${item.id}`,
          type: "fit",
          severity: "error",
          confidence: "confirmed",
          affectedItemIds: [item.id],
          affectedGeometryIds: [project.room.id],
          message: `${product.name} exceeds ceiling height`,
          detail: elevation > VERTICAL_EPSILON
            ? `Its top reaches ${formatLength(elevation + product.dimensions.height)} vs a ${formatLength(project.room.height)} ceiling.`
            : `${formatLength(product.dimensions.height)} item vs ${formatLength(project.room.height)} room.`,
          suggestedActions: elevation > VERTICAL_EPSILON ? ["Lower item", "Choose a shorter item"] : ["Choose a shorter item"],
          status: "open",
        });
      }
      for (const zone of project.room.clearanceZones) {
        if (overlap(bounds, zoneBounds(zone.position, zone.width, zone.depth))) {
          issues.push({
            id: `clearance-${item.id}-${zone.id}`,
            type: "clearance",
            severity: zone.confirmed ? "error" : "warning",
            confidence: zone.confirmed ? "confirmed" : "uncertain",
            affectedItemIds: [item.id],
            affectedGeometryIds: [zone.id],
            message: `${product.name} blocks ${zone.name.toLowerCase()}`,
            detail: `The collision box overlaps a ${zone.confirmed ? "confirmed" : "unverified"} keep-clear area.`,
            suggestedActions: ["Reposition item", "Review clearance"],
            status: "open",
          });
        }
      }
    }
  }

  for (let i = 0; i < activeItems.length; i += 1) {
    for (let j = i + 1; j < activeItems.length; j += 1) {
      const a = activeItems[i];
      const b = activeItems[j];
      const aBounds = itemBounds(project, a);
      const bBounds = itemBounds(project, b);
      const aBox = itemBox(project, a);
      const bBox = itemBox(project, b);
      // Without a known height, stay conservative and treat overlapping footprints as a collision.
      const stackedClear = aBox != null && bBox != null && !verticalOverlap(aBox.bottom, aBox.top, bBox.bottom, bBox.top);
      if (aBounds && bBounds && overlap(aBounds, bBounds) && !stackedClear) {
        issues.push({
          id: `overlap-${[a.id, b.id].sort().join("-")}`,
          type: "fit",
          severity: "error",
          confidence: "confirmed",
          affectedItemIds: [a.id, b.id],
          affectedGeometryIds: [],
          message: `${productFor(project, a)?.name} overlaps ${productFor(project, b)?.name}`,
          detail: "Their dimensionally scaled collision boxes intersect.",
          suggestedActions: ["Move one item", "Rotate one item"],
          status: "open",
        });
      }
    }
  }

  return issues;
}

export function calculateIssues(project: Project, options: IssueOptions = {}): Issue[] {
  const issues = physicalIssues(project, options);
  const activeItems = project.items.filter((item) => item.purchaseStatus !== "deferred");

  const subtotal = purchaseSubtotal(project);
  if (!subtotal.complete) {
    issues.push({
      id: "budget-incomplete",
      type: "budget",
      severity: "warning",
      confidence: "confirmed",
      affectedItemIds: project.items.filter((item) => item.purchaseStatus === "in_cart" && !productFor(project, item)?.price).map((item) => item.id),
      affectedGeometryIds: [],
      message: "Cart total is incomplete",
      detail: "At least one selected item has no confirmed price.",
      suggestedActions: ["Enter missing prices"],
      status: "open",
    });
  } else if (subtotal.amount > project.budgetAmount) {
    issues.push({
      id: "budget-over",
      type: "budget",
      severity: "error",
      confidence: "confirmed",
      affectedItemIds: project.items.filter((item) => item.purchaseStatus === "in_cart").map((item) => item.id),
      affectedGeometryIds: [],
      message: `${cents(subtotal.amount - project.budgetAmount)} over budget`,
      detail: `${cents(subtotal.amount)} selected against a ${cents(project.budgetAmount)} limit; shipping and tax are not included.`,
      suggestedActions: ["Review optional items", "Compare alternatives"],
      status: "open",
    });
  }

  for (const need of uncoveredRequiredNeeds(project).map(needInfo)) {
    issues.push({
      id: `need-${need.id}`,
      type: "unmet_need",
      severity: "warning",
      confidence: "confirmed",
      affectedItemIds: [],
      affectedGeometryIds: [],
      message: `Nothing in the plan covers ${need.label.toLowerCase()}`,
      detail: `${need.label} is a required function in Constraints, but no item in the plan provides it. Add ${need.suggestion}, or bring back a deferred one.`,
      suggestedActions: [`Add ${need.suggestion}`, "Remove the requirement in Constraints"],
      status: "open",
    });
  }

  const cartItems = activeItems.filter((item) => item.purchaseStatus === "in_cart");
  for (let i = 0; i < cartItems.length; i += 1) {
    for (let j = i + 1; j < cartItems.length; j += 1) {
      const a = cartItems[i];
      const b = cartItems[j];
      if (a.ownerId === b.ownerId) continue;
      const productA = productFor(project, a);
      const productB = productFor(project, b);
      if (!productA || !productB) continue;
      const sameProduct = productA.id === productB.id;
      const sharedNeed = a.needsServed.some((need) => b.needsServed.includes(need));
      const sameCategory = productA.category.toLowerCase() === productB.category.toLowerCase();
      if (sameProduct || sameCategory || sharedNeed) {
        const key = duplicateKey(a, b);
        if (!unresolvedDuplicate(project.duplicateResolutions[key])) continue;
        const ownerA = project.people.find((person) => person.id === a.ownerId)?.name ?? "Roommate";
        const ownerB = project.people.find((person) => person.id === b.ownerId)?.name ?? "Roommate";
        issues.push({
          id: `duplicate-${key}`,
          type: "duplicate",
          severity: "warning",
          confidence: sameProduct || sameCategory ? "confirmed" : "likely",
          affectedItemIds: [a.id, b.id],
          affectedGeometryIds: [],
          message: `${ownerA} and ${ownerB} may be buying the same thing`,
          detail: `${productA.name} (${productA.price ? cents(productA.price.amount) : "unknown price"}) and ${productB.name} (${productB.price ? cents(productB.price.amount) : "unknown price"}) both serve ${a.needsServed.find((need) => b.needsServed.includes(need)) ?? productA.category}.`,
          suggestedActions: ["Mark intentional", "Choose one to keep", "Coordinate buyer"],
          status: "open",
        });
      }
    }
  }

  for (const item of activeItems) {
    const product = productFor(project, item);
    if (!product) continue;
    for (const rule of project.rules.filter((candidate) => !candidate.dismissed)) {
      const categoryMatch = rule.prohibitedCategories.includes(product.category);
      const tagMatch = product.tags.some((tag) => rule.prohibitedTags.includes(tag));
      if (categoryMatch || tagMatch) {
        issues.push({
          id: `rule-${rule.id}-${item.id}`,
          type: "rule",
          severity: rule.verificationStatus === "confirmed" ? "error" : "warning",
          confidence: rule.verificationStatus === "confirmed" ? "confirmed" : "likely",
          affectedItemIds: [item.id],
          affectedGeometryIds: [],
          message: `${product.name} conflicts with ${rule.label}`,
          detail: `${rule.text} ${rule.sourceType === "user_note" ? "Source: user-entered note." : "Source: linked policy."}`,
          suggestedActions: ["Remove item", "Review rule", "Dismiss with reason"],
          status: "open",
        });
      }
    }
  }

  return issues;
}

export function itemHasConflict(issues: Issue[], itemId: string) {
  return issues.some((issue) => issue.severity === "error" && issue.affectedItemIds.includes(itemId));
}
