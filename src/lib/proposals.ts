import { calculateIssues, productFor, purchaseSubtotal, rotatedFootprint } from "./calculations";
import type { Item, Project, Proposal, ProposalChange } from "./types";

function applyChange(project: Project, change: ProposalChange): Project {
  return {
    ...project,
    items: project.items.map((item): Item => {
      if (item.id !== change.itemId) return item;
      if (change.type === "replace" && change.replacementProductId) {
        return { ...item, productId: change.replacementProductId, transform: change.position ? { position: change.position, rotationY: change.rotationY ?? 0 } : item.transform };
      }
      if (change.type === "remove" || change.type === "defer") {
        return { ...item, purchaseStatus: "deferred", transform: null };
      }
      if (change.type === "reposition" && change.position) {
        return { ...item, transform: { position: change.position, rotationY: change.rotationY ?? item.transform?.rotationY ?? 0 } };
      }
      return item;
    }),
    cartVersion: project.cartVersion + 1,
  };
}

function findSafePlacement(project: Project, itemId: string, productId?: string) {
  const source = project.items.find((item) => item.id === itemId);
  const product = project.products.find((candidate) => candidate.id === (productId ?? source?.productId));
  if (!source || !product) return null;
  const margin = 0.04;
  const step = 0.18;
  for (const rotationY of [0, Math.PI / 2]) {
    const footprint = rotatedFootprint(product.dimensions, rotationY);
    if (!footprint) continue;
    const minX = footprint.width / 2 + margin;
    const maxX = project.room.width - footprint.width / 2 - margin;
    const minZ = footprint.depth / 2 + margin;
    const maxZ = project.room.length - footprint.depth / 2 - margin;
    for (let z = minZ; z <= maxZ + 0.001; z += step) {
      for (let x = minX; x <= maxX + 0.001; x += step) {
        const position = { x: Number(x.toFixed(3)), z: Number(z.toFixed(3)) };
        const candidate: Project = {
          ...project,
          items: project.items.map((item) => item.id === itemId ? { ...item, productId: product.id, transform: { position, rotationY } } : item),
        };
        const conflicts = calculateIssues(candidate).some((issue) =>
          (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(itemId),
        );
        if (!conflicts) return { position, rotationY };
      }
    }
  }
  return null;
}

export function generateProposal(project: Project): Proposal {
  const beforeIssues = calculateIssues(project);
  const changes: ProposalChange[] = [];
  let proposed = project;
  const desk = project.items.find((item) => productFor(project, item)?.alternativeGroupId === "desk-compact" && productFor(project, item)?.id !== "prod-desk-compact");
  const compact = project.products.find((product) => product.id === "prod-desk-compact") ?? project.products.find((product) => product.alternativeGroupId && product.alternativeGroupId === productFor(project, desk!)?.alternativeGroupId && product.id !== desk?.productId);
  if (desk && compact && beforeIssues.some((issue) => issue.affectedItemIds.includes(desk.id) && issue.type === "fit")) {
    const placement = findSafePlacement(proposed, desk.id, compact.id);
    const change: ProposalChange = {
      id: "change-compact-desk",
      type: "replace",
      itemId: desk.id,
      replacementProductId: compact.id,
      position: placement?.position,
      rotationY: placement?.rotationY,
      reason: placement ? `Swap to ${compact.name} at a collision-tested placement.` : `Swap to ${compact.name}; placement still needs review.`,
      impact: `Saves ${compact.price && productFor(project, desk)?.price ? `$${((productFor(project, desk)!.price!.amount - compact.price.amount) / 100).toFixed(0)}` : "space"}; preserves the workspace need.`,
      confidence: placement ? "confirmed" : "uncertain",
      accepted: null,
    };
    changes.push(change);
    proposed = applyChange(proposed, change);
  }

  const duplicate = calculateIssues(proposed).find((issue) => issue.type === "duplicate");
  if (duplicate) {
    const candidates = duplicate.affectedItemIds.map((id) => project.items.find((item) => item.id === id)).filter(Boolean) as Item[];
    const remove = candidates.sort((a, b) => (productFor(project, b)?.price?.amount ?? 0) - (productFor(project, a)?.price?.amount ?? 0))[0];
    if (remove && !remove.locked) {
      const change: ProposalChange = {
        id: "change-remove-duplicate",
        type: "defer",
        itemId: remove.id,
        reason: `Defer ${productFor(project, remove)?.name}; the roommate cart already covers the same shared need.`,
        impact: `Removes ${productFor(project, remove)?.price ? `$${(productFor(project, remove)!.price!.amount / 100).toFixed(0)}` : "one item"} without silently changing the buyer of the remaining item.`,
        confidence: duplicate.confidence,
        accepted: null,
      };
      changes.push(change);
      proposed = applyChange(proposed, change);
    }
  }

  for (const issue of calculateIssues(proposed).filter((candidate) => candidate.type === "rule")) {
    const item = proposed.items.find((candidate) => candidate.id === issue.affectedItemIds[0]);
    if (item && !item.locked && !changes.some((change) => change.itemId === item.id)) {
      const change: ProposalChange = {
        id: `change-remove-rule-${item.id}`,
        type: "remove",
        itemId: item.id,
        reason: `Remove ${productFor(project, item)?.name} because it conflicts with a confirmed housing rule.`,
        impact: "Resolves the rule conflict; warmth remains an unmet optional preference.",
        confidence: issue.confidence,
        accepted: null,
      };
      changes.push(change);
      proposed = applyChange(proposed, change);
    }
  }

  for (const issue of calculateIssues(proposed).filter((candidate) => candidate.type === "clearance")) {
    const item = proposed.items.find((candidate) => candidate.id === issue.affectedItemIds[0]);
    if (item && !item.locked && !changes.some((change) => change.itemId === item.id)) {
      const placement = findSafePlacement(proposed, item.id);
      if (!placement) continue;
      const change: ProposalChange = {
        id: `change-move-${item.id}`,
        type: "reposition",
        itemId: item.id,
        position: placement.position,
        rotationY: placement.rotationY,
        reason: `Move ${productFor(project, item)?.name} away from the entry swing.`,
        impact: "Restores confirmed door clearance without changing ownership or cost.",
        confidence: "confirmed",
        accepted: null,
      };
      changes.push(change);
      proposed = applyChange(proposed, change);
    }
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
