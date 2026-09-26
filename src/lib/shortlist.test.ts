import { describe, expect, it } from "vitest";
import { furnitureModelKind } from "./furniture";
import { mergeShortlistProducts, shortlistByCategory, shortlistCategories, shortlistProducts } from "./shortlist";

describe("furnishing shortlist", () => {
  it("includes every supplied row with placeable dimensions and a supported model", () => {
    expect(shortlistProducts).toHaveLength(59);
    expect(new Set(shortlistProducts.map((product) => product.id)).size).toBe(59);

    for (const product of shortlistProducts) {
      expect(product.dimensions.width).toBeGreaterThan(0);
      expect(product.dimensions.depth).toBeGreaterThan(0);
      expect(product.dimensions.height).toBeGreaterThan(0);
      expect(product.sourceURL).toMatch(/^https:\/\//);
      expect(furnitureModelKind(product.category, product.name)).not.toBe("box");
    }
  });

  it("adds missing shortlist products without duplicating existing entries", () => {
    const first = shortlistProducts[0];
    const merged = mergeShortlistProducts([first]);
    expect(merged).toHaveLength(59);
    expect(merged.filter((product) => product.id === first.id)).toHaveLength(1);
  });

  it("gives every shortlist product a retailer photo", () => {
    for (const product of shortlistProducts) {
      expect(product.imageURL, product.id).toMatch(product.retailer === "amazon" ? /^https:\/\/m\.media-amazon\.com\/images\// : /^https:\/\/www\.ikea\.com\/us\/en\/images\/products\//);
    }
    expect(new Set(shortlistProducts.map((product) => product.imageURL)).size).toBe(59);
  });

  it("adds photos to shortlist products saved before they had one, leaving other products alone", () => {
    const { imageURL, ...saved } = shortlistProducts[0];
    const custom = { ...shortlistProducts[1], id: "product-custom", imageURL: undefined };
    const merged = mergeShortlistProducts([saved, custom]);
    expect(merged.find((product) => product.id === saved.id)?.imageURL).toBe(imageURL);
    expect(merged.find((product) => product.id === "product-custom")?.imageURL).toBeUndefined();
  });

  it("filters by item type across both stores", () => {
    expect(shortlistCategories.map(({ category, count }) => `${category}:${count}`)).toEqual([
      "chair:6", "couch:5", "desk:5", "wardrobe:5", "laundry hamper:5", "bean bag:6",
      "ottoman:5", "dresser:5", "lamp:6", "mirror:5", "mini fridge:6",
    ]);
    expect(shortlistByCategory("all")).toHaveLength(59);
    expect(shortlistByCategory("desk").map((product) => product.name)).toContain("TORALD");
    expect(new Set(shortlistByCategory("bean bag").map((product) => product.store))).toEqual(new Set(["Amazon"]));
    expect(shortlistByCategory("mirror").every((product) => product.category === "mirror")).toBe(true);
  });
});
