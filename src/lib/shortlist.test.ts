import { describe, expect, it } from "vitest";
import { furnitureModelKind } from "./furniture";
import { mergeShortlistProducts, shortlistProducts } from "./shortlist";

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
});
