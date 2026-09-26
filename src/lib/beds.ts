import { initialProductPlacement } from "./discovery";
import type { BedSize, Item, Product, Project } from "./types";

// The bed that comes with the room (dorms and furnished rentals usually provide one). It is an
// owned item that is never purchased, so it counts for fit and clearance but never for the cart.

const INCH = 0.0254;

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

/** The size shown for the room: the bed actually in the room, or "none" if it was removed. */
export function currentBedSize(project: Project): BedSize | "none" {
  const bed = project.items.find(isRoomBedItem);
  return bed ? bedSizeOf(bed.productId)! : "none";
}

/**
 * Sets the bed that comes with the room. Changing the size keeps the bed's spot, rotation, lock,
 * and colors; adding one places it at the first collision-free spot; "none" removes it.
 */
export function setProvidedBed(project: Project, size: BedSize | "none"): Project {
  const existing = project.items.find(isRoomBedItem);
  const others = project.items.filter((item) => !isRoomBedItem(item));
  const products = project.products.filter((product) => bedSizeOf(product.id) === null);
  const base: Project = {
    ...project,
    room: { ...project.room, providedBed: size },
    products,
    items: others,
    cartVersion: project.cartVersion + 1,
    proposal: project.proposal ? { ...project.proposal, stale: true } : null,
  };
  if (size === "none") return base;
  const product = bedProduct(size);
  const withProduct = { ...base, products: [...products, product] };
  const item: Item = existing
    ? { ...existing, productId: product.id }
    : {
      id: ROOM_BED_ITEM_ID,
      productId: product.id,
      ownerId: project.ownerId,
      acquisitionStatus: "owned",
      purchaseStatus: "not_purchasing",
      quantity: 1,
      essentiality: "essential",
      needsServed: ["sleeping"],
      transform: initialProductPlacement(withProduct, product),
      placementType: "floor",
    };
  return { ...withProduct, items: [...others, item] };
}

/** Rooms saved before the bed setting existed get the default Twin XL bed once. */
export function ensureProvidedBed(project: Project): Project {
  if (project.room.providedBed !== undefined) return project;
  const { cartVersion, proposal } = project;
  return { ...setProvidedBed(project, DEFAULT_BED_SIZE), cartVersion, proposal };
}
