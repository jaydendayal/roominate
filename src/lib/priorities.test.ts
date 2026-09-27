import { describe, expect, it } from "vitest";
import { createBlankProject } from "./demo";
import { DEFAULT_PRIORITIES, priorityOrder, ranksAbove } from "./priorities";

describe("priority order", () => {
  const withPriorities = (priorities: string[]) => ({ ...createBlankProject(), priorities });

  it("starts new rooms with budget first", () => {
    expect(priorityOrder(createBlankProject())).toEqual(DEFAULT_PRIORITIES);
    expect(DEFAULT_PRIORITIES[0]).toBe("budget");
  });

  it("keeps the saved order and fills in any missing priorities", () => {
    const order = priorityOrder(withPriorities(["even_split"]));
    expect(order).toEqual(["even_split", "budget", "keep_picks"]);
    expect(ranksAbove(order, "even_split", "budget")).toBe(true);
    expect(ranksAbove(order, "keep_picks", "budget")).toBe(false);
  });

  it("reads free-text priorities saved before the presets", () => {
    expect(priorityOrder(withPriorities(["Keep a clear entry", "Stay under budget", "Preserve workspace"]))).toEqual(DEFAULT_PRIORITIES);
    expect(priorityOrder(withPriorities(["budget", "budget", "Stay under budget"]))).toEqual(DEFAULT_PRIORITIES);
  });
});
