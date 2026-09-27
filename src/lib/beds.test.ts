import { describe, expect, it } from "vitest";
import { addRoomBed, BED_SIZES, bedProduct, bedProductId, ensureProvidedBed, isRoomBedItem, removeRoomBed, ROOM_BED_ITEM_ID, roomBeds, setRoomBedSize } from "./beds";
import { calculateIssues, purchaseSubtotal } from "./calculations";
import { createBlankProject, createDemoProject } from "./demo";
import { colorGroupsFor, describeColor } from "./productColors";
import { visualProfileFor } from "./productModels";
import { shoppingListCsv } from "./shoppingList";
import type { Project } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;
const bedOf = (project: Project) => project.items.find(isRoomBedItem);

describe("room bed sizes", () => {
  it("uses standard mattress sizes plus a frame", () => {
    const twinXl = bedProduct("twin_xl");
    expect(twinXl.dimensions.width).toBeCloseTo(40 * 0.0254, 3);
    expect(twinXl.dimensions.depth).toBeCloseTo(84 * 0.0254, 3);
    expect(bedProduct("queen").dimensions.width).toBeCloseTo(62 * 0.0254, 3);
    expect(bedProduct("california_king").dimensions.depth).toBeCloseTo(88 * 0.0254, 3);
    expect(twinXl.price).toBeNull();
    expect(twinXl.tags).toContain("room-provided");
  });

  it("gives every size its own 3D model in a wood color by default", () => {
    const signatures = new Set<string>();
    for (const { id } of BED_SIZES) {
      const profile = visualProfileFor(bedProduct(id))!;
      expect(profile.parts!.length, id).toBeGreaterThanOrEqual(10);
      expect(profile.parts!.length, id).toBeLessThanOrEqual(24); // renderer draws at most 24 parts
      for (const part of profile.parts!) expect(part.colorHex, id).toMatch(HEX);
      expect(profile.colorHex, id).toBe("#b98a5a"); // Natural oak frame
      expect(profile.parts!.filter((part) => part.material === "wood").every((part) => part.colorHex === "#b98a5a"), id).toBe(true);
      signatures.add(JSON.stringify(profile.parts));
    }
    expect(signatures.size).toBe(BED_SIZES.length);
  });

  it("scales pillows with the bed instead of stretching them", () => {
    const pillows = (size: Parameters<typeof bedProduct>[0]) => {
      const product = bedProduct(size);
      return visualProfileFor(product)!.parts!.filter((part) => part.role === "cushion").map((part) => part.size.x * product.dimensions.width!);
    };
    expect(pillows("twin_xl")).toHaveLength(1);
    expect(pillows("queen")).toHaveLength(2);
    expect(pillows("twin_xl")[0]).toBeCloseTo(0.66, 2);
    expect(pillows("king")[0]).toBeCloseTo(0.91, 2);
  });

  it("recolors the frame and bedding, including custom colors", () => {
    const product = bedProduct("full");
    const colors = new Set(visualProfileFor(product, { frame: "Walnut", bedding: "#123abc" })!.parts!.map((part) => part.colorHex));
    expect(colors).toContain("#5d4030");
    expect(colors).toContain("#123abc");
    expect(colors).not.toContain("#b98a5a");
    expect(colorGroupsFor(product).map((group) => group.id)).toEqual(["frame", "bedding"]);
    expect(describeColor(product, { frame: "#aa3366" })).toBe("Custom #aa3366 / White");
  });
});

const bedProductIds = (project: Project) => project.products.filter((product) => product.id.startsWith("room-bed-")).map((product) => product.id);

describe("the beds that come with the room", () => {
  it("defaults new rooms to a placed Twin XL", () => {
    const project = createBlankProject();
    expect(project.room.providedBed).toBe("twin_xl");
    expect(roomBeds(project).map((bed) => bed.productId)).toEqual([bedProductId("twin_xl")]);
    expect(bedOf(project)?.transform).not.toBeNull();
    expect(calculateIssues(project).some((issue) => issue.affectedItemIds.includes(ROOM_BED_ITEM_ID))).toBe(false);
  });

  it("adds the demo bed without changing the demo's issues or cart", () => {
    const demo = createDemoProject();
    expect(bedOf(demo)?.productId).toBe(bedProductId("twin_xl"));
    expect(calculateIssues(demo).some((issue) => issue.affectedItemIds.includes(ROOM_BED_ITEM_ID))).toBe(false);
    // The demo layout is uncluttered: nothing overlaps, crosses a wall, or blocks the door swing.
    expect(calculateIssues(demo).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
    const withoutBed = removeRoomBed(demo, ROOM_BED_ITEM_ID);
    expect(purchaseSubtotal(demo)).toEqual(purchaseSubtotal(withoutBed));
    expect(shoppingListCsv(demo)).not.toContain("Twin XL bed");
  });

  it("adds a matching bed for the roommate without one, in a free spot", () => {
    const blank = createBlankProject();
    const shared = addRoomBed(blank);
    const beds = roomBeds(shared);
    expect(beds).toHaveLength(2);
    expect(new Set(beds.map((bed) => bed.id)).size).toBe(2);
    expect(beds.map((bed) => bed.productId)).toEqual([bedProductId("twin_xl"), bedProductId("twin_xl")]);
    expect(beds.map((bed) => bed.ownerId)).toEqual(["person-jay", "person-maya"]);
    expect(beds[1]).toMatchObject({ acquisitionStatus: "owned", purchaseStatus: "not_purchasing" });
    expect(bedProductIds(shared)).toEqual([bedProductId("twin_xl")]); // both beds share one product
    expect(calculateIssues(shared).filter((issue) => issue.type === "fit" || issue.type === "clearance")).toEqual([]);
    // The usual shared layout: the second bed mirrors the first across the room, leaving a walkway.
    const [first, second] = beds.map((bed) => bed.transform!);
    expect(second.position.x).toBeCloseTo(blank.room.width - first.position.x, 6);
    expect(second.position.y).toBeCloseTo(first.position.y, 6);
    expect(Math.abs(second.position.x - first.position.x) - bedProduct("twin_xl").dimensions.width!).toBeGreaterThan(0.6);
    expect(purchaseSubtotal(shared)).toEqual(purchaseSubtotal(blank));
    expect(shared.cartVersion).toBe(blank.cartVersion + 1);
    // With everyone covered, further beds go to the room's owner.
    expect(roomBeds(addRoomBed(shared, "full"))[2]).toMatchObject({ ownerId: "person-jay", productId: bedProductId("full") });
  });

  it("changes one bed's size in place, keeping its spot, lock, and colors", () => {
    const demo = createDemoProject();
    const styled = { ...demo, items: demo.items.map((item) => isRoomBedItem(item) ? { ...item, locked: true, colorSelection: { frame: "Cherry" } } : item) };
    const queen = setRoomBedSize(styled, ROOM_BED_ITEM_ID, "queen");
    const bed = bedOf(queen)!;
    expect(bed.productId).toBe(bedProductId("queen"));
    expect(bed.transform).toEqual(bedOf(styled)!.transform);
    expect(bed.locked).toBe(true);
    expect(bed.colorSelection).toEqual({ frame: "Cherry" });
    expect(queen.items.map((item) => item.id)).toEqual(styled.items.map((item) => item.id));
    expect(bedProductIds(queen)).toEqual([bedProductId("queen")]);
    expect(queen.room.providedBed).toBe("queen");

    const shared = addRoomBed(createBlankProject());
    const [first, second] = roomBeds(shared);
    const mixed = setRoomBedSize(shared, second.id, "full");
    expect(roomBeds(mixed).map((item) => item.productId)).toEqual([bedProductId("twin_xl"), bedProductId("full")]);
    expect(roomBeds(mixed)[0]).toEqual(first);
    expect(bedProductIds(mixed).sort()).toEqual([bedProductId("full"), bedProductId("twin_xl")].sort());
  });

  it("removes one bed at a time, down to none", () => {
    const shared = addRoomBed(createBlankProject());
    const [first, second] = roomBeds(shared);
    const single = removeRoomBed(shared, first.id);
    expect(roomBeds(single)).toEqual([second]);
    expect(single.room.providedBed).toBe("twin_xl");
    const none = removeRoomBed(single, second.id);
    expect(roomBeds(none)).toEqual([]);
    expect(bedProductIds(none)).toEqual([]);
    expect(none.room.providedBed).toBe("none");
    expect(ensureProvidedBed(none)).toBe(none); // an explicit "no bed" is never overridden
    expect(removeRoomBed(createDemoProject(), "item-desk").items.some((item) => item.id === "item-desk")).toBe(true); // only beds are removed
  });

  it("gives rooms saved before the setting a Twin XL once", () => {
    const demo = removeRoomBed(createDemoProject(), ROOM_BED_ITEM_ID);
    const legacy: Project = { ...demo, room: { ...demo.room, providedBed: undefined } };
    const migrated = ensureProvidedBed(legacy);
    expect(roomBeds(migrated).map((bed) => bed.productId)).toEqual([bedProductId("twin_xl")]);
    expect(migrated.cartVersion).toBe(legacy.cartVersion);
    expect(ensureProvidedBed(migrated)).toBe(migrated);
  });
});
