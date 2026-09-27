import { calculateIssues, cents, physicalIssues, productFor, purchaseSubtotal } from "./calculations";
import { frontFacesWall, hasFront } from "./facing";
import { needInfo, type NeedId, uncoveredRequiredNeeds } from "./needs";
import { priorityInfo, priorityOrder, ranksAbove } from "./priorities";
import type { Issue, Item, Product, Project, Proposal, ProposalChange, Vec2 } from "./types";

// Better Cart: deterministic candidate generation for any project (no fixture IDs).
// Hard constraints (confirmed rules, room geometry, locked items) are resolved first,
// then duplicates, fit, clearance, and finally budget. Every geometric change is
// validated with the same physical checks the app uses. The group's ranked priorities
// decide the tradeoffs (swap or move, swap or defer, whose purchase goes first), and
// Better Cart never defers the last item covering a required function.

interface Placement {
  position: Vec2;
  rotationZ: number;
}

function applyChange(project: Project, change: ProposalChange): Project {
  return {
    ...project,
    items: project.items.map((item): Item => {
      if (item.id !== change.itemId) return item;
      if (change.type === "replace" && change.replacementProductId) {
        return { ...item, productId: change.replacementProductId, transform: change.position ? { position: change.position, rotationZ: change.rotationZ ?? 0 } : item.transform };
      }
      if (change.type === "remove" || change.type === "defer") {
        return { ...item, purchaseStatus: "deferred", transform: null };
      }
      if (change.type === "reposition" && change.position) {
        return { ...item, transform: { position: change.position, rotationZ: change.rotationZ ?? item.transform?.rotationZ ?? 0 } };
      }
      return item;
    }),
    cartVersion: project.cartVersion + 1,
  };
}

const active = (project: Project) => project.items.filter((item) => item.purchaseStatus !== "deferred");
const dimensionsKnown = (product: Product) => Object.values(product.dimensions).every((value) => value != null && value > 0);
const lineCost = (product: Product | undefined, item: Item) => (product?.price ? product.price.amount * item.quantity : 0);
const overBudget = (project: Project) => purchaseSubtotal(project).amount - project.budgetAmount;

function ownerName(project: Project, item: Item) {
  return project.people.find((person) => person.id === item.ownerId)?.name ?? "A roommate";
}

function violatesConfirmedRule(project: Project, product: Product) {
  return project.rules.some((rule) => !rule.dismissed && rule.verificationStatus === "confirmed"
    && (rule.prohibitedCategories.includes(product.category) || product.tags.some((tag) => rule.prohibitedTags.includes(tag))));
}

/** Needs served by `item` that no other active item would still cover after the change. */
function uncoveredNeeds(after: Project, item: Item) {
  return item.needsServed.filter((need) => !active(after).some((other) => other.id !== item.id && other.needsServed.includes(need)));
}

/** Required needs that `after` leaves uncovered but `before` covered. */
function requiredNeedsLost(before: Project, after: Project): NeedId[] {
  const already = new Set(uncoveredRequiredNeeds(before));
  return uncoveredRequiredNeeds(after).filter((need) => !already.has(need));
}

/** What an owner has in the cart right now. */
const spendOf = (project: Project, ownerId: string) => active(project)
  .filter((item) => item.ownerId === ownerId && item.purchaseStatus === "in_cart")
  .reduce((sum, item) => sum + lineCost(productFor(project, item), item), 0);

function needImpact(after: Project, item: Item) {
  const lost = uncoveredNeeds(after, item);
  if (!lost.length) return "every need it served is still covered";
  return `${lost.join(", ")} would no longer be covered (${item.essentiality} item)`;
}

function moved(base: Project, item: Item) {
  const original = base.items.find((candidate) => candidate.id === item.id);
  if (!original?.transform || !item.transform) return Boolean(item.transform);
  return original.productId !== item.productId
    || original.transform.position.x !== item.transform.position.x
    || original.transform.position.y !== item.transform.position.y
    || original.transform.rotationZ !== item.transform.rotationZ;
}

/**
 * Obstacles for a placement search: every other item at its original spot plus a copy at any
 * already-proposed new spot. A placement that clears both stays valid for any subset of accepted changes.
 */
function placementWorld(base: Project, proposed: Project, itemId: string): Project {
  const ghosts = proposed.items
    .filter((item) => item.id !== itemId && item.purchaseStatus !== "deferred" && item.transform && moved(base, item))
    .map((item) => ({ ...item, id: `ghost-${item.id}` }));
  return { ...base, items: [...base.items, ...ghosts] };
}

/** Nearest collision- and clearance-free placement for `itemId` (optionally as `productId`), or null. */
function findSafePlacement(base: Project, proposed: Project, itemId: string, productId?: string): Placement | null {
  const world = placementWorld(base, proposed, itemId);
  const source = world.items.find((item) => item.id === itemId);
  const product = world.products.find((candidate) => candidate.id === (productId ?? source?.productId));
  if (!source || !product || !dimensionsKnown(product) || product.dimensions.height! > world.room.height) return null;
  const { width, length } = world.room;
  const anchor = source.transform?.position ?? { x: width / 2, y: length / 2 };
  const baseRotation = source.transform?.rotationZ ?? 0;
  const step = Math.max(0.05, Math.min(0.15, Math.max(width, length) / 40));
  const candidates: (Placement & { distance: number })[] = [];
  // Pieces with drawers or doors may turn all the way round, so their front can face into the room from any wall.
  const turns = hasFront(product) ? [0, 1, 2, 3] : [0, 1];
  for (const turn of turns) {
    const rotationZ = baseRotation + (turn * Math.PI) / 2;
    for (let x = step / 2; x < width; x += step) {
      for (let y = step / 2; y < length; y += step) {
        const position = { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
        // Their drawers, doors, or seat side never face a wall.
        if (frontFacesWall(world.room, product, position, rotationZ)) continue;
        // Small penalty for rotating so an unrotated spot wins ties.
        candidates.push({ position, rotationZ, distance: Math.hypot(position.x - anchor.x, position.y - anchor.y) + (turn === 0 ? 0 : 0.05 * turn) });
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const { position, rotationZ } of candidates) {
    const trial: Project = { ...world, items: world.items.map((item) => item.id === itemId ? { ...item, productId: product.id, transform: { position, rotationZ } } : item) };
    const blocked = physicalIssues(trial).some((issue) => (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(itemId));
    if (!blocked) return { position, rotationZ };
  }
  return null;
}

interface Substitute {
  product: Product;
  placement: Placement | null;
  savings: number;
}

/** Equivalent products (same alternative group or category) with verified dimensions and price that fit and are permitted. */
function substitutes(base: Project, proposed: Project, item: Item): Substitute[] {
  const current = productFor(proposed, item);
  if (!current || item.purchaseStatus !== "in_cart") return [];
  const options: Substitute[] = [];
  for (const product of proposed.products) {
    const sameGroup = Boolean(current.alternativeGroupId && product.alternativeGroupId === current.alternativeGroupId);
    // Built-in shortlist entries are browseable modeling references, not user-approved
    // equivalents, unless placed in the same alternative group as the current item.
    // Once added to the cart they still participate in every issue check.
    if ((product.tags.includes("shortlist") && !sameGroup) || product.id === current.id || !product.price || !dimensionsKnown(product) || violatesConfirmedRule(proposed, product)) continue;
    const equivalent = sameGroup || product.category === current.category;
    if (!equivalent) continue;
    const placement = item.transform ? findSafePlacement(base, proposed, item.id, product.id) : null;
    if (item.transform && !placement) continue;
    if (!item.transform && product.dimensions.height! > proposed.room.height) continue;
    options.push({ product, placement, savings: lineCost(current, item) - product.price.amount * item.quantity });
  }
  return options.sort((a, b) => b.savings - a.savings);
}

function replaceChange(project: Project, item: Item, option: Substitute, reason: string): ProposalChange {
  const saving = option.savings > 0 ? `Saves ${cents(option.savings)}` : option.savings < 0 ? `Costs ${cents(-option.savings)} more` : "Same price";
  const needs = item.needsServed.length ? `keeps ${item.needsServed.join(", ")} covered` : "same category";
  return {
    id: `change-replace-${item.id}`,
    type: "replace",
    itemId: item.id,
    replacementProductId: option.product.id,
    position: option.placement?.position,
    rotationZ: option.placement?.rotationZ,
    reason,
    impact: `${saving}; ${needs}${option.placement ? "; placement collision-tested" : "; still unplaced, so fit stays unverified"}.`,
    confidence: option.placement || !item.transform ? "confirmed" : "uncertain",
    accepted: null,
  };
}

/** Short clause for why an item doesn't fit, e.g. "it overlaps FLINTAN". */
function fitProblem(project: Project, issue: Issue, itemId: string) {
  if (issue.id.startsWith("ceiling-")) return "it is taller than the ceiling";
  if (issue.id.startsWith("boundary-")) return "it extends past a wall";
  const other = project.items.find((item) => item.id !== itemId && issue.affectedItemIds.includes(item.id));
  return `it overlaps ${other ? productFor(project, other)?.name ?? "another item" : "another item"}`;
}

function worstFitIssue(issues: Issue[], itemId: string) {
  return issues.find((issue) => issue.type === "fit" && issue.affectedItemIds.includes(itemId) && !issue.id.startsWith("overlap-"))
    ?? issues.find((issue) => issue.type === "fit" && issue.affectedItemIds.includes(itemId));
}

export function generateProposal(project: Project): Proposal {
  const beforeIssues = calculateIssues(project);
  const changes: ProposalChange[] = [];
  const blockers: string[] = [];
  const touched = new Set<string>();
  let proposed = project;
  const name = (item: Item) => productFor(proposed, item)?.name ?? "This item";
  const editable = (item: Item) => !item.locked && !touched.has(item.id);
  const push = (change: ProposalChange) => {
    changes.push(change);
    touched.add(change.itemId);
    proposed = applyChange(proposed, change);
  };
  const deferred = (item: Item) => applyChange(proposed, { id: "", type: "defer", itemId: item.id, reason: "", impact: "", confidence: "confirmed", accepted: null });
  const keepsRequiredNeeds = (item: Item) => !requiredNeedsLost(proposed, deferred(item)).length;

  // Priorities: may budget swap out chosen products, and does an even split outrank the biggest saving?
  const order = priorityOrder(project);
  const budgetSwaps = ranksAbove(order, "budget", "keep_picks");
  const evenFirst = ranksAbove(order, "even_split", "budget");
  /** Which purchase to cut first: biggest saving, or the bigger spender's, whichever ranks higher. */
  const cutFirst = (a: { item: Item; savings: number }, b: { item: Item; savings: number }) => {
    const bySavings = b.savings - a.savings;
    const bySpend = spendOf(proposed, b.item.ownerId) - spendOf(proposed, a.item.ownerId);
    return evenFirst ? bySpend || bySavings : bySavings || bySpend;
  };
  /** " Jay is spending the most ($120)." when an even split picked this owner's item. */
  const evenSplitNote = (item: Item) => {
    const spend = spendOf(proposed, item.ownerId);
    const others = proposed.people.filter((person) => person.id !== item.ownerId).map((person) => spendOf(proposed, person.id));
    return evenFirst && others.length && others.every((other) => spend > other) ? ` ${ownerName(proposed, item)} is spending the most (${cents(spend)}), and you rank keeping spending even above the biggest saving.` : "";
  };

  // 1. Confirmed housing rules are hard constraints: swap to a permitted equivalent, otherwise remove.
  for (const issue of calculateIssues(proposed).filter((candidate) => candidate.type === "rule")) {
    const item = proposed.items.find((candidate) => candidate.id === issue.affectedItemIds[0]);
    const rule = project.rules.find((candidate) => issue.id.startsWith(`rule-${candidate.id}-`));
    if (!item || !rule) continue;
    if (rule.verificationStatus !== "confirmed") {
      blockers.push(`${name(item)} may conflict with ${rule.label}, but the rule is unconfirmed. Confirm or dismiss it in Constraints before Better Cart changes that item.`);
      continue;
    }
    if (!editable(item)) {
      if (item.locked) blockers.push(`${name(item)} conflicts with ${rule.label} but is locked. Unlock it in the 3D Studio to let Better Cart replace or remove it.`);
      continue;
    }
    const swap = substitutes(project, proposed, item)[0];
    if (swap) {
      push(replaceChange(proposed, item, swap, `Replace ${name(item)} with ${swap.product.name}, which ${rule.label} permits.`));
      continue;
    }
    const after = applyChange(proposed, { id: "", type: "remove", itemId: item.id, reason: "", impact: "", confidence: "confirmed", accepted: null });
    const owned = item.purchaseStatus !== "in_cart";
    push({
      id: `change-remove-${item.id}`,
      type: "remove",
      itemId: item.id,
      reason: owned
        ? `Leave ${ownerName(proposed, item)}’s ${name(item)} out of the room: it conflicts with ${rule.label}.`
        : `Remove ${name(item)}: it conflicts with ${rule.label}, and no permitted alternative is in the catalog.`,
      impact: `${owned ? "No cost change" : `Saves ${cents(lineCost(productFor(proposed, item), item))}`}; ${needImpact(after, item)}.`,
      confidence: issue.confidence,
      accepted: null,
    });
  }

  // 2. Roommate duplicates: defer the pricier optional purchase; never change who buys the kept item.
  for (const issue of calculateIssues(proposed).filter((candidate) => candidate.type === "duplicate")) {
    const pair = issue.affectedItemIds.map((id) => proposed.items.find((item) => item.id === id)).filter((item): item is Item => Boolean(item));
    if (pair.length !== 2 || pair.some((item) => touched.has(item.id))) continue;
    const drop = pair
      .filter((item) => editable(item) && item.purchaseStatus === "in_cart" && item.essentiality === "optional" && keepsRequiredNeeds(item))
      .map((item) => ({ item, savings: lineCost(productFor(proposed, item), item) }))
      .sort(cutFirst)[0]?.item;
    if (!drop) {
      blockers.push(`${ownerName(proposed, pair[0])} and ${ownerName(proposed, pair[1])} both plan ${name(pair[0])} / ${name(pair[1])}. Both are essential or locked, so decide together in Issues whether both are needed.`);
      continue;
    }
    const keep = pair.find((item) => item.id !== drop.id)!;
    const shared = drop.needsServed.find((need) => keep.needsServed.includes(need)) ?? productFor(proposed, drop)?.category ?? "the same need";
    push({
      id: `change-defer-${drop.id}`,
      type: "defer",
      itemId: drop.id,
      reason: `Defer ${ownerName(proposed, drop)}’s ${name(drop)}: ${ownerName(proposed, keep)}’s ${name(keep)} already covers ${shared}.${evenSplitNote(drop)} If both are intentional, reject this change.`,
      impact: `Saves ${cents(lineCost(productFor(proposed, drop), drop))}; ${ownerName(proposed, keep)} keeps their purchase and no buyer is reassigned.`,
      confidence: issue.confidence,
      accepted: null,
    });
  }

  // 3. Physical fit (outside the room, over the ceiling, overlapping): move, or swap to an equivalent that fits.
  const lockedIssues = physicalIssues(proposed);
  for (const item of active(proposed).filter((candidate) => candidate.locked)) {
    const issue = worstFitIssue(lockedIssues, item.id);
    // An overlap with an unlocked item can still be solved by moving that item.
    const solvable = issue?.affectedItemIds.some((id) => id !== item.id && !proposed.items.find((other) => other.id === id)?.locked);
    if (issue && !solvable) blockers.push(`${name(item)} is locked in place, but ${fitProblem(proposed, issue, item.id)}. Unlock it in the 3D Studio or correct the room measurements.`);
  }
  const attempted = new Set<string>();
  for (;;) {
    const issues = physicalIssues(proposed);
    const candidates = active(proposed).filter((item) => editable(item) && !attempted.has(item.id) && worstFitIssue(issues, item.id));
    if (!candidates.length) break;
    // Out-of-room/ceiling problems first; for overlaps prefer moving purchases over owned items.
    candidates.sort((a, b) =>
      Number(!worstFitIssue(issues, a.id)!.id.startsWith("overlap-") ? 0 : 1) - Number(!worstFitIssue(issues, b.id)!.id.startsWith("overlap-") ? 0 : 1)
      || Number(a.purchaseStatus !== "in_cart") - Number(b.purchaseStatus !== "in_cart"));
    const item = candidates[0];
    attempted.add(item.id);
    const issue = worstFitIssue(issues, item.id)!;
    const reposition = issue.id.startsWith("ceiling-") ? null : findSafePlacement(project, proposed, item.id);
    const swaps = substitutes(project, proposed, item).filter((option) => option.placement);
    const gap = overBudget(proposed);
    // Over budget, and budget ranks above keeping picks: take the cheapest option that fits.
    // Otherwise keep the chosen product if it can move.
    const bestSwap = swaps[0];
    const cheaperFits = Boolean(bestSwap && gap > 0 && bestSwap.savings > 0);
    const preferSwap = bestSwap && (!reposition || (budgetSwaps && cheaperFits));
    if (preferSwap) {
      const why = gap > 0 && reposition ? ` It also cuts ${cents(bestSwap.savings)} while the cart is ${cents(gap)} over budget.` : "";
      push(replaceChange(proposed, item, bestSwap, `Swap ${name(item)} for ${bestSwap.product.name}: ${fitProblem(proposed, issue, item.id)}, and the replacement fits at a collision-tested spot.${why}`));
    } else if (reposition) {
      push({
        id: `change-move-${item.id}`,
        type: "reposition",
        itemId: item.id,
        position: reposition.position,
        rotationZ: reposition.rotationZ,
        reason: `Move ${name(item)} to the nearest collision-free spot${reposition.rotationZ !== (item.transform?.rotationZ ?? 0) ? ", rotated 90°" : ""}: ${fitProblem(proposed, issue, item.id)} where it is now.${cheaperFits ? ` The cheaper ${bestSwap.product.name} would also fit, but you rank keeping the products you chose above the budget.` : ""}`,
        impact: "No cost change; placement collision-tested.",
        confidence: "confirmed",
        accepted: null,
      });
    } else {
      const product = productFor(proposed, item);
      blockers.push(`${issue.message}. No collision-free spot or equivalent ${product?.category ?? "item"} in the catalog fits. Re-measure the room, move something else, or import a smaller ${product?.category ?? "option"}.`);
    }
  }

  // 4. Keep-clear areas (door swings, user-marked zones): move the item out, keeping cost and owner.
  for (const issue of physicalIssues(proposed).filter((candidate) => candidate.type === "clearance")) {
    const item = proposed.items.find((candidate) => candidate.id === issue.affectedItemIds[0]);
    if (!item) continue;
    if (!editable(item)) {
      if (item.locked) blockers.push(`${name(item)} blocks a keep-clear area but is locked. Unlock it in the 3D Studio to let Better Cart move it.`);
      continue;
    }
    const zone = proposed.room.clearanceZones.find((candidate) => candidate.id === issue.affectedGeometryIds[0]);
    const placement = findSafePlacement(project, proposed, item.id);
    if (!placement) {
      blockers.push(`${issue.message}, and no collision-free spot outside it was found. Free up floor space or reconsider the item.`);
      continue;
    }
    push({
      id: `change-move-${item.id}`,
      type: "reposition",
      itemId: item.id,
      position: placement.position,
      rotationZ: placement.rotationZ,
      reason: `Move ${name(item)} out of the ${zone?.name.toLowerCase() ?? "keep-clear area"}.`,
      impact: `No cost change; ${zone?.confirmed ? "restores confirmed clearance" : "clears an unverified keep-clear area"} without changing ownership.`,
      confidence: issue.confidence,
      accepted: null,
    });
  }

  // 5. Budget: cheaper equivalents first (needs preserved) unless keeping picks ranks higher, then
  // defer optional purchases that no required function depends on, in priority order.
  while (overBudget(proposed) > 0) {
    const gap = overBudget(proposed);
    const open = active(proposed).filter((item) => editable(item) && item.purchaseStatus === "in_cart");
    const cheaper = budgetSwaps ? open
      .flatMap((item) => substitutes(project, proposed, item).filter((option) => option.savings > 0 && (option.placement || !item.transform)).map((option) => ({ item, option, savings: option.savings })))
      .sort(cutFirst)[0] : undefined;
    if (cheaper) {
      push(replaceChange(proposed, cheaper.item, cheaper.option, `Swap ${name(cheaper.item)} for ${cheaper.option.product.name} to close the ${cents(gap)} budget gap.${evenSplitNote(cheaper.item)}`));
      continue;
    }
    const deferrable = open.filter((item) => item.essentiality === "optional" && lineCost(productFor(proposed, item), item) > 0);
    const optional = deferrable
      .filter(keepsRequiredNeeds)
      .map((item) => ({ item, savings: lineCost(productFor(proposed, item), item) }))
      .sort(cutFirst)[0]?.item;
    if (!optional) {
      const protectedNeeds = [...new Set(deferrable.flatMap((item) => requiredNeedsLost(proposed, deferred(item))))].map((need) => needInfo(need).label.toLowerCase());
      // Includes items already moved in this proposal: keeping picks, not the move, ruled out their swap.
      const swapsSkipped = !budgetSwaps && active(proposed).some((item) => !item.locked && item.purchaseStatus === "in_cart" && substitutes(project, proposed, item).some((option) => option.savings > 0));
      const why = [
        swapsSkipped ? `cheaper equivalents exist, but you rank “${priorityInfo("keep_picks").label}” above “${priorityInfo("budget").label}”` : "",
        protectedNeeds.length ? `the remaining optional items are the only ones covering ${protectedNeeds.join(" and ")}, a required function` : "",
      ].filter(Boolean);
      blockers.push(why.length
        ? `Still ${cents(gap)} over budget: ${why.join("; ")}. Reorder priorities or change required functions in Constraints, or raise the budget.`
        : `Still ${cents(gap)} over budget: the remaining items are essential, locked, or have no cheaper equivalent. Raise the budget, mark an item optional, or import a cheaper option.`);
      break;
    }
    const after = deferred(optional);
    push({
      id: `change-defer-${optional.id}`,
      type: "defer",
      itemId: optional.id,
      reason: `Defer the optional ${name(optional)} to close the ${cents(gap)} budget gap.${evenSplitNote(optional)}`,
      impact: `Saves ${cents(lineCost(productFor(proposed, optional), optional))}; ${needImpact(after, optional)}.`,
      confidence: "confirmed",
      accepted: null,
    });
  }
  if (!purchaseSubtotal(proposed).complete) {
    blockers.push("Some cart items have no price, so the proposed total is incomplete. Enter their prices to confirm it is within budget.");
  }

  const afterIssues = calculateIssues(proposed);
  const beforeIds = new Set(beforeIssues.map((issue) => issue.id));
  const afterIds = new Set(afterIssues.map((issue) => issue.id));

  return {
    id: `proposal-${Date.now()}`,
    basedOnGeometryVersion: project.room.geometryVersion,
    basedOnCartVersion: project.cartVersion,
    beforeSubtotal: purchaseSubtotal(project).amount,
    afterSubtotal: purchaseSubtotal(proposed).amount,
    changes,
    resolvedIssueIds: [...beforeIds].filter((id) => !afterIds.has(id)),
    remainingIssueIds: [...afterIds],
    blockers,
    createdAt: new Date().toISOString(),
    stale: false,
  };
}

export function applyAcceptedProposal(project: Project) {
  if (!project.proposal) return project;
  let next = project;
  for (const change of project.proposal.changes.filter((candidate) => candidate.accepted === true)) {
    next = applyChange(next, change);
  }
  return { ...next, proposal: null };
}
