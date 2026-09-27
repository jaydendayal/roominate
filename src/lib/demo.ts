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

// The demo room is built only from real shortlist products (no made-up items).
// A few demo-only annotations give Better Cart something to work with:
// - alternativeGroupId marks products the group treats as interchangeable, which lets
//   Better Cart swap between them (other shortlist items are never used as swaps);
// - "over-3-cu-ft" marks fridges above the Maple Hall size limit for the housing rule.
const demoAnnotations: Record<string, Partial<Pick<Product, "alternativeGroupId">> & { extraTags?: string[] }> = {
  "shortlist-lagkapten-alex": { alternativeGroupId: "demo-desks" },
  "shortlist-torald": { alternativeGroupId: "demo-desks" },
  "shortlist-igloo-32": { alternativeGroupId: "demo-fridges", extraTags: ["over-3-cu-ft"] },
  "shortlist-frigidaire-10l": { alternativeGroupId: "demo-fridges" },
  "shortlist-upstreman-32": { extraTags: ["over-3-cu-ft"] },
};

export const demoProducts: Product[] = shortlistProducts.map((product) => {
  const annotation = demoAnnotations[product.id];
  if (!annotation) return product;
  const { extraTags = [], ...fields } = annotation;
  return { ...product, ...fields, tags: [...product.tags, ...extraTags] };
});

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
      mediaAssets: [
        {
          id: "media-demo",
          name: "move-in walkthrough · frame 03",
          type: "image",
          dataUrl: "/demo-room.svg",
          privacy: "private",
          size: 182400,
        },
      ],
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
        { id: "swatch-wall", hex: "#e7dfd0", label: "warm wall", source: "walkthrough · likely wall", pinned: true },
        { id: "swatch-floor", hex: "#a77f59", label: "maple floor", source: "walkthrough · likely floor", pinned: false },
        { id: "swatch-sage", hex: "#7f9186", label: "sage accent", source: "walkthrough · furnishing", pinned: false },
      ],
    },
    products: [...structuredClone(demoProducts), bedProduct("twin_xl")],
    items: structuredClone(demoItems),
    // $400 keeps the cart over budget after the rule and duplicate fixes, so Better Cart demonstrates a desk swap.
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
      mediaAssets: [],
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
