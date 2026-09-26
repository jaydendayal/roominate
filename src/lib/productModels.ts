import { furnitureModelKind } from "./furniture";
import { colorGroupsFor, isCustomColor, selectedChoice, shortlistKey } from "./productColors";
import type { FurnitureVisualPart, FurnitureVisualProfile, Item, Product } from "./types";

// Individual 3D models for each furnishing-shortlist product, built from primitives in the
// FurnitureVisualPart format the room renderer already understands. Extents are fractions of
// the product's confirmed box: x = width (0 left .. 1 right), y = height (0 floor .. 1 top),
// z = depth (0 back .. 1 front). Each part's `slot` picks its color from the item's finish:
//   "color" / "cover" / "frame"   primary color of that color group
//   "color:2" (etc.)              secondary color of a two-tone finish (falls back to primary)
//   "#rrggbb"                     fixed color (casters, glass, hardware)

type Extent = [number, number];
type Role = FurnitureVisualPart["role"];
type Material = FurnitureVisualPart["material"];

interface PartSpec {
  primitive: FurnitureVisualPart["primitive"];
  role: Role;
  x: Extent;
  y: Extent;
  z: Extent;
  slot: string;
  material: Material;
  rot?: [number, number, number];
}

const shape = (primitive: PartSpec["primitive"]) =>
  (role: Role, x: Extent, y: Extent, z: Extent, slot: string, material: Material, rot?: [number, number, number]): PartSpec => ({ primitive, role, x, y, z, slot, material, rot });
const box = shape("box");
const cyl = shape("cylinder");
const ball = shape("sphere");
const cone = shape("cone");

const GLASS = "#cfdadf";
const CHROME = "#b9bcbf";
const CASTER_BLACK = "#1c1c1c";
const HARDWARE = "#6b6b6b";

/** Office-chair star base: hub, three crossed spokes (six arms), and gas column. */
function starBase(slot: string, material: Material, columnTop: number, hubHeight = 0.07): PartSpec[] {
  const spoke = (angle: number) => box("leg", [0.04, 0.96], [0.01, hubHeight - 0.01], [0.46, 0.54], slot, material, [0, angle, 0]);
  return [
    cyl("base", [0.4, 0.6], [0, hubHeight], [0.4, 0.6], slot, material),
    spoke(0), spoke(60), spoke(120),
    cyl("base", [0.46, 0.54], [hubHeight, columnTop], [0.46, 0.54], CHROME, "metal"),
  ];
}

/** Four legs inset `inset` from each side, `t` thick, spanning `y`. */
function fourLegs(inset: number, t: number, y: Extent, slot: string, material: Material, round = true): PartSpec[] {
  const make = round ? cyl : box;
  const spots: [number, number][] = [[inset, inset], [1 - inset - t, inset], [inset, 1 - inset - t], [1 - inset - t, 1 - inset - t]];
  return spots.map(([x, z]) => make("leg", [x, x + t], y, [z, z + t], slot, material));
}

/** Drawer fronts in a grid on the front face, with a small handle on each. */
function drawerGrid(cols: number, rows: number, x: Extent, y: Extent, slot: string, handleSlot: string | null, material: Material = "wood"): PartSpec[] {
  const parts: PartSpec[] = [];
  const colW = (x[1] - x[0]) / cols;
  const rowH = (y[1] - y[0]) / rows;
  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x0 = x[0] + col * colW + 0.008;
      const x1 = x[0] + (col + 1) * colW - 0.008;
      const y0 = y[0] + row * rowH + 0.012;
      const y1 = y[0] + (row + 1) * rowH - 0.012;
      parts.push(box("drawer", [x0, x1], [y0, y1], [0.97, 1], slot, material));
      if (handleSlot) {
        const mid = (x0 + x1) / 2;
        const top = y1 - Math.min(0.06, (y1 - y0) * 0.3);
        parts.push(box("handle", [mid - 0.06, mid + 0.06], [top - 0.025, top], [0.985, 1], handleSlot, "metal"));
      }
    }
  }
  return parts;
}

export const shortlistModelSpecs: Record<string, PartSpec[]> = {
  // ---------- Chairs ----------
  "markus": [ // high mesh back, headrest, fixed arms
    ...starBase(CASTER_BLACK, "plastic", 0.31),
    box("seat", [0.14, 0.86], [0.31, 0.34], [0.27, 0.93], CASTER_BLACK, "plastic"),
    box("cushion", [0.12, 0.88], [0.33, 0.4], [0.25, 0.95], "color", "fabric"),
    box("back", [0.15, 0.85], [0.42, 0.86], [0.1, 0.18], "color", "fabric", [-8, 0, 0]),
    box("back", [0.22, 0.78], [0.45, 0.55], [0.14, 0.2], CASTER_BLACK, "plastic", [-8, 0, 0]),
    box("cushion", [0.28, 0.72], [0.87, 0.98], [0.12, 0.2], "color", "fabric", [-8, 0, 0]),
    box("arm", [0.08, 0.14], [0.4, 0.55], [0.45, 0.55], CASTER_BLACK, "plastic"),
    box("arm", [0.86, 0.92], [0.4, 0.55], [0.45, 0.55], CASTER_BLACK, "plastic"),
    box("arm", [0.06, 0.16], [0.55, 0.58], [0.3, 0.72], CASTER_BLACK, "plastic"),
    box("arm", [0.84, 0.94], [0.55, 0.58], [0.3, 0.72], CASTER_BLACK, "plastic"),
  ],
  "millberget": [ // padded faux-leather swivel chair with padded arms
    ...starBase("#2a2a2a", "metal", 0.36),
    box("seat", [0.15, 0.85], [0.36, 0.46], [0.2, 0.92], "color", "mixed"),
    box("back", [0.17, 0.83], [0.46, 0.96], [0.1, 0.22], "color", "mixed", [-10, 0, 0]),
    box("cushion", [0.22, 0.78], [0.5, 0.62], [0.16, 0.26], "color", "mixed", [-10, 0, 0]),
    box("arm", [0.07, 0.18], [0.44, 0.62], [0.24, 0.86], "color", "mixed"),
    box("arm", [0.82, 0.93], [0.44, 0.62], [0.24, 0.86], "color", "mixed"),
    box("arm", [0.1, 0.16], [0.36, 0.44], [0.5, 0.6], "#2a2a2a", "metal"),
    box("arm", [0.84, 0.9], [0.36, 0.44], [0.5, 0.6], "#2a2a2a", "metal"),
  ],
  "poang-chair": [ // bentwood cantilever frame with a separate cushion
    box("base", [0.04, 0.12], [0, 0.04], [0.05, 0.95], "frame", "wood"),
    box("base", [0.88, 0.96], [0, 0.04], [0.05, 0.95], "frame", "wood"),
    box("leg", [0.05, 0.11], [0.04, 0.52], [0.8, 0.88], "frame", "wood"),
    box("leg", [0.89, 0.95], [0.04, 0.52], [0.8, 0.88], "frame", "wood"),
    box("arm", [0.03, 0.13], [0.5, 0.56], [0.3, 0.88], "frame", "wood"),
    box("arm", [0.87, 0.97], [0.5, 0.56], [0.3, 0.88], "frame", "wood"),
    box("leg", [0.06, 0.12], [0.06, 0.42], [0.18, 0.26], "frame", "wood", [-32, 0, 0]),
    box("leg", [0.88, 0.94], [0.06, 0.42], [0.18, 0.26], "frame", "wood", [-32, 0, 0]),
    box("seat", [0.14, 0.86], [0.27, 0.31], [0.34, 0.9], "frame", "wood", [-12, 0, 0]),
    box("cushion", [0.15, 0.85], [0.3, 0.4], [0.34, 0.92], "cover", "fabric", [-12, 0, 0]),
    box("back", [0.15, 0.85], [0.4, 0.97], [0.1, 0.3], "cover", "fabric", [-22, 0, 0]),
    box("cushion", [0.2, 0.8], [0.84, 0.98], [0.06, 0.22], "cover", "fabric", [-22, 0, 0]),
  ],
  "flintan": [ // mesh-back office chair with loop arms
    ...starBase("#1f1f1f", "plastic", 0.36),
    box("seat", [0.15, 0.85], [0.36, 0.46], [0.22, 0.92], "color", "fabric"),
    box("back", [0.17, 0.83], [0.48, 0.93], [0.12, 0.2], "color", "fabric", [-8, 0, 0]),
    box("back", [0.46, 0.54], [0.38, 0.56], [0.1, 0.16], "#1f1f1f", "plastic"),
    box("arm", [0.08, 0.14], [0.4, 0.58], [0.45, 0.58], "#1f1f1f", "plastic"),
    box("arm", [0.86, 0.92], [0.4, 0.58], [0.45, 0.58], "#1f1f1f", "plastic"),
    box("arm", [0.07, 0.15], [0.58, 0.61], [0.3, 0.7], "#1f1f1f", "plastic"),
    box("arm", [0.85, 0.93], [0.58, 0.61], [0.3, 0.7], "#1f1f1f", "plastic"),
  ],
  "renberget": [ // upholstered swivel chair with adjustable arms
    ...starBase("#1f1f1f", "plastic", 0.38),
    box("seat", [0.14, 0.86], [0.38, 0.47], [0.22, 0.9], "color", "fabric"),
    box("back", [0.16, 0.84], [0.5, 0.91], [0.12, 0.22], "color", "fabric", [-6, 0, 0]),
    box("back", [0.45, 0.55], [0.4, 0.53], [0.12, 0.18], "#1f1f1f", "plastic"),
    box("arm", [0.07, 0.13], [0.42, 0.58], [0.45, 0.55], "#1f1f1f", "plastic"),
    box("arm", [0.87, 0.93], [0.42, 0.58], [0.45, 0.55], "#1f1f1f", "plastic"),
    box("arm", [0.05, 0.15], [0.58, 0.61], [0.32, 0.72], "#1f1f1f", "plastic"),
    box("arm", [0.85, 0.95], [0.58, 0.61], [0.32, 0.72], "#1f1f1f", "plastic"),
  ],
  "loberget-malskar": [ // molded one-piece shell on a MALSKÄR swivel base
    ...starBase("color:2", "plastic", 0.46, 0.08),
    box("seat", [0.15, 0.85], [0.45, 0.53], [0.2, 0.9], "color", "plastic"),
    box("back", [0.15, 0.85], [0.52, 0.96], [0.12, 0.24], "color", "plastic", [-10, 0, 0]),
    box("back", [0.12, 0.2], [0.5, 0.8], [0.2, 0.55], "color", "plastic"),
    box("back", [0.8, 0.88], [0.5, 0.8], [0.2, 0.55], "color", "plastic"),
  ],

  // ---------- Couches ----------
  "glostad": [ // compact boxy loveseat on small legs
    box("body", [0, 1], [0.08, 0.36], [0.05, 1], "color", "fabric"),
    box("cushion", [0.11, 0.5], [0.36, 0.52], [0.26, 0.98], "color", "fabric"),
    box("cushion", [0.5, 0.89], [0.36, 0.52], [0.26, 0.98], "color", "fabric"),
    box("back", [0.1, 0.9], [0.36, 0.96], [0, 0.26], "color", "fabric"),
    box("arm", [0, 0.11], [0.08, 0.72], [0.05, 1], "color", "fabric"),
    box("arm", [0.89, 1], [0.08, 0.72], [0.05, 1], "color", "fabric"),
    ...fourLegs(0.04, 0.03, [0, 0.08], "#2a2a2a", "wood"),
  ],
  "kivik-sofa": [ // deep three-seat sofa with wide arms
    box("body", [0, 1], [0.1, 0.42], [0.05, 1], "color", "fabric"),
    box("cushion", [0.12, 0.38], [0.42, 0.58], [0.24, 0.98], "color", "fabric"),
    box("cushion", [0.38, 0.62], [0.42, 0.58], [0.24, 0.98], "color", "fabric"),
    box("cushion", [0.62, 0.88], [0.42, 0.58], [0.24, 0.98], "color", "fabric"),
    box("back", [0.1, 0.9], [0.3, 0.9], [0, 0.14], "color", "fabric"),
    box("cushion", [0.13, 0.37], [0.46, 0.98], [0.06, 0.3], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.38, 0.62], [0.46, 0.98], [0.06, 0.3], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.63, 0.87], [0.46, 0.98], [0.06, 0.3], "color", "fabric", [-8, 0, 0]),
    box("arm", [0, 0.12], [0.1, 0.78], [0.05, 1], "color", "fabric"),
    box("arm", [0.88, 1], [0.1, 0.78], [0.05, 1], "color", "fabric"),
    ...fourLegs(0.03, 0.025, [0, 0.1], "#3a3a3a", "plastic"),
  ],
  "friheten-klagshamn": [ // L-shaped sleeper sectional with a storage chaise on the right
    box("body", [0, 0.62], [0, 0.45], [0.05, 0.62], "color", "fabric"),
    box("body", [0.62, 1], [0, 0.45], [0.05, 1], "color", "fabric"),
    box("cushion", [0.11, 0.62], [0.45, 0.56], [0.2, 0.62], "color", "fabric"),
    box("cushion", [0.62, 0.98], [0.45, 0.56], [0.2, 0.98], "color", "fabric"),
    box("back", [0, 1], [0.3, 1], [0, 0.2], "color", "fabric"),
    box("cushion", [0.11, 0.4], [0.5, 0.95], [0.12, 0.3], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.41, 0.7], [0.5, 0.95], [0.12, 0.3], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.71, 0.98], [0.5, 0.95], [0.12, 0.3], "color", "fabric", [-8, 0, 0]),
    box("arm", [0, 0.1], [0, 0.74], [0.05, 0.62], "color", "fabric"),
    box("other", [0.64, 0.96], [0.44, 0.46], [0.6, 0.99], "#555555", "fabric"),
  ],
  "klippan": [ // compact loveseat with high arms; patterned covers show the second color on the seat
    box("body", [0, 1], [0.1, 0.55], [0.1, 1], "color", "fabric"),
    box("cushion", [0.14, 0.86], [0.55, 0.67], [0.3, 0.98], "color:2", "fabric"),
    box("back", [0.12, 0.88], [0.45, 1], [0, 0.32], "color", "fabric"),
    box("arm", [0, 0.14], [0.1, 0.86], [0.1, 1], "color", "fabric"),
    box("arm", [0.86, 1], [0.1, 0.86], [0.1, 1], "color", "fabric"),
    ...fourLegs(0.03, 0.03, [0, 0.1], "#1f1f1f", "plastic"),
  ],
  "uppland": [ // three-seat sofa with rolled arms and wood legs
    box("body", [0, 1], [0.12, 0.45], [0.05, 1], "color", "fabric"),
    box("arm", [0, 0.1], [0.12, 0.62], [0.05, 1], "color", "fabric"),
    box("arm", [0.9, 1], [0.12, 0.62], [0.05, 1], "color", "fabric"),
    ball("arm", [0, 0.12], [0.52, 0.72], [0.05, 1], "color", "fabric"),
    ball("arm", [0.88, 1], [0.52, 0.72], [0.05, 1], "color", "fabric"),
    box("cushion", [0.1, 0.37], [0.45, 0.6], [0.22, 0.98], "color", "fabric"),
    box("cushion", [0.37, 0.63], [0.45, 0.6], [0.22, 0.98], "color", "fabric"),
    box("cushion", [0.63, 0.9], [0.45, 0.6], [0.22, 0.98], "color", "fabric"),
    box("cushion", [0.11, 0.37], [0.46, 1], [0.02, 0.28], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.37, 0.63], [0.46, 1], [0.02, 0.28], "color", "fabric", [-8, 0, 0]),
    box("cushion", [0.63, 0.89], [0.46, 1], [0.02, 0.28], "color", "fabric", [-8, 0, 0]),
    ...fourLegs(0.03, 0.03, [0, 0.12], "#6b4a33", "wood"),
  ],

  // ---------- Desks (color = top/body, color:2 = legs or drawer units) ----------
  "micke": [ // desk with a drawer over a cabinet on the right and a cable panel
    box("top", [0, 1], [0.95, 1], [0, 1], "color", "wood"),
    box("leg", [0, 0.03], [0, 0.95], [0.02, 0.98], "color", "wood"),
    box("body", [0.66, 1], [0, 0.95], [0, 0.97], "color", "wood"),
    box("drawer", [0.67, 0.99], [0.73, 0.93], [0.97, 1], "color:2", "wood"),
    box("door", [0.67, 0.99], [0.03, 0.71], [0.97, 1], "color:2", "wood"),
    box("handle", [0.78, 0.88], [0.86, 0.89], [0.99, 1], HARDWARE, "metal"),
    box("back", [0.03, 0.66], [0.5, 0.95], [0, 0.03], "color:2", "wood"),
  ],
  "linnmon-adils": [ // simple table-desk on four round legs
    box("top", [0, 1], [0.95, 1], [0, 1], "color", "wood"),
    ...fourLegs(0.03, 0.05, [0, 0.95], "color:2", "metal"),
  ],
  "lagkapten-alex": [ // wide top resting on two five-drawer ALEX units
    box("top", [0, 1], [0.95, 1], [0, 1], "color", "wood"),
    box("body", [0.01, 0.26], [0, 0.95], [0.03, 0.96], "color:2", "wood"),
    box("body", [0.74, 0.99], [0, 0.95], [0.03, 0.96], "color:2", "wood"),
    ...[0.19, 0.38, 0.57, 0.76].flatMap((y) => [
      box("drawer", [0.015, 0.255], [y, y + 0.012], [0.96, 0.975], "#6e6e6e", "wood"),
      box("drawer", [0.745, 0.985], [y, y + 0.012], [0.96, 0.975], "#6e6e6e", "wood"),
    ]),
  ],
  "torald": [ // compact desk on slim metal legs with a back rail
    box("top", [0, 1], [0.94, 1], [0, 1], "color", "wood"),
    ...fourLegs(0.02, 0.04, [0, 0.94], "color", "metal", false),
    box("other", [0.04, 0.96], [0.58, 0.62], [0.03, 0.08], "color", "metal"),
    box("shelf", [0.04, 0.96], [0.12, 0.15], [0.08, 0.92], "color", "metal"),
  ],
  "lagkapten-adils": [ // long tabletop on four ADILS legs
    box("top", [0, 1], [0.95, 1], [0, 1], "color", "wood"),
    ...fourLegs(0.02, 0.035, [0, 0.95], "color:2", "metal"),
  ],

  // ---------- Wardrobes ----------
  "brimnes-wardrobe-3": [ // three doors, the middle one mirrored
    box("body", [0, 1], [0.02, 1], [0, 0.96], "color", "wood"),
    box("base", [0, 1], [0, 0.02], [0, 0.94], "color", "wood"),
    box("door", [0.005, 0.33], [0.03, 0.99], [0.96, 0.99], "color", "wood"),
    box("door", [0.335, 0.665], [0.03, 0.99], [0.96, 0.99], GLASS, "glass"),
    box("door", [0.67, 0.995], [0.03, 0.99], [0.96, 0.99], "color", "wood"),
    box("handle", [0.29, 0.31], [0.45, 0.6], [0.99, 1], CHROME, "metal"),
    box("handle", [0.69, 0.71], [0.45, 0.6], [0.99, 1], CHROME, "metal"),
  ],
  "kleppstad-wardrobe-3": [ // three flat doors with black bar handles and a top trim
    box("body", [0, 1], [0, 0.98], [0, 0.96], "color", "wood"),
    box("top", [0, 1], [0.98, 1], [0, 0.98], "color", "wood"),
    box("door", [0.005, 0.33], [0.02, 0.97], [0.96, 0.99], "color", "wood"),
    box("door", [0.335, 0.665], [0.02, 0.97], [0.96, 0.99], "color", "wood"),
    box("door", [0.67, 0.995], [0.02, 0.97], [0.96, 0.99], "color", "wood"),
    box("handle", [0.3, 0.315], [0.42, 0.58], [0.99, 1], "#1f1f1f", "metal"),
    box("handle", [0.35, 0.365], [0.42, 0.58], [0.99, 1], "#1f1f1f", "metal"),
    box("handle", [0.685, 0.7], [0.42, 0.58], [0.99, 1], "#1f1f1f", "metal"),
  ],
  "brimnes-wardrobe-2": [ // tall two-door wardrobe on a plinth
    box("body", [0, 1], [0.02, 1], [0, 0.96], "color", "wood"),
    box("base", [0, 1], [0, 0.02], [0, 0.94], "color", "wood"),
    box("door", [0.005, 0.497], [0.03, 0.99], [0.96, 0.99], "color", "wood"),
    box("door", [0.503, 0.995], [0.03, 0.99], [0.96, 0.99], "color", "wood"),
    box("handle", [0.45, 0.47], [0.45, 0.6], [0.99, 1], CHROME, "metal"),
    box("handle", [0.53, 0.55], [0.45, 0.6], [0.99, 1], CHROME, "metal"),
  ],
  "kleppstad-wardrobe-2": [ // two flat doors with black bar handles
    box("body", [0, 1], [0, 0.98], [0, 0.96], "color", "wood"),
    box("top", [0, 1], [0.98, 1], [0, 0.98], "color", "wood"),
    box("door", [0.005, 0.497], [0.02, 0.97], [0.96, 0.99], "color", "wood"),
    box("door", [0.503, 0.995], [0.02, 0.97], [0.96, 0.99], "color", "wood"),
    box("handle", [0.44, 0.46], [0.42, 0.58], [0.99, 1], "#1f1f1f", "metal"),
    box("handle", [0.54, 0.56], [0.42, 0.58], [0.99, 1], "#1f1f1f", "metal"),
  ],
  "hauga-wardrobe": [ // overlapping sliding doors on short legs
    box("body", [0, 1], [0.04, 0.97], [0, 0.93], "color", "wood"),
    box("top", [0, 1], [0.97, 1], [0, 0.99], "color", "wood"),
    box("door", [0.01, 0.52], [0.05, 0.96], [0.93, 0.96], "color", "wood"),
    box("door", [0.48, 0.99], [0.05, 0.96], [0.96, 0.99], "color", "wood"),
    box("handle", [0.04, 0.05], [0.35, 0.65], [0.96, 0.975], HARDWARE, "metal"),
    box("handle", [0.95, 0.96], [0.35, 0.65], [0.99, 1], HARDWARE, "metal"),
    ...fourLegs(0.03, 0.04, [0, 0.04], "#cfcfcf", "metal"),
  ],

  // ---------- Laundry hampers ----------
  "klunka": [ // round laundry bag with a contrasting top band and handles
    cyl("body", [0, 1], [0, 0.88], [0, 1], "color", "fabric"),
    cyl("other", [-0.01, 1.01], [0.8, 0.9], [-0.01, 1.01], "color:2", "fabric"),
    box("handle", [0.08, 0.18], [0.88, 1], [0.45, 0.55], "color:2", "fabric"),
    box("handle", [0.82, 0.92], [0.88, 1], [0.45, 0.55], "color:2", "fabric"),
  ],
  "jall": [ // laundry bag hanging in a four-leg stand
    box("body", [0.05, 0.95], [0.15, 0.96], [0.05, 0.95], "color", "fabric"),
    ...fourLegs(0, 0.04, [0, 1], "#d8d8d8", "metal", false),
    box("other", [0, 1], [0.96, 1], [0, 0.04], "#d8d8d8", "metal"),
    box("other", [0, 1], [0.96, 1], [0.96, 1], "#d8d8d8", "metal"),
    box("other", [0, 0.04], [0.96, 1], [0, 1], "#d8d8d8", "metal"),
    box("other", [0.96, 1], [0.96, 1], [0, 1], "#d8d8d8", "metal"),
  ],
  "torkis": [ // low oval flexible basket with side handles
    cyl("body", [0, 1], [0, 0.86], [0, 1], "color", "plastic"),
    cyl("other", [0.01, 0.99], [0.84, 0.92], [0.01, 0.99], "color", "plastic"),
    box("handle", [0, 0.07], [0.66, 1], [0.4, 0.6], "color", "plastic"),
    box("handle", [0.93, 1], [0.66, 1], [0.4, 0.6], "color", "plastic"),
  ],
  "purrpingla": [ // soft rectangular bag with folded rim and carry handles
    box("body", [0, 1], [0, 0.9], [0, 1], "color", "fabric"),
    box("other", [-0.01, 1.01], [0.86, 0.93], [-0.01, 1.01], "color", "fabric"),
    box("handle", [0.3, 0.7], [0.93, 1], [0.02, 0.08], "color", "fabric"),
    box("handle", [0.3, 0.7], [0.93, 1], [0.92, 0.98], "color", "fabric"),
  ],
  "fyllen": [ // collapsible round basket with ribbed rings
    cyl("body", [0.02, 0.98], [0, 1], [0.02, 0.98], "color", "fabric"),
    cyl("other", [0, 1], [0, 0.04], [0, 1], "color", "plastic"),
    cyl("other", [0, 1], [0.48, 0.52], [0, 1], "color", "plastic"),
    cyl("other", [0, 1], [0.96, 1], [0, 1], "color", "plastic"),
    box("handle", [0.02, 0.1], [0.84, 0.95], [0.45, 0.55], "color", "plastic"),
    box("handle", [0.9, 0.98], [0.84, 0.95], [0.45, 0.55], "color", "plastic"),
  ],

  // ---------- Bean bags (color:2 shows the second color of patterned covers) ----------
  "hobestluk-velvet": [ // tall teardrop bean bag chair
    ball("seat", [0, 1], [0, 0.6], [0.05, 1], "color", "fabric"),
    ball("back", [0.08, 0.92], [0.32, 1], [0, 0.58], "color", "fabric"),
    ball("cushion", [0.15, 0.85], [0.42, 0.62], [0.45, 0.95], "color", "fabric"),
  ],
  "kisoy-faux-fur": [ // round fluffy faux-fur bean bag
    ball("body", [0, 1], [0, 0.9], [0, 1], "color", "fabric"),
    ball("cushion", [0.15, 0.85], [0.55, 1], [0.1, 0.8], "color", "fabric"),
  ],
  "maxyoyo-foam": [ // foam bean bag sofa with a back roll and side pocket
    ball("seat", [0, 1], [0, 0.56], [0.1, 1], "color", "fabric"),
    ball("back", [0.04, 0.96], [0.28, 1], [0, 0.46], "color", "fabric"),
    box("other", [0.9, 0.99], [0.2, 0.45], [0.42, 0.72], "color", "fabric"),
  ],
  "hobestluk-lounger": [ // long chaise-style lounger with a raised back end
    ball("seat", [0, 1], [0, 0.42], [0.04, 1], "color", "fabric"),
    ball("back", [0, 0.48], [0.18, 1], [0, 0.95], "color", "fabric"),
    box("other", [0.3, 0.98], [0.3, 0.33], [0.2, 0.9], "color:2", "fabric"),
  ],
  "hobestluk-convertible": [ // 3-in-1 sofa: mattress seat, fold-up back, bolster arms
    box("seat", [0.04, 0.96], [0, 0.46], [0.3, 1], "color", "fabric"),
    box("back", [0.04, 0.96], [0.2, 1], [0, 0.34], "color", "fabric"),
    ball("arm", [0, 0.12], [0.1, 0.78], [0.18, 1], "color", "fabric"),
    ball("arm", [0.88, 1], [0.1, 0.78], [0.18, 1], "color", "fabric"),
    box("other", [0.06, 0.94], [0.44, 0.47], [0.32, 0.99], "color:2", "fabric"),
  ],
  "big-joe-classic": [ // squat classic teardrop
    ball("seat", [0, 1], [0, 0.8], [0, 1], "color", "fabric"),
    ball("back", [0.1, 0.9], [0.3, 1], [0, 0.6], "color", "fabric"),
    ball("other", [0.32, 0.68], [0.72, 0.98], [0.12, 0.46], "color:2", "fabric"),
  ],

  // ---------- Ottomans ----------
  "kjuge": [ // round storage pouf with lid and pull tab
    cyl("body", [0, 1], [0, 0.84], [0, 1], "color", "fabric"),
    cyl("cushion", [0, 1], [0.84, 1], [0, 1], "color", "fabric"),
    box("handle", [0.45, 0.55], [0.86, 0.99], [0.94, 1], "color", "fabric"),
  ],
  "gamlehult": [ // rattan storage ottoman with an anthracite cushion lid
    cyl("body", [0, 1], [0, 0.8], [0, 1], "color", "wood"),
    cyl("other", [-0.005, 1.005], [0.24, 0.27], [-0.005, 1.005], "#8a6a42", "wood"),
    cyl("other", [-0.005, 1.005], [0.5, 0.53], [-0.005, 1.005], "#8a6a42", "wood"),
    cyl("cushion", [0, 1], [0.8, 1], [0, 1], "color:2", "fabric"),
  ],
  "oskarshamn": [ // upholstered storage ottoman on tapered wood legs
    box("body", [0, 1], [0.12, 0.86], [0, 1], "color", "fabric"),
    box("cushion", [0, 1], [0.86, 1], [0, 1], "color", "fabric"),
    ...fourLegs(0.06, 0.08, [0, 0.12], "#6b4a33", "wood"),
  ],
  "poang-ottoman": [ // bentwood footstool with a separate cushion
    box("base", [0.03, 0.12], [0, 0.08], [0.05, 0.95], "frame", "wood"),
    box("base", [0.88, 0.97], [0, 0.08], [0.05, 0.95], "frame", "wood"),
    box("leg", [0.04, 0.11], [0.08, 0.7], [0.12, 0.22], "frame", "wood"),
    box("leg", [0.89, 0.96], [0.08, 0.7], [0.12, 0.22], "frame", "wood"),
    box("other", [0.03, 0.12], [0.62, 0.72], [0.05, 0.95], "frame", "wood"),
    box("other", [0.88, 0.97], [0.62, 0.72], [0.05, 0.95], "frame", "wood"),
    box("cushion", [0.1, 0.9], [0.68, 1], [0.08, 0.92], "cover", "fabric", [-6, 0, 0]),
  ],
  "kivik-ottoman": [ // large storage ottoman with a padded top
    box("body", [0, 1], [0.08, 0.8], [0, 1], "color", "fabric"),
    box("cushion", [0.02, 0.98], [0.8, 1], [0.02, 0.98], "color", "fabric"),
    ...fourLegs(0.03, 0.03, [0, 0.08], "#3a3a3a", "plastic"),
  ],

  // ---------- Dressers ----------
  "brimnes-dresser": [ // tall four-drawer dresser; frosted-glass fronts show the second color
    box("body", [0, 1], [0.03, 1], [0, 0.97], "color", "wood"),
    box("base", [0.02, 0.98], [0, 0.03], [0.02, 0.95], "color", "wood"),
    ...drawerGrid(1, 4, [0.03, 0.97], [0.04, 0.98], "color:2", null),
  ],
  "storklinta-6": [ // wide six-drawer dresser in two columns
    box("body", [0, 1], [0.03, 1], [0, 0.97], "color", "wood"),
    box("base", [0.01, 0.99], [0, 0.03], [0.02, 0.95], "color", "wood"),
    ...drawerGrid(2, 3, [0.02, 0.98], [0.05, 0.97], "color", HARDWARE),
  ],
  "storemolla-8": [ // solid-pine eight-drawer dresser on a plinth
    box("body", [0, 1], [0.06, 1], [0, 0.97], "color", "wood"),
    box("base", [0.01, 0.99], [0, 0.06], [0.03, 0.95], "color", "wood"),
    ...drawerGrid(2, 4, [0.02, 0.98], [0.07, 0.97], "color", "#3a2f28"),
  ],
  "storklinta-3": [ // three-drawer dresser
    box("body", [0, 1], [0.03, 1], [0, 0.97], "color", "wood"),
    box("base", [0.01, 0.99], [0, 0.03], [0.02, 0.95], "color", "wood"),
    ...drawerGrid(1, 3, [0.03, 0.97], [0.05, 0.97], "color", HARDWARE),
  ],
  "hemnes-8": [ // solid-wood eight-drawer dresser with an overhanging top and knobs
    box("body", [0.01, 0.99], [0.06, 0.96], [0, 0.97], "color", "wood"),
    box("top", [0, 1], [0.96, 1], [0, 1], "color", "wood"),
    box("base", [0.01, 0.99], [0, 0.06], [0.02, 0.98], "color", "wood"),
    ...drawerGrid(2, 4, [0.03, 0.97], [0.07, 0.95], "color", "#5a4636"),
  ],

  // ---------- Lamps (color = base/stand, color:2 = shade) ----------
  "arstid": [ // table lamp: metal base and column with a fabric drum shade
    cyl("base", [0.22, 0.78], [0, 0.04], [0.22, 0.78], "color", "metal"),
    cyl("base", [0.46, 0.54], [0.04, 0.66], [0.46, 0.54], "color", "metal"),
    cyl("shade", [0, 1], [0.6, 1], [0, 1], "color:2", "fabric"),
  ],
  "tarnaby": [ // small table lamp with a dome shade, all one color
    cyl("base", [0.12, 0.88], [0, 0.08], [0.12, 0.88], "color", "plastic"),
    cyl("base", [0.44, 0.56], [0.08, 0.46], [0.44, 0.56], "color", "plastic"),
    ball("shade", [0, 1], [0.38, 1], [0, 1], "color", "plastic"),
  ],
  "lersta": [ // floor reading lamp with an angled arm and small cone shade
    cyl("base", [0, 1], [0, 0.03], [0, 1], "color", "metal"),
    cyl("base", [0.45, 0.55], [0.03, 0.9], [0.45, 0.55], "color", "metal"),
    box("arm", [0.46, 0.84], [0.88, 0.9], [0.46, 0.54], "color", "metal", [0, 0, 18]),
    cone("shade", [0.56, 0.98], [0.78, 0.94], [0.3, 0.7], "color", "metal"),
  ],
  "lauters": [ // tripod floor lamp with a fabric drum shade
    box("leg", [0.22, 0.28], [0, 0.72], [0.68, 0.74], "color", "wood", [8, 0, -8]),
    box("leg", [0.72, 0.78], [0, 0.72], [0.68, 0.74], "color", "wood", [8, 0, 8]),
    box("leg", [0.47, 0.53], [0, 0.72], [0.2, 0.26], "color", "wood", [-10, 0, 0]),
    cyl("base", [0.47, 0.53], [0.58, 0.74], [0.47, 0.53], "color", "wood"),
    cyl("shade", [0.03, 0.97], [0.7, 1], [0.03, 0.97], "color:2", "fabric"),
  ],
  "barlast": [ // floor lamp: disc base, thin pole, drum shade
    cyl("base", [0.1, 0.9], [0, 0.03], [0.1, 0.9], "color", "metal"),
    cyl("base", [0.47, 0.53], [0.03, 0.8], [0.47, 0.53], "color", "metal"),
    cyl("shade", [0, 1], [0.78, 1], [0, 1], "color:2", "fabric"),
  ],
  "fado": [ // globe table lamp on a small base
    cyl("base", [0.3, 0.7], [0, 0.14], [0.3, 0.7], "color", "plastic"),
    ball("shade", [0, 1], [0.1, 1], [0, 1], "color", "glass"),
  ],

  // ---------- Mirrors (color = frame) ----------
  "nissedal": [ // rectangular framed wall mirror
    box("body", [0, 1], [0, 1], [0, 0.7], "color", "wood"),
    box("other", [0.06, 0.94], [0.03, 0.97], [0.7, 1], GLASS, "glass"),
  ],
  "lindbyn": [ // round wall mirror with a slim frame
    ball("body", [0, 1], [0, 1], [0, 0.6], "color", "metal"),
    ball("other", [0.04, 0.96], [0.04, 0.96], [0.4, 1], GLASS, "glass"),
  ],
  "stockholm-mirror": [ // round mirror with a wide walnut-veneer frame
    ball("body", [0, 1], [0, 1], [0, 0.7], "color", "wood"),
    ball("other", [0.1, 0.9], [0.1, 0.9], [0.45, 1], GLASS, "glass"),
  ],
  "hovet": [ // full-length mirror with a narrow frame
    box("body", [0, 1], [0, 1], [0, 0.7], "color", "metal"),
    box("other", [0.04, 0.96], [0.02, 0.98], [0.7, 1], GLASS, "glass"),
  ],
  "karmsund": [ // standing mirror with a rear support and feet
    box("body", [0, 1], [0.03, 1], [0.44, 0.56], "color", "wood"),
    box("other", [0.05, 0.95], [0.05, 0.98], [0.56, 0.6], GLASS, "glass"),
    box("leg", [0.44, 0.56], [0, 0.62], [0, 0.44], "color", "wood"),
    box("base", [0, 1], [0, 0.03], [0.3, 0.7], "color", "wood"),
  ],

  // ---------- Mini fridges ----------
  "frigidaire-efmis171": [ // retro personal fridge with a carry handle
    box("body", [0, 1], [0, 0.84], [0, 0.95], "color", "plastic"),
    box("door", [0.04, 0.96], [0.04, 0.8], [0.95, 1], "color", "plastic"),
    box("handle", [0.2, 0.8], [0.84, 1], [0.42, 0.58], "color", "plastic"),
    box("other", [0.3, 0.7], [0.66, 0.7], [0.99, 1], CHROME, "metal"),
  ],
  "crownful-4l": [ // cube cooler/warmer with a top handle
    box("body", [0, 1], [0, 0.86], [0, 0.95], "color", "plastic"),
    box("door", [0.05, 0.95], [0.05, 0.82], [0.95, 1], "color", "plastic"),
    box("handle", [0.15, 0.85], [0.86, 1], [0.4, 0.6], "color", "plastic"),
    box("handle", [0.44, 0.56], [0.55, 0.7], [0.99, 1], HARDWARE, "plastic"),
  ],
  "cooluli-4l": [ // cube cooler/warmer; print options show the second color as patches
    box("body", [0, 1], [0, 0.86], [0, 0.95], "color", "plastic"),
    box("door", [0.05, 0.95], [0.05, 0.82], [0.95, 1], "color", "plastic"),
    box("handle", [0.15, 0.85], [0.86, 1], [0.4, 0.6], "color", "plastic"),
    box("other", [0.12, 0.38], [0.45, 0.7], [0.995, 1], "color:2", "plastic"),
    box("other", [0.58, 0.86], [0.15, 0.36], [0.995, 1], "color:2", "plastic"),
  ],
  "igloo-32": [ // dorm fridge with freezer compartment line and side handle
    box("body", [0, 1], [0.03, 1], [0, 0.95], "color", "metal"),
    box("door", [0.02, 0.98], [0.05, 0.98], [0.95, 0.99], "color", "metal"),
    box("other", [0.06, 0.94], [0.8, 0.81], [0.99, 1], "#777777", "metal"),
    box("handle", [0.86, 0.9], [0.55, 0.8], [0.99, 1], CHROME, "metal"),
    box("other", [0.12, 0.62], [0.3, 0.36], [0.99, 1], "color:2", "plastic"),
    box("base", [0.05, 0.2], [0, 0.03], [0.1, 0.9], "#2a2a2a", "plastic"),
    box("base", [0.8, 0.95], [0, 0.03], [0.1, 0.9], "#2a2a2a", "plastic"),
  ],
  "frigidaire-10l": [ // countertop fridge with a glass door and bar handle
    box("body", [0, 1], [0, 1], [0, 0.94], "color", "metal"),
    box("door", [0.06, 0.94], [0.08, 0.92], [0.94, 0.99], "#2c3035", "glass"),
    box("handle", [0.82, 0.86], [0.25, 0.75], [0.99, 1], "color", "metal"),
    box("base", [0.04, 0.96], [0, 0.04], [0.04, 0.9], "#1f1f1f", "plastic"),
  ],
  "upstreman-32": [ // dorm fridge with a recessed handle and feet
    box("body", [0, 1], [0.03, 1], [0, 0.95], "color", "metal"),
    box("door", [0.02, 0.98], [0.05, 0.98], [0.95, 0.99], "color", "metal"),
    box("handle", [0.04, 0.06], [0.5, 0.85], [0.99, 1], "#3a3a3a", "plastic"),
    box("base", [0.05, 0.2], [0, 0.03], [0.1, 0.9], "#2a2a2a", "plastic"),
    box("base", [0.8, 0.95], [0, 0.03], [0.1, 0.9], "#2a2a2a", "plastic"),
  ],
};

function toPart(spec: PartSpec, colorHex: string | null): FurnitureVisualPart {
  const mid = (extent: Extent) => Number(((extent[0] + extent[1]) / 2 - 0.5).toFixed(4));
  const span = (extent: Extent) => Number((extent[1] - extent[0]).toFixed(4));
  const [rx, ry, rz] = spec.rot ?? [0, 0, 0];
  return {
    primitive: spec.primitive,
    role: spec.role,
    position: { x: mid(spec.x), y: mid(spec.y), z: mid(spec.z) },
    size: { x: span(spec.x), y: span(spec.y), z: span(spec.z) },
    rotation: { x: rx, y: ry, z: rz },
    material: spec.material,
    colorHex,
  };
}

/** The item's 3D model: a shortlist product's own model in its chosen finish, or an imported product's profile recolored when a custom color is set. */
export function visualProfileFor(product: Product, selection?: Item["colorSelection"]): FurnitureVisualProfile | undefined {
  const specs = shortlistModelSpecs[shortlistKey(product.id)];
  if (specs) {
    const groups = colorGroupsFor(product);
    const choice = (groupId: string) => {
      const colorGroup = groups.find((candidate) => candidate.id === groupId) ?? groups[0];
      return colorGroup ? selectedChoice(colorGroup, selection?.[colorGroup.id]) : undefined;
    };
    const resolve = (slot: string) => {
      if (slot.startsWith("#")) return slot;
      const [groupId, tone] = slot.split(":");
      const chosen = choice(groupId);
      if (!chosen) return null;
      return tone === "2" ? chosen.secondary ?? chosen.hex : chosen.hex;
    };
    const archetype = furnitureModelKind(product.category, product.name);
    return {
      archetype,
      style: "modern",
      material: "mixed",
      silhouette: "standard",
      hasArms: true,
      hasBack: true,
      legStyle: "none",
      colorHex: resolve(groups[0]?.id ?? "color"),
      confidence: 1,
      evidence: `Built-in model for ${product.name}`,
      parts: specs.map((spec) => toPart(spec, resolve(spec.slot))),
    };
  }
  // Imported products: a custom color recolors the AI-generated (or archetype) model.
  const custom = selection?.color;
  if (!isCustomColor(custom)) return product.visualProfile;
  const base: FurnitureVisualProfile = product.visualProfile ?? {
    archetype: furnitureModelKind(product.category, product.name),
    style: "modern",
    material: "mixed",
    silhouette: "standard",
    hasArms: false,
    hasBack: true,
    legStyle: "none",
    colorHex: null,
    confidence: 1,
    evidence: "Custom color chosen by the user",
  };
  return { ...base, colorHex: custom, parts: base.parts?.map((part) => ({ ...part, colorHex: custom })) };
}
