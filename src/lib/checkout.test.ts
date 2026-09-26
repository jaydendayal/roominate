import { describe, expect, it } from "vitest";
import { checkoutGroups, retailerForProduct, safeCheckoutURL } from "./checkout";
import { createDemoProject } from "./demo";

describe("retailer checkout", () => {
  it("classifies Amazon and IKEA from verified hostnames", () => {
    const base = createDemoProject().products[0];
    expect(retailerForProduct({ ...base, sourceURL: "https://www.amazon.com/dp/example" })).toBe("amazon");
    expect(retailerForProduct({ ...base, sourceURL: "https://www.ikea.com/us/en/p/example" })).toBe("ikea");
    expect(retailerForProduct({ ...base, sourceURL: "https://amazon.example.test/item", store: "Independent" })).toBe("other");
  });

  it("groups selected items without combining retailer orders", () => {
    const project = createDemoProject();
    project.products[0] = { ...project.products[0], retailer: "amazon" };
    project.products[2] = { ...project.products[2], retailer: "ikea" };
    const groups = checkoutGroups(project);
    expect(groups.some((group) => group.id === "amazon")).toBe(true);
    expect(groups.some((group) => group.id === "ikea")).toBe(true);
    expect(groups.reduce((total, group) => total + group.subtotal, 0)).toBe(59500);
  });

  it("allows only HTTPS checkout destinations", () => {
    const product = createDemoProject().products[0];
    expect(safeCheckoutURL({ ...product, sourceURL: "http://amazon.com/item" })).toBeNull();
    expect(safeCheckoutURL({ ...product, sourceURL: "https://amazon.com/item" })).toContain("https://amazon.com/item");
  });
});
