import { calculateIssues } from "./calculations";
import { initialProductPlacement } from "./discovery";
import type { BedSize, Item, Product, Project } from "./types";

// The beds that come with the room (dorms and furnished rentals usually provide one per resident).
// Each is an owned item that is never purchased, so it counts for fit and clearance but never for
// the cart.

const INCH = 0.0254;
export const MAX_BED_LOFT_METERS = 60 * INCH;

export interface BedSizeInfo {
  id: BedSize;
  label: string;
  /** US standard mattress width × length, in inches. */
  mattress: [number, number];
  /** Headboard height of the frame (the model's overall height), in meters. */
  headboardHeight: number;
}

export const BED_SIZES: BedSizeInfo[] = [
  { id: "twin", label: "Twin", mattress: [38, 75], headboardHeight: 0.95 },
  { id: "twin_xl", label: "Twin XL", mattress: [38, 80], headboardHeight: 0.95 },
  { id: "full", label: "Full", mattress: [54, 75], headboardHeight: 1.02 },
  { id: "full_xl", label: "Full XL", mattress: [54, 80], headboardHeight: 1.02 },
  { id: "queen", label: "Queen", mattress: [60, 80], headboardHeight: 1.1 },
  { id: "king", label: "King", mattress: [76, 80], headboardHeight: 1.18 },
  { id: "california_king", label: "California King", mattress: [72, 84], headboardHeight: 1.18 },
];

export const DEFAULT_BED_SIZE: BedSize = "twin_xl";
export const ROOM_BED_ITEM_ID = "item-room-bed";

/** The frame adds 1 in per side rail and 2 in each for the headboard and footboard. */
const FRAME_SIDE = 1 * INCH;
const FRAME_END = 2 * INCH;

export const bedSizeInfo = (size: BedSize) => BED_SIZES.find((info) => info.id === size)!;
export const bedProductId = (size: BedSize) => `room-bed-${size}`;

/** Bed size of a room-bed product id like "room-bed-twin_xl", or null for any other product. */
export function bedSizeOf(productId: string): BedSize | null {
  const size = productId.startsWith("room-bed-") ? productId.slice("room-bed-".length) : null;
  return BED_SIZES.some((info) => info.id === size) ? size as BedSize : null;
}

/** Mattress width and length in meters. */
export function mattressSize(size: BedSize) {
  const [width, length] = bedSizeInfo(size).mattress;
  return { width: width * INCH, length: length * INCH };
}

export function bedProduct(size: BedSize): Product {
  const info = bedSizeInfo(size);
  const mattress = mattressSize(size);
  const [widthIn, lengthIn] = info.mattress;
  return {
    id: bedProductId(size),
    name: `${info.label} bed`,
    store: "Comes with the room",
    sourceURL: null,
    category: "bed",
    variant: "Natural oak",
    dimensions: {
      width: Number((mattress.width + 2 * FRAME_SIDE).toFixed(4)),
      depth: Number((mattress.length + 2 * FRAME_END).toFixed(4)),
      height: info.headboardHeight,
    },
    price: null,
    fieldEvidence: {
      dimensions: { source: "user_confirmed", confidence: 0.85, confirmedByUser: false, note: `Standard ${info.label} mattress (${widthIn} × ${lengthIn} in) plus a typical frame; measure the bed to confirm.` },
    },
    tags: ["bed", "room-provided"],
  };
}

export const isRoomBedItem = (item: Item) => bedSizeOf(item.productId) !== null;

/** The beds that come with the room, in list order. Shared rooms usually have one per roommate. */
export const roomBeds = (project: Project) => project.items.filter(isRoomBedItem);

/**
 * Keeps the bed products and the room's bed setting in step with the bed items. Bed products still
 * in use are kept as they are; sizes no bed uses any more are dropped.
 */
function syncBeds(project: Project, items: Item[]): Project {
  const sizes = new Set(items.filter(isRoomBedItem).map((item) => bedSizeOf(item.productId)!));
  const kept = project.products.filter((product) => bedSizeOf(product.id) === null || sizes.has(bedSizeOf(product.id)!));
  const missing = [...sizes].filter((size) => !kept.some((product) => product.id === bedProductId(size))).map(bedProduct);
  const first = items.find(isRoomBedItem);
  return {
    ...project,
    room: { ...project.room, providedBed: first ? bedSizeOf(first.productId)! : "none" },
    products: [...kept, ...missing],
    items,
    cartVersion: project.cartVersion + 1,
    proposal: project.proposal ? { ...project.proposal, stale: true } : null,
  };
}

/**
 * Spots mirroring each existing bed across the room (side to side, then end to end), turned so the
 * headboard meets the mirrored wall. Roommates usually get this layout, with a walkway between beds.
 */
function mirroredBedSpots(project: Project, beds: Item[]): NonNullable<Item["transform"]>[] {
  const { width, length } = project.room;
  return [...beds].reverse().flatMap(({ transform }) => transform ? [
    { position: { x: width - transform.position.x, y: transform.position.y }, rotationZ: -transform.rotationZ },
    { position: { x: transform.position.x, y: length - transform.position.y }, rotationZ: Math.PI - transform.rotationZ },
  ] : []);
}

/**
 * Adds a bed that comes with the room, mirroring an existing bed when that spot is free and
 * otherwise at the first collision-free spot. It goes to the first roommate without a bed yet and
 * matches the last bed's size, since shared rooms usually get a matching bed each.
 */
export function addRoomBed(project: Project, size?: BedSize): Project {
  const beds = roomBeds(project);
  const bedSize = size ?? (beds.length ? bedSizeOf(beds[beds.length - 1].productId)! : DEFAULT_BED_SIZE);
  const product = bedProduct(bedSize);
  const withProduct = { ...project, products: [...project.products.filter((candidate) => candidate.id !== product.id), product] };
  const owners = new Set(beds.map((bed) => bed.ownerId));
  const item: Item = {
    id: project.items.some((candidate) => candidate.id === ROOM_BED_ITEM_ID) ? `${ROOM_BED_ITEM_ID}-${crypto.randomUUID()}` : ROOM_BED_ITEM_ID,
    productId: product.id,
    ownerId: project.people.find((person) => !owners.has(person.id))?.id ?? project.ownerId,
    acquisitionStatus: "owned",
    purchaseStatus: "not_purchasing",
    quantity: 1,
    essentiality: "essential",
    needsServed: ["sleeping"],
    transform: null,
    placementType: "floor",
  };
  const isFree = (transform: NonNullable<Item["transform"]>) => !calculateIssues({ ...withProduct, items: [...project.items, { ...item, transform }] })
    .some((issue) => (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(item.id));
  const transform = mirroredBedSpots(project, beds).find(isFree) ?? initialProductPlacement(withProduct, product);
  return syncBeds(project, [...project.items, { ...item, transform }]);
}

/** Changes one bed's size in place, keeping its spot, rotation, lock, owner, and colors. */
export function setRoomBedSize(project: Project, itemId: string, size: BedSize): Project {
  return syncBeds(project, project.items.map((item) => item.id === itemId && isRoomBedItem(item) ? { ...item, productId: bedProductId(size) } : item));
}

/** Removes one bed; removing the last one leaves the room with no bed. */
export function removeRoomBed(project: Project, itemId: string): Project {
  return syncBeds(project, project.items.filter((item) => item.id !== itemId || !isRoomBedItem(item)));
}

/** Rooms saved before the bed setting existed get the default Twin XL bed once. */
export function ensureProvidedBed(project: Project): Project {
  if (project.room.providedBed !== undefined) return project;
  const { cartVersion, proposal } = project;
  return { ...addRoomBed(project, DEFAULT_BED_SIZE), cartVersion, proposal };
}
