import { describe, expect, it } from "vitest";
import { checkoutGroups, retailerForProduct, safeCheckoutURL } from "./checkout";
import { createDemoProject } from "./demo";

describe("retailer checkout", () => {
  it("classifies Amazon and IKEA from verified hostnames", () => {
    // Clear the explicit retailer so classification falls back to the product link and store name.
    const base = { ...createDemoProject().products[0], retailer: undefined };
    expect(retailerForProduct({ ...base, sourceURL: "https://www.amazon.com/dp/example" })).toBe("amazon");
    expect(retailerForProduct({ ...base, sourceURL: "https://www.ikea.com/us/en/p/example" })).toBe("ikea");
    expect(retailerForProduct({ ...base, sourceURL: "https://amazon.example.test/item", store: "Independent" })).toBe("other");
  });

  it("groups selected items without combining retailer orders", () => {
    // The demo cart mixes IKEA products with an Amazon mini fridge.
    const groups = checkoutGroups(createDemoProject());
    expect(groups.find((group) => group.id === "amazon")?.items.map(({ item }) => item.id)).toEqual(["item-fridge"]);
    expect(groups.find((group) => group.id === "ikea")?.items).toHaveLength(4);
    expect(groups.reduce((total, group) => total + group.subtotal, 0)).toBe(58995);
  });

  it("allows only HTTPS checkout destinations", () => {
    const product = createDemoProject().products[0];
    expect(safeCheckoutURL({ ...product, sourceURL: "http://amazon.com/item" })).toBeNull();
    expect(safeCheckoutURL({ ...product, sourceURL: "https://amazon.com/item" })).toContain("https://amazon.com/item");
    expect(safeCheckoutURL({ ...product, sourceURL: "https://www.ikea.com/us/en/p/markus-office-chair-vissle-dark-gray-90289172/" })).toContain("ikea.com/us/en/p/markus");
  });
});
