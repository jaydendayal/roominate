import type { Item, Product, Project } from "./types";
import { addRoomBed, bedProduct, bedProductId, ROOM_BED_ITEM_ID } from "./beds";
import { DEFAULT_PRIORITIES } from "./priorities";
import { shortlistProducts } from "./shortlist";

const now = "2026-08-15T14:30:00.000Z";
const evidence = {
  source: "demo_fixture" as const,
  confidence: 1,
  confirmedByUser: true,
};

// The demo room is built only from real shortlist products (no made-up items). Better Cart
// swaps between any of them in the same category; the one demo-only annotation tags the
// fridges above the Maple Hall size limit for the housing rule.
const overSizeLimit = new Set(["shortlist-igloo-32", "shortlist-upstreman-32"]);

export const demoProducts: Product[] = shortlistProducts.map((product) =>
  overSizeLimit.has(product.id) ? { ...product, tags: [...product.tags, "over-3-cu-ft"] } : product);

// A tidy dorm layout (the room is 3.66 m west-east by 3.05 m south-north; the entry door
// swings in at the south-west corner and the window is on the north wall):
// - the Twin XL bed that comes with the room runs along the north wall, headboard to the west
//   wall, with Jay's floor lamp beside the headboard as a reading light;
// - the desk sits under the north window with the chair pulled up to it;
// - Maya's dresser and Jay's mini fridge stand against the south wall, facing into the room;
// - Maya's pouf sits against the east wall as spare seating.
// Nothing collides or blocks the door, so the demo's issues come from the cart instead: the
// fridge breaks the hall's size rule, both roommates plan a floor lamp (Maya's is not placed
// yet, so its fit is unverified), and the cart is over budget.
export const demoItems: Item[] = [
  {
    id: ROOM_BED_ITEM_ID,
    productId: bedProductId("twin_xl"),
    ownerId: "person-jay",
    acquisitionStatus: "owned",
    purchaseStatus: "not_purchasing",
    quantity: 1,
    essentiality: "essential",
    needsServed: ["sleeping"],
    transform: { position: { x: 1.09, y: 2.52 }, rotationZ: Math.PI / 2 },
    placementType: "floor",
  },
  {
    id: "item-desk",
    productId: "shortlist-lagkapten-alex",
    ownerId: "person-jay",
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "essential",
    needsServed: ["workspace"],
    transform: { position: { x: 2.9, y: 2.73 }, rotationZ: 0 },
    placementType: "floor",
  },
  {
    id: "item-chair",
    productId: "shortlist-flintan",
    ownerId: "person-jay",
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "essential",
    needsServed: ["workspace", "seating"],
    transform: { position: { x: 2.9, y: 2.05 }, rotationZ: Math.PI },
    placementType: "floor",
  },
  {
    id: "item-fridge",
    productId: "shortlist-igloo-32",
    ownerId: "person-jay",
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "optional",
    needsServed: ["cold-storage"],
    transform: { position: { x: 3.42, y: 0.26 }, rotationZ: Math.PI },
    placementType: "floor",
  },
  {
    id: "item-lamp-jay",
    productId: "shortlist-lauters",
    ownerId: "person-jay",
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "optional",
    needsServed: ["room-lighting"],
    transform: { position: { x: 0.22, y: 1.78 }, rotationZ: 0 },
    placementType: "floor",
  },
  {
    id: "item-lamp-maya",
    productId: "shortlist-barlast",
    ownerId: "person-maya",
    acquisitionStatus: "planned",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "optional",
    needsServed: ["room-lighting"],
    transform: null,
    placementType: "floor",
  },
  {
    id: "item-pouf",
    productId: "shortlist-kjuge",
    ownerId: "person-maya",
    acquisitionStatus: "owned",
    purchaseStatus: "not_purchasing",
    quantity: 1,
    essentiality: "optional",
    needsServed: ["seating", "storage"],
    transform: { position: { x: 3.43, y: 1.35 }, rotationZ: 0 },
    placementType: "floor",
  },
  {
    id: "item-dresser",
    productId: "shortlist-storklinta-3",
    ownerId: "person-maya",
    acquisitionStatus: "owned",
    purchaseStatus: "not_purchasing",
    quantity: 1,
    essentiality: "essential",
    needsServed: ["storage"],
    transform: { position: { x: 1.75, y: 0.26 }, rotationZ: Math.PI },
    placementType: "floor",
    locked: true,
  },
];

export function createDemoProject(): Project {
  return {
    schemaVersion: 1,
    id: "project-demo",
    name: "Maple Hall · 214",
    roomType: "Shared dorm",
    ownerId: "person-jay",
    people: [
      { id: "person-jay", name: "Jay", color: "#6e6363" },
      { id: "person-maya", name: "Maya", color: "#5f6aa5" },
    ],
    room: {
      id: "room-demo",
      width: 3.66,
      length: 3.05,
      height: 2.44,
      providedBed: "twin_xl",
      dimensionEvidence: {
        width: { ...evidence, source: "imported_plan" },
        length: { ...evidence, source: "user_confirmed" },
        height: { ...evidence, source: "user_confirmed" },
      },
      features: [
        {
          id: "door-entry",
          name: "Entry door",
          kind: "door",
          position: { x: 0.46, y: 0.04 },
          width: 0.91,
          depth: 0.08,
          height: 2.03,
          confirmed: true,
        },
        {
          id: "window-north",
          name: "North window",
          kind: "window",
          position: { x: 2.75, y: 3.01 },
          width: 1.2,
          depth: 0.08,
          height: 1.1,
          confirmed: false,
        },
      ],
      clearanceZones: [
        {
          id: "clear-door-entry",
          name: "Entry door swing",
          position: { x: 0.48, y: 0.48 },
          width: 0.96,
          depth: 0.96,
          source: "user_confirmed",
          confirmed: true,
        },
      ],
      geometryVersion: 1,
      reconstructionStatus: "reviewed",
      palette: [
        { id: "swatch-wall", hex: "#e7dfd0", label: "warm wall", source: "demo palette · likely wall", pinned: true },
        { id: "swatch-floor", hex: "#a77f59", label: "maple floor", source: "demo palette · likely floor", pinned: false },
        { id: "swatch-sage", hex: "#7f9186", label: "sage accent", source: "demo palette · furnishing", pinned: false },
      ],
    },
    products: [...structuredClone(demoProducts), bedProduct("twin_xl")],
    items: structuredClone(demoItems),
    // $400 keeps the cart over budget after the rule and duplicate fixes, so Better Cart demonstrates a same-size desk swap.
    budgetAmount: 40000,
    budgetCurrency: "USD",
    priorities: [...DEFAULT_PRIORITIES],
    needs: ["workspace", "seating", "storage"],
    rules: [
      {
        id: "rule-fridge-size",
        label: "Maple Hall appliance policy",
        text: "Refrigerators larger than 3.0 cubic feet are not permitted in student rooms.",
        sourceURL: null,
        sourceType: "user_note",
        verificationStatus: "confirmed",
        prohibitedCategories: [],
        prohibitedTags: ["over-3-cu-ft"],
        dismissed: false,
      },
    ],
    duplicateResolutions: {},
    proposal: null,
    cartVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export const BETTER_CART_TEST_PROJECT_ID = "project-better-cart-test";

/** Built-in rooms: always listed, restored by Reset demo, and never deleted. */
export const isBuiltInProject = (id: string) => id === "project-demo" || id === BETTER_CART_TEST_PROJECT_ID;

function testItem(id: string, productId: string, ownerId: string, [x, y]: [number, number], rotationZ: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    productId,
    ownerId,
    acquisitionStatus: "buying",
    purchaseStatus: "in_cart",
    quantity: 1,
    essentiality: "optional",
    needsServed: [],
    transform: { position: { x, y }, rotationZ },
    placementType: "floor",
    ...extra,
  };
}

// A room built to exercise every Better Cart path with real catalog products. It is an attic
// double, 3.66 m west-east by 3.35 m south-north under a 1.95 m ceiling. The entry door swings in
// at the south-west corner, and each roommate's Twin XL bed runs along a side wall. Each problem
// calls for a different fix:
// - rule: Jay's Upstreman 3.2 cu ft fridge is over the hall's size limit, so it is replaced with
//   the closest-sized permitted fridge (Frigidaire 10 L);
// - duplicate: both roommates plan a floor lamp, so Jay's pricier LAUTERS is deferred;
// - ceiling: Jay's HAUGA wardrobe (1.99 m) is taller than the attic ceiling and moving can't fix
//   that, so it becomes the same-footprint, shorter KLEPPSTAD 3-door;
// - no room: Maya's KIVIK sofa (2.28 m) has no free spot in any orientation, and neither does the
//   KLIPPAN loveseat, so it becomes the GLOSTAD loveseat that fits between the beds;
// - overlap: Maya's JÄLL hamper sits on her bed and is already the cheapest hamper, so it moves;
// - budget: the cart is still over the $600 limit, so the desk becomes the same-size, cheaper
//   LAGKAPTEN / ADILS.
export function createBetterCartTestProject(): Project {
  const project = createDemoProject();
  const jay = "person-jay";
  const maya = "person-maya";
  return {
    ...project,
    id: BETTER_CART_TEST_PROJECT_ID,
    name: "Better Cart test · Birch Attic 3B",
    roomType: "Attic double",
    room: {
      ...project.room,
      id: "room-better-cart-test",
      width: 3.66,
      length: 3.35,
      height: 1.95,
      features: [
        { id: "door-entry", name: "Entry door", kind: "door", position: { x: 0.5, y: 0.04 }, width: 0.86, depth: 0.08, height: 1.9, wall: "south", confirmed: true },
        { id: "window-dormer", name: "Dormer window", kind: "window", position: { x: 1.83, y: 3.31 }, width: 0.9, depth: 0.08, height: 0.9, elevation: 0.9, wall: "north", confirmed: true },
      ],
      clearanceZones: [
        { id: "clear-door-entry", name: "Entry door swing", position: { x: 0.5, y: 0.47 }, width: 0.9, depth: 0.9, source: "user_confirmed", confirmed: true },
      ],
      palette: [],
    },
    items: [
      { ...structuredClone(demoItems[0]), transform: { position: { x: 0.52, y: 2.27 }, rotationZ: 0 } },
      { ...structuredClone(demoItems[0]), id: `${ROOM_BED_ITEM_ID}-maya`, ownerId: maya, transform: { position: { x: 3.14, y: 2.27 }, rotationZ: 0 } },
      testItem("item-wardrobe", "shortlist-hauga-wardrobe", jay, [1.64, 0.28], Math.PI, { essentiality: "essential", needsServed: ["wardrobe"] }),
      testItem("item-fridge", "shortlist-upstreman-32", jay, [2.5, 0.24], Math.PI, { needsServed: ["mini fridge"] }),
      testItem("item-desk", "shortlist-lagkapten-alex", jay, [1.83, 3.04], 0, { essentiality: "essential", needsServed: ["workspace"] }),
      testItem("item-chair", "shortlist-flintan", jay, [1.83, 2.35], Math.PI, { acquisitionStatus: "owned", purchaseStatus: "not_purchasing", essentiality: "essential", needsServed: ["seating"] }),
      testItem("item-lamp-jay", "shortlist-lauters", jay, [1.23, 2.45], 0, { needsServed: ["room-lighting"] }),
      testItem("item-lamp-maya", "shortlist-barlast", maya, [2.45, 2.45], 0, { acquisitionStatus: "planned", needsServed: ["room-lighting"] }),
      testItem("item-sofa", "shortlist-kivik-sofa", maya, [1.83, 1.45], 0, { needsServed: ["couch"] }),
      testItem("item-hamper", "shortlist-jall", maya, [2.6, 1.3], 0, { needsServed: ["laundry"] }),
      testItem("item-dresser", "shortlist-storklinta-3", maya, [3.25, 0.25], Math.PI, { acquisitionStatus: "owned", purchaseStatus: "not_purchasing", essentiality: "essential", needsServed: ["storage"] }),
    ],
    budgetAmount: 60000,
    needs: ["sleeping", "workspace", "storage", "room-lighting"],
    rules: [{ ...project.rules[0], label: "Birch Hall appliance policy" }],
  };
}

/** A new room starts empty apart from the default Twin XL bed that comes with it. */
export function createBlankProject(name = "Untitled room"): Project {
  const project = createDemoProject();
  return addRoomBed({
    ...project,
    id: `project-${crypto.randomUUID()}`,
    name,
    roomType: "Bedroom",
    room: {
      ...project.room,
      id: `room-${crypto.randomUUID()}`,
      width: 3,
      length: 3.4,
      height: 2.4,
      reconstructionStatus: "manual",
      features: [],
      clearanceZones: [],
      palette: [],
      geometryVersion: 1,
    },
    products: structuredClone(shortlistProducts),
    items: [],
    budgetAmount: 50000,
    priorities: [...DEFAULT_PRIORITIES],
    needs: [],
    rules: [],
    duplicateResolutions: {},
    proposal: null,
    cartVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, "twin_xl");
}
