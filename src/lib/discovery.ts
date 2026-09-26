import { calculateIssues, rotatedFootprint } from "./calculations";
import type { Item, Product, Project, Vec2 } from "./types";

export type CandidateFit =
  | { status: "fits"; position: Vec2; rotationZ: number }
  | { status: "does_not_fit" }
  | { status: "unverified" };

export function initialProductPlacement(project: Project, product: Product): NonNullable<Item["transform"]> {
  const fit = evaluateCandidateFit(project, product);
  if (fit.status === "fits") return { position: fit.position, rotationZ: fit.rotationZ };
  // Keep a dimensioned product visible and editable even when no collision-free
  // location exists. The normal issue engine will mark the centered preview red.
  return { position: { x: project.room.width / 2, y: project.room.length / 2 }, rotationZ: 0 };
}

export function evaluateCandidateFit(project: Project, product: Product): CandidateFit {
  if (Object.values(product.dimensions).some((value) => value == null || value <= 0)) return { status: "unverified" };
  const item: Item = {
    id: "candidate-fit-check",
    productId: product.id,
    ownerId: project.ownerId,
    acquisitionStatus: "buying",
    purchaseStatus: "not_purchasing",
    quantity: 1,
    essentiality: "optional",
    needsServed: product.tags.slice(0, 1),
    transform: null,
    placementType: "floor",
  };
  const withCandidate: Project = { ...project, products: [...project.products.filter((candidate) => candidate.id !== product.id), product], items: [...project.items, item] };
  const step = 0.2;
  for (const rotationZ of [0, Math.PI / 2]) {
    const footprint = rotatedFootprint(product.dimensions, rotationZ);
    if (!footprint) return { status: "unverified" };
    const minX = footprint.width / 2 + 0.04;
    const maxX = project.room.width - footprint.width / 2 - 0.04;
    const minY = footprint.depth / 2 + 0.04;
    const maxY = project.room.length - footprint.depth / 2 - 0.04;
    for (let y = minY; y <= maxY + 0.001; y += step) {
      for (let x = minX; x <= maxX + 0.001; x += step) {
        const position = { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
        const candidate: Project = { ...withCandidate, items: withCandidate.items.map((candidateItem) => candidateItem.id === item.id ? { ...candidateItem, transform: { position, rotationZ } } : candidateItem) };
        const conflict = calculateIssues(candidate).some((issue) => (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(item.id));
        if (!conflict) return { status: "fits", position, rotationZ };
      }
    }
  }
  return { status: "does_not_fit" };
}
