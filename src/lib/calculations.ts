import type { Dimensions, DuplicateResolution, Issue, Item, Product, Project, Vec2 } from "./types";

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function cents(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

export function productFor(project: Project, item: Item): Product | undefined {
  return project.products.find((product) => product.id === item.productId);
}

export function rotatedFootprint(dimensions: Dimensions, rotationY: number) {
  if (dimensions.width == null || dimensions.depth == null) return null;
  const c = Math.abs(Math.cos(rotationY));
  const s = Math.abs(Math.sin(rotationY));
  return {
    width: dimensions.width * c + dimensions.depth * s,
    depth: dimensions.width * s + dimensions.depth * c,
  };
}

export function itemBounds(project: Project, item: Item): Bounds | null {
  if (!item.transform) return null;
  const product = productFor(project, item);
  if (!product) return null;
  const footprint = rotatedFootprint(product.dimensions, item.transform.rotationY);
  if (!footprint) return null;
  return {
    minX: item.transform.position.x - footprint.width / 2,
    maxX: item.transform.position.x + footprint.width / 2,
    minZ: item.transform.position.z - footprint.depth / 2,
    maxZ: item.transform.position.z + footprint.depth / 2,
  };
}

function overlap(a: Bounds, b: Bounds, epsilon = 0.015) {
  return a.minX < b.maxX - epsilon && a.maxX > b.minX + epsilon && a.minZ < b.maxZ - epsilon && a.maxZ > b.minZ + epsilon;
}

function zoneBounds(position: Vec2, width: number, depth: number): Bounds {
  return {
    minX: position.x - width / 2,
    maxX: position.x + width / 2,
    minZ: position.z - depth / 2,
    maxZ: position.z + depth / 2,
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

export function calculateIssues(project: Project, { formatLength = formatMeters }: IssueOptions = {}): Issue[] {
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
      if (bounds.minX < 0 || bounds.maxX > project.room.width || bounds.minZ < 0 || bounds.maxZ > project.room.length) {
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
      if (product.dimensions.height != null && product.dimensions.height > project.room.height) {
        issues.push({
          id: `ceiling-${item.id}`,
          type: "fit",
          severity: "error",
          confidence: "confirmed",
          affectedItemIds: [item.id],
          affectedGeometryIds: [project.room.id],
          message: `${product.name} exceeds ceiling height`,
          detail: `${formatLength(product.dimensions.height)} item vs ${formatLength(project.room.height)} room.`,
          suggestedActions: ["Choose a shorter item"],
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
      if (aBounds && bBounds && overlap(aBounds, bBounds)) {
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
