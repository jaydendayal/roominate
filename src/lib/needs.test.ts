import { describe, expect, it } from "vitest";
import { calculateIssues } from "./calculations";
import { createBlankProject, createDemoProject } from "./demo";
import { needFor, requiredNeeds, uncoveredRequiredNeeds } from "./needs";
import type { Item, Project } from "./types";

const desk = (extra: Partial<Item> = {}): Item => ({
  id: "i-desk", productId: "shortlist-lagkapten-alex", ownerId: "person-jay", acquisitionStatus: "buying", purchaseStatus: "in_cart",
  quantity: 1, essentiality: "optional", needsServed: [], transform: null, placementType: "floor", ...extra,
});

describe("required functions", () => {
  it("maps need words and store categories onto the same needs", () => {
    expect(needFor("Seating")).toBe("seating");
    expect(needFor("bean bag")).toBe("seating");
    expect(needFor("mini fridge")).toBe("cold-storage");
    expect(needFor("light")).toBe("room-lighting");
    expect(needFor("two study seats")).toBeNull();
  });

  it("reads saved needs, ignoring words that name no known need", () => {
    const project: Project = { ...createBlankProject(), needs: ["desk", "workspace", "two study seats", "sleeping"] };
    expect(requiredNeeds(project)).toEqual(["workspace", "sleeping"]);
  });

  it("counts an item's category, but not deferred items", () => {
    const blank: Project = { ...createBlankProject(), needs: ["workspace"] };
    expect(uncoveredRequiredNeeds(blank)).toEqual(["workspace"]);
    expect(uncoveredRequiredNeeds({ ...blank, items: [desk()] })).toEqual([]); // a store desk records only its category
    expect(uncoveredRequiredNeeds({ ...blank, items: [desk({ purchaseStatus: "deferred" })] })).toEqual(["workspace"]);
  });

  it("flags a required function nothing covers as an unmet need", () => {
    const blank: Project = { ...createBlankProject(), needs: ["workspace", "sleeping"] };
    const issues = calculateIssues(blank).filter((issue) => issue.type === "unmet_need");
    expect(issues.map((issue) => issue.id)).toEqual(["need-workspace"]); // the room's own bed covers sleeping
    expect(issues[0].message).toBe("Nothing in the plan covers workspace");
    expect(calculateIssues(createDemoProject()).some((issue) => issue.type === "unmet_need")).toBe(false);
  });
});
