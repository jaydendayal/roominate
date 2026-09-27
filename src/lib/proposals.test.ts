import { describe, expect, it } from "vitest";
import { calculateIssues, purchaseSubtotal } from "./calculations";
import { createBlankProject, createDemoProject } from "./demo";
import { applyAcceptedProposal, generateProposal } from "./proposals";
import type { HousingRule, Item, Product, Project, Proposal } from "./types";

// A user-created project: no fixture IDs, custom categories, rules, and zones.

function product(id: string, category: string, [width, depth, height]: [number, number, number], price: number, tags: string[] = []): Product {
  return {
    id,
    name: `Test ${id}`,
    store: "Test store",
    sourceURL: null,
    category,
    variant: "",
    dimensions: { width, depth, height },
    price: { amount: price, currency: "USD", observedAt: "2026-09-26T00:00:00.000Z", confirmed: true },
    fieldEvidence: {},
    tags,
  };
}

function item(id: string, productId: string, at: [number, number] | null, extra: Partial<Item> = {}): Item {
  return {
    id,
    productId,
    ownerId: "person-jay",
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "optional",
    needsServed: [],
    transform: at ? { position: { x: at[0], y: at[1] }, rotationZ: 0 } : null,
    placementType: "floor",
    ...extra,
  };
}

function rule(extra: Partial<HousingRule>): HousingRule {
  return { id: "rule-test", label: "Test hall policy", text: "Not allowed.", sourceURL: null, sourceType: "user_note", verificationStatus: "confirmed", prohibitedCategories: [], prohibitedTags: [], dismissed: false, ...extra };
}

function project(products: Product[], items: Item[], extra: Partial<Project> = {}): Project {
  const blank = createBlankProject("My room");
  return { ...blank, room: { ...blank.room, width: 3, length: 3.4, height: 2.4 }, products, items, budgetAmount: 100000, ...extra };
}

function acceptAll(source: Project, proposal: Proposal) {
  return applyAcceptedProposal({ ...source, proposal: { ...proposal, changes: proposal.changes.map((change) => ({ ...change, accepted: true })) } });
}

const physicalFor = (source: Project, itemId: string) =>
  calculateIssues(source).filter((issue) => (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(itemId));

describe("Better Cart on user-created projects", () => {
  it("moves an item that crosses a wall and keeps the chosen product when the cart is under budget", () => {
    const plan = project([product("bed", "bed", [1, 2, 0.5], 20000), product("bed-small", "bed", [0.9, 1.9, 0.5], 15000)], [item("i-bed", "bed", [2.8, 1.5], { essentiality: "essential" })]);
    const proposal = generateProposal(plan);
    expect(proposal.changes.map((change) => [change.type, change.itemId])).toEqual([["reposition", "i-bed"]]);
    const next = acceptAll(plan, proposal);
    expect(next.items[0].productId).toBe("bed");
    expect(physicalFor(next, "i-bed")).toEqual([]);
  });

  it("swaps a too-tall item for a shorter equivalent, since moving cannot fix a ceiling conflict", () => {
    const plan = project([product("case-tall", "storage", [0.8, 0.3, 2.6], 9000), product("case-short", "storage", [0.8, 0.3, 1.8], 7000)], [item("i-case", "case-tall", [1.5, 1.7])]);
    const [change] = generateProposal(plan).changes;
    expect(change).toMatchObject({ type: "replace", itemId: "i-case", replacementProductId: "case-short" });
    expect(change.reason).toContain("taller than the ceiling");
  });

  it("replaces a product that breaks a confirmed rule with a permitted equivalent, or removes it", () => {
    const products = [product("lamp", "lighting", [0.3, 0.3, 1.5], 3000, ["halogen"]), product("lamp-led", "lighting", [0.3, 0.3, 1.5], 3500)];
    const plan = project(products, [item("i-lamp", "lamp", [1.5, 1.7], { needsServed: ["light"] })], { rules: [rule({ label: "Oak Hall lamp policy", prohibitedTags: ["halogen"] })] });
    const [swap] = generateProposal(plan).changes;
    expect(swap).toMatchObject({ type: "replace", replacementProductId: "lamp-led" });
    expect(swap.reason).toContain("Oak Hall lamp policy");

    const [removal] = generateProposal({ ...plan, products: [products[0]] }).changes;
    expect(removal.type).toBe("remove");
    expect(removal.impact).toContain("light would no longer be covered");
  });

  it("does not act on unconfirmed rules and says what to decide instead", () => {
    const plan = project([product("lamp", "lighting", [0.3, 0.3, 1.5], 3000, ["halogen"])], [item("i-lamp", "lamp", [1.5, 1.7])], { rules: [rule({ verificationStatus: "needs_review", prohibitedTags: ["halogen"] })] });
    const proposal = generateProposal(plan);
    expect(proposal.changes).toEqual([]);
    expect(proposal.blockers?.[0]).toContain("unconfirmed");
  });

  it("names the user's own keep-clear zone and clears it", () => {
    const zone = { id: "zone-closet", name: "Closet door", position: { x: 2.5, y: 3 }, width: 1, depth: 0.8, source: "user_confirmed" as const, confirmed: true };
    const plan = project([product("chair", "chair", [0.6, 0.6, 0.9], 5000)], [item("i-chair", "chair", [2.5, 3])], { room: { ...project([], []).room, clearanceZones: [zone] } });
    const proposal = generateProposal(plan);
    expect(proposal.changes[0].reason).toContain("closet door");
    expect(physicalFor(acceptAll(plan, proposal), "i-chair")).toEqual([]);
  });

  it("closes a budget gap with cheaper equivalents, then optional deferrals, never essential items", () => {
    const products = [product("desk", "desk", [1.2, 0.6, 0.75], 30000), product("desk-cheap", "desk", [1.1, 0.55, 0.75], 18000), product("rug", "rug", [1.5, 1, 0.01], 12000), product("bed", "bed", [1, 2, 0.5], 40000)];
    const items = [item("i-desk", "desk", [1.5, 0.4], { essentiality: "essential" }), item("i-rug", "rug", [1.5, 2]), item("i-bed", "bed", null, { essentiality: "essential" })];
    const plan = project(products, items, { budgetAmount: 60000 });
    const proposal = generateProposal(plan);
    expect(proposal.changes.map((change) => [change.type, change.itemId])).toEqual([["replace", "i-desk"], ["defer", "i-rug"]]);
    expect(purchaseSubtotal(acceptAll(plan, proposal)).amount).toBeLessThanOrEqual(60000);

    const tight = generateProposal({ ...plan, budgetAmount: 30000 });
    expect(tight.changes.some((change) => change.itemId === "i-bed")).toBe(false);
    expect(tight.blockers?.some((blocker) => blocker.includes("over budget"))).toBe(true);
  });

  it("never changes locked items and explains the blocker", () => {
    const plan = project([product("dresser", "storage", [1, 0.5, 0.8], 0)], [item("i-dresser", "dresser", [2.8, 1], { locked: true, purchaseStatus: "not_purchasing", acquisitionStatus: "owned" })]);
    const proposal = generateProposal(plan);
    expect(proposal.changes).toEqual([]);
    expect(proposal.blockers?.length).toBeGreaterThan(0);
  });

  it("asks the group instead of deferring when both duplicate purchases are essential", () => {
    const plan = project([product("desk", "desk", [1, 0.5, 0.75], 10000)], [
      item("i-desk-jay", "desk", [0.6, 0.4], { essentiality: "essential", needsServed: ["workspace"] }),
      item("i-desk-maya", "desk", [2.4, 3], { essentiality: "essential", needsServed: ["workspace"], ownerId: "person-maya" }),
    ]);
    const proposal = generateProposal(plan);
    expect(proposal.changes).toEqual([]);
    expect(proposal.blockers?.[0]).toContain("decide together");
  });
});

describe("Better Cart follows the group's priorities and required functions", () => {
  const keepPicksFirst = ["keep_picks", "budget", "even_split"];

  it("swaps a misfit for a cheaper model when budget ranks first, and moves the chosen one when keeping picks ranks first", () => {
    const plan = project([product("bed", "bed", [1, 2, 0.5], 20000), product("bed-small", "bed", [0.9, 1.9, 0.5], 15000)], [item("i-bed", "bed", [2.8, 1.5], { essentiality: "essential" })], { budgetAmount: 16000 });
    expect(generateProposal(plan).changes.map((change) => [change.type, change.replacementProductId])).toEqual([["replace", "bed-small"]]);

    const keep = generateProposal({ ...plan, priorities: keepPicksFirst });
    expect(keep.changes.map((change) => change.type)).toEqual(["reposition"]);
    expect(keep.changes[0].reason).toContain("you rank keeping the products you chose above the budget");
    expect(keep.blockers?.find((blocker) => blocker.includes("over budget"))).toContain("cheaper equivalents exist");
  });

  it("defers optional items instead of swapping chosen products when keeping picks ranks first", () => {
    const products = [product("desk", "desk", [1.2, 0.6, 0.75], 30000), product("desk-cheap", "desk", [1.1, 0.55, 0.75], 18000), product("rug", "rug", [1.5, 1, 0.01], 12000)];
    const plan = project(products, [item("i-desk", "desk", [1.5, 0.4], { essentiality: "essential" }), item("i-rug", "rug", [1.5, 2])], { budgetAmount: 35000, priorities: keepPicksFirst });
    const proposal = generateProposal(plan);
    expect(proposal.changes.map((change) => [change.type, change.itemId])).toEqual([["defer", "i-rug"]]);
    expect(proposal.changes.some((change) => change.type === "replace")).toBe(false);
  });

  it("cuts from whoever is spending more when an even split ranks above the biggest saving", () => {
    const products = [product("desk", "desk", [1.2, 0.6, 0.75], 30000), product("lamp", "lighting", [0.3, 0.3, 1.5], 5000), product("rug", "rug", [1.5, 1, 0.01], 12000)];
    const items = [item("i-desk", "desk", [1.5, 0.4], { essentiality: "essential" }), item("i-lamp", "lamp", [0.3, 3]), item("i-rug", "rug", [1.5, 2], { ownerId: "person-maya" })];
    const plan = project(products, items, { budgetAmount: 44000 });
    // Budget first: the biggest saving is Maya's rug, even though Jay is spending far more.
    expect(generateProposal(plan).changes.map((change) => change.itemId)).toEqual(["i-rug"]);
    const even = generateProposal({ ...plan, priorities: ["even_split", "budget", "keep_picks"] });
    expect(even.changes.map((change) => change.itemId)).toEqual(["i-lamp"]);
    expect(even.changes[0].reason).toContain("Jay is spending the most");
  });

  it("never defers the last item covering a required function", () => {
    const products = [product("desk", "desk", [1.2, 0.6, 0.75], 30000), product("lamp", "lighting", [0.3, 0.3, 1.5], 5000)];
    const plan = project(products, [item("i-desk", "desk", [1.5, 0.4], { essentiality: "essential" }), item("i-lamp", "lamp", [0.3, 3])], { budgetAmount: 32000 });
    expect(generateProposal(plan).changes.map((change) => [change.type, change.itemId])).toEqual([["defer", "i-lamp"]]);

    const lit = generateProposal({ ...plan, needs: ["room-lighting"] });
    expect(lit.changes).toEqual([]);
    expect(lit.blockers?.find((blocker) => blocker.includes("over budget"))).toContain("the only ones covering lighting");
  });
});

describe("Better Cart change independence", () => {
  it("keeps every placement valid even when the user accepts only that one change", () => {
    const demo = createDemoProject();
    const proposal = generateProposal(demo);
    for (const change of proposal.changes.filter((candidate) => candidate.position)) {
      const next = applyAcceptedProposal({ ...demo, proposal: { ...proposal, changes: proposal.changes.map((candidate) => ({ ...candidate, accepted: candidate.id === change.id })) } });
      expect(physicalFor(next, change.itemId), change.id).toEqual([]);
    }
  });
});
