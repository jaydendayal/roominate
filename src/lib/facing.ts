import { furnitureModelKind } from "./furniture";
import { pointInPolygon, roomPolygon } from "./roomShape";
import type { Product, Room, Vec2 } from "./types";

// Furniture used from one side, like a dresser's drawers, a desk's seat side, or a wardrobe's or mini
// fridge's door, must face into the room. Automatic arrangements (Better Cart moves and swaps, and
// Generate optimal layout) never put that side against a wall.

const FRONT_FACING = new Set(["desk", "dresser", "wardrobe", "mini_fridge"]);

/** Open floor needed in front of a piece to pull out drawers, open a door, or sit at a desk. */
export const FRONT_CLEARANCE = 0.45;

/** Whether this product has a front that must stay open (drawers, doors, or a desk's seat side). */
export const hasFront = (product: Pick<Product, "category" | "name">) => FRONT_FACING.has(furnitureModelKind(product.category, product.name));

/**
 * The floor direction a piece's front faces. Models put drawers and doors on their front, which faces
 * south (-Y) at rotation 0 and turns with the item: east (+X) at a quarter turn, and so on.
 */
export function frontDirection(rotationZ: number): Vec2 {
  return { x: Math.sin(rotationZ), y: -Math.cos(rotationZ) };
}

/**
 * Whether a piece at this spot has its front against a wall: the floor just in front of it (by
 * FRONT_CLEARANCE) is outside the room. Always false for products without a front.
 */
export function frontFacesWall(room: Pick<Room, "width" | "length" | "outline">, product: Pick<Product, "category" | "name" | "dimensions">, position: Vec2, rotationZ: number) {
  const depth = product.dimensions.depth;
  if (!hasFront(product) || depth == null || !(depth > 0)) return false;
  const front = frontDirection(rotationZ);
  const reach = depth / 2 + FRONT_CLEARANCE;
  return !pointInPolygon({ x: position.x + front.x * reach, y: position.y + front.y * reach }, roomPolygon(room));
}
