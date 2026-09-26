import { describe, expect, it } from "vitest";
import { furnitureModelKind } from "./furniture";

describe("furnitureModelKind", () => {
  it.each([
    ["seating", "Desk chair", "chair"],
    ["sofa", "Loveseat", "couch"],
    ["furniture", "Writing desk", "desk"],
    ["storage", "Tall wardrobe", "wardrobe"],
    ["laundry", "Woven hamper", "hamper"],
    ["seating", "Bean bag", "beanbag"],
    ["seating", "Storage ottoman", "ottoman"],
    ["storage", "Six-drawer dresser", "dresser"],
    ["lighting", "Floor light", "lamp"],
    ["decor", "Standing mirror", "mirror"],
    ["appliance", "Compact refrigerator", "mini_fridge"],
  ])("maps %s / %s to %s", (category, name, expected) => {
    expect(furnitureModelKind(category, name)).toBe(expected);
  });

  it("keeps an unknown product on the collision-box fallback", () => {
    expect(furnitureModelKind("appliance", "Microwave")).toBe("box");
  });
});
