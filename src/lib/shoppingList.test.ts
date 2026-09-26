import { describe, expect, it } from "vitest";
import { createDemoProject } from "./demo";
import { shoppingListCsv, shoppingListFilename, shoppingListRows } from "./shoppingList";

const ON_OBSERVATION = new Date("2026-08-20T12:00:00Z");
const MUCH_LATER = new Date("2026-09-26T15:00:00Z"); // 42 days after the fixture's 2026-08-15T14:30Z observation

describe("shopping list export", () => {
  it("lists only items selected for purchase and never charges owned items", () => {
    const rows = shoppingListRows(createDemoProject(), ON_OBSERVATION);
    const names = rows.slice(1, -2).map((row) => row[0]);
    expect(names).toEqual(["Northline Study Desk", "Loop Task Chair", "QuickHeat 0.7 cu ft Microwave", "DormWave Compact Microwave", "CozyCoil Mini Heater"]);
    expect(names).not.toContain("Maya’s Cube Shelf");
    const summary = rows.at(-1)!;
    expect(summary[0]).toBe("Known subtotal");
    expect(summary[5]).toBe("595.00");
    expect(summary[7]).toBe("complete");
  });

  it("labels fit and price uncertainty from the same checks as the app", () => {
    const rows = shoppingListRows(createDemoProject(), ON_OBSERVATION);
    const byName = new Map(rows.map((row) => [row[0], row]));
    expect(byName.get("Northline Study Desk")![11]).toBe("conflict");
    expect(byName.get("QuickHeat 0.7 cu ft Microwave")![11]).toBe("unverified");
    expect(byName.get("Loop Task Chair")![7]).toBe("confirmed");
    const later = new Map(shoppingListRows(createDemoProject(), MUCH_LATER).map((row) => [row[0], row]));
    expect(later.get("Loop Task Chair")![7]).toBe("stale (observed 42 days ago)");
  });

  it("marks the subtotal incomplete when a selected item has no price", () => {
    const project = createDemoProject();
    project.products = project.products.map((product) => product.id === "prod-chair" ? { ...product, price: null } : product);
    const rows = shoppingListRows(project, ON_OBSERVATION);
    expect(rows.find((row) => row[0] === "Loop Task Chair")![3]).toBe("unknown");
    expect(rows.at(-1)![7]).toBe("incomplete: 1 item without a price");
  });

  it("escapes quotes and neutralizes spreadsheet formulas", () => {
    const project = createDemoProject();
    project.products = project.products.map((product) => product.id === "prod-chair" ? { ...product, name: '=HYPERLINK("x")' } : product);
    const csv = shoppingListCsv(project, ON_OBSERVATION);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.split("\r\n")[0].startsWith('"Product","Store"')).toBe(true);
  });

  it("builds a safe file name", () => {
    expect(shoppingListFilename(createDemoProject())).toBe("maple-hall-214-shopping-list.csv");
    expect(shoppingListFilename({ ...createDemoProject(), name: "!!!" })).toBe("roominate-shopping-list.csv");
  });
});
