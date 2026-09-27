import type { Item, Product } from "./types";

// Color options for the furnishing shortlist, as listed on each IKEA / Amazon product page
// (checked 2026-09-26) plus colors named in the shortlist sheet. Hex values approximate each
// finish for the 3D model. `secondary` is the second color of two-tone finishes
// (e.g. "White/black": white top, black legs); parts that use it fall back to the primary.

export interface ColorChoice {
  name: string;
  hex: string;
  secondary?: string;
}

export interface ColorGroup {
  /** "color" for single-choice products; POÄNG pieces also have separate "cover" and "frame" groups. */
  id: string;
  label: string;
  defaultName: string;
  options: ColorChoice[];
  /** Also offer a free-pick custom color (the room's own bed); retailer products offer only their listed colors. */
  allowCustom?: boolean;
}

const c = (name: string, hex: string, secondary?: string): ColorChoice => (secondary ? { name, hex, secondary } : { name, hex });
const group = (label: string, defaultName: string, options: ColorChoice[], id = "color"): ColorGroup => ({ id, label, defaultName, options });

// Shared palettes
const WHITE = "#f1efe9";
const BLACK = "#232323";
const BLACK_BROWN = "#3b2f2a";
const ANTHRACITE = "#3a3c3f";

const POANG_COVERS = [
  c("Knisa black", "#2a2a2a"), c("Knisa light beige", "#d9cdb4"), c("Vissle deep green", "#2f4a3b"),
  c("Gunnared beige", "#c9b99c"), c("Gunnared blue", "#3e5a80"), c("Gunnared dark gray", "#4b4d50"),
  c("Gunnared light green", "#a3b89a"), c("Hillared anthracite", "#3d3f42"), c("Hillared dark blue", "#243552"),
  c("Kelinge beige", "#cdbb9d"), c("Kelinge dark yellow", "#c8a03a"), c("Kelinge gray-blue", "#6c7e92"),
];
const KIVIK_COVERS = [
  c("Tibbleby beige/gray", "#b8ae9c"), c("Kelinge gray-turquoise", "#5f8a88"), c("Gunnared beige", "#c9b99c"),
  c("Gunnared blue", "#3e5a80"), c("Gunnared light brown-pink", "#c49c8e"), c("Gunnared light green", "#a3b89a"),
  c("Gunnared medium gray", "#8a8b8c"), c("Tresund anthracite", "#3b3d40"), c("Tresund light beige", "#d8ccb6"),
  c("Tallmyra blue", "#35557e"), c("Tallmyra dark green", "#2e4a3a"), c("Tallmyra light green", "#a6bd9d"),
  c("Tallmyra white/black", "#e7e5df", "#2a2a2a"),
];

export const shortlistColors: Record<string, ColorGroup[]> = {
  // Chairs
  "markus": [group("Cover", "Vissle dark gray", [c("Vissle dark gray", "#4a4c4f"), c("Vissle light gray", "#b9babb")], "color")],
  "millberget": [group("Color", "Murum black", [c("Murum beige", "#cdb99a"), c("Murum black", "#242424")])],
  "poang-chair": [
    group("Cover", "Knisa light beige", POANG_COVERS, "cover"),
    group("Frame", "Birch veneer", [c("Birch veneer", "#d8b98f"), c("Brown", "#6a4a35"), c("Dark green", "#2f4a3a"), c("Walnut effect", "#6b4a33")], "frame"),
  ],
  "flintan": [group("Color", "Beige", [c("Beige", "#cfc0a3"), c("Black", BLACK)])],
  "renberget": [group("Color", "Bomstad black", [c("Bomstad black", "#262626")])],
  "loberget-malskar": [group("Color", "White", [c("White", WHITE, WHITE), c("White/black", WHITE, BLACK)])],

  // Couches
  "glostad": [group("Cover", "Knisa dark gray", [c("Knisa dark gray", "#4a4c4f")])],
  "kivik-sofa": [group("Cover", "Tibbleby beige/gray", KIVIK_COVERS)],
  "friheten-klagshamn": [group("Cover", "Faringe light gray", [c("Faringe brown-orange", "#a8643b"), c("Faringe light gray", "#b9b9b6"), c("Skiftebo dark gray", "#4a4b4d")])],
  "klippan": [group("Cover", "Grimsmåla black/beige", [
    c("Vissle gray", "#8d8f90"), c("Vissle green", "#5d7a5a"), c("Grimsmåla black/beige", "#3a3632", "#cbbb9c"),
    c("Tingetorp yellow/white/floral pattern", "#e2c867", "#f3efe4"), c("Långban bright yellow", "#f0c419"),
  ])],
  "uppland": [group("Cover", "Blekinge white", [
    c("Hakebo dark gray", "#4b4d50"), c("Hakebo gray/green", "#7b8a7c"), c("Blekinge white", "#eeece5"),
    c("Kilanda dark blue", "#26344f"), c("Kilanda light beige", "#dccfb8"), c("Karlshov gray-beige", "#a89f8f"),
    c("Kelinge anthracite", "#3c3e41"), c("Kelinge beige", "#cdbb9d"), c("Kelinge gray-turquoise", "#5f8a88"),
    c("Kelinge rust", "#9b4a2c"), c("Hillared anthracite", "#3d3f42"), c("Hillared beige", "#c7b699"), c("Hillared dark blue", "#243552"),
  ])],

  // Desks (primary = top/body, secondary = legs or drawer units)
  "micke": [group("Color", "White", [c("White/anthracite", WHITE, ANTHRACITE), c("Black-brown", BLACK_BROWN), c("White", WHITE)])],
  "linnmon-adils": [group("Color", "White", [c("Black-brown", BLACK_BROWN), c("Black-brown/white", BLACK_BROWN, WHITE), c("White", WHITE), c("White/black", WHITE, BLACK)])],
  "lagkapten-alex": [group("Color", "White", [
    c("Black-brown/white", BLACK_BROWN, WHITE), c("White", WHITE), c("Black-brown", BLACK_BROWN),
    c("White/black-brown", WHITE, BLACK_BROWN), c("Gray/wood effect", "#8b8a86", "#b99468"),
  ])],
  "torald": [group("Color", "White", [c("White", WHITE)])],
  "lagkapten-adils": [group("Color", "White", [
    c("Black-brown/black", BLACK_BROWN, BLACK), c("Black-brown/white", BLACK_BROWN, WHITE), c("White", WHITE),
    c("White/black", WHITE, BLACK), c("Gray/wood effect black", "#8b8a86", BLACK),
  ])],

  // Wardrobes (BRIMNES: the sheet notes a black version sold as a separate listing)
  "brimnes-wardrobe-3": [group("Color", "White", [c("White", WHITE), c("Black", BLACK)])],
  "kleppstad-wardrobe-3": [group("Color", "White", [c("White", WHITE)])],
  "brimnes-wardrobe-2": [group("Color", "White", [c("White", WHITE), c("Black", BLACK)])],
  "kleppstad-wardrobe-2": [group("Color", "White", [c("White", WHITE)])],
  "hauga-wardrobe": [group("Color", "White", [c("Gray", "#8f918f"), c("White", WHITE)])],

  // Laundry hampers
  "klunka": [group("Color", "White/black", [c("White/black", WHITE, BLACK)])],
  "jall": [group("Color", "White", [c("White", WHITE)])],
  "torkis": [group("Color", "Green", [c("Green", "#5f8f4e"), c("Pale blue", "#a9c6d8"), c("Pink", "#e8a9b8"), c("Yellow", "#e9c745")])],
  "purrpingla": [group("Color", "Beige", [c("Beige", "#cdbf9f")])],
  "fyllen": [group("Color", "White", [c("White", WHITE)])],

  // Bean bags (Amazon color names)
  "hobestluk-velvet": [group("Color", "Blue", [
    c("Blue", "#2e4f8f"), c("Lime", "#9cc53f"), c("Black", BLACK), c("Grey", "#8a8a8a"), c("Mustard", "#d4a02a"),
    c("Pink", "#e3a6b4"), c("Purple", "#6d4c8f"), c("Khaki", "#b5a27a"), c("Red", "#b3261e"),
  ])],
  "kisoy-faux-fur": [group("Color", "Grey", [c("Grey", "#9a9a9a"), c("Black", BLACK), c("Blue", "#3f6fa8"), c("Dark Green", "#2f4a3a"), c("Dusty Pink", "#d4a5a5")])],
  "maxyoyo-foam": [group("Color", "Pink", [c("Pink", "#e8a6b6"), c("Beige", "#cfbf9f"), c("Black", BLACK), c("Dark Grey", "#4a4c4f"), c("Navy", "#1f2a44")])],
  "hobestluk-lounger": [group("Color", "Grey", [
    c("Grey", "#8a8a8a"), c("Beige Plush", "#d4c2a4"), c("Charcoal Grey", "#3f4144"), c("Coal Black", "#1f1f1f"),
    c("Darkgrey Plush", "#555759"), c("Light Pink Plush", "#efc4cc"), c("Pink", "#e3a6b4"), c("Rice White", "#efece2"),
    c("Snow White", "#f7f7f5"), c("Soft Pink", "#eac1c7"), c("Tan", "#c19a6b"), c("Black", BLACK), c("Bluegrey", "#6c7a89"),
    c("Camel", "#b8864b"), c("Caramel", "#af6e2d"), c("Darkgrey", "#505255"), c("Khaki", "#b5a27a"), c("Light Brown", "#a07855"),
    c("Light Grey", "#c8c8c8"), c("Light Pink", "#f1c9d0"), c("Mint Green", "#a8d5ba"), c("Olive Green", "#6b7a3a"),
    c("Purple", "#6d4c8f"), c("Rose Pink", "#e39aa9"), c("White", "#f4f3ef"),
  ])],
  "hobestluk-convertible": [group("Color", "Dark Grey", [
    c("Dark Grey", "#4a4c4f"), c("Ash Grey", "#b2b5b2"), c("Charcoal Grey", "#3f4144"), c("Cloud Grey", "#c9ccce"),
    c("Coal Black", "#1f1f1f"), c("Cream", "#efe6cf"), c("Daisy White", "#f5f3ea"), c("Dark Slate Grey", "#2f4f4f"),
    c("Deep Grey", "#4b4b4d"), c("Eider White", "#e8e4d8"), c("Grey", "#8a8a8a"), c("Jet Grey", "#3a3a3c"),
    c("Lead Grey", "#5e6266"), c("Muted Grey", "#8f8f8c"), c("Peach Pink", "#f0b7a4"), c("Pink", "#e3a6b4"),
    c("Purple", "#6d4c8f"), c("Rice White", "#efece2"), c("Rose Pink", "#e39aa9"), c("Shadow Grey", "#6b6b6b"),
    c("Snow White", "#f7f7f5"), c("Soft Grey", "#b8b8b5"), c("Soft Pink", "#eac1c7"), c("Turquoise Grey", "#6f9a9a"),
    c("White", "#f4f3ef"), c("Chevron Black", "#262626", "#e8e8e8"), c("Cloud White", "#f2f2ee"), c("Khaki", "#b5a27a"),
    c("Light Grey", "#c8c8c8"), c("Pastel Pink", "#f4c2c2"), c("Strawberry Pink", "#f28ba0"),
  ])],
  "big-joe-classic": [group("Color", "Sapphire", [
    c("Sapphire", "#1f4e8c"), c("Grey", "#8a8a8a"), c("Jellybean Jam", "#c2417a", "#f2c53a"), c("Mini Clouds Oat", "#d8cfbf", "#ffffff"),
    c("Natural Taupe", "#8b7d6b"), c("Navy", "#1f2a44"), c("Ocean Slate", "#4f6d7a"), c("Petal Pip, Lilac", "#c8a2c8"),
    c("Radiant Orchid", "#b55a9b"), c("Red", "#b3261e"), c("Spicy Lime", "#a5c63b"), c("Stretch Limo Black", "#1c1c1c"),
    c("Vibrant Green", "#3aa55a"), c("Cosmo Blue", "#2d5da8"), c("Buttercup", "#f2d15c"), c("Scatter Jax, Matcha", "#9bb36a", "#f4f1e6"),
    c("Avocado", "#6b8e23", "#c9b36a"), c("Baseball", "#f2f0ea", "#c8323a"), c("Basketball", "#e0772e", "#1f1f1f"),
    c("Blueberry", "#3b4f9a", "#6fae4f"), c("Football", "#7a4a2a", "#f2f0ea"), c("Pineapple", "#f2c53a", "#5e8f3a"),
    c("Soccer Ball", "#f0f0f0", "#1f1f1f"), c("Strawberry", "#d8394a", "#4f8f3a"),
  ])],

  // Ottomans
  "kjuge": [group("Cover", "Knisa dark gray", [c("Knisa dark gray", "#4a4c4f"), c("Vissle deep green", "#2f4a3b"), c("Öreryd gray-beige", "#a89f8f")])],
  "gamlehult": [group("Color", "Rattan / anthracite", [c("Rattan / anthracite", "#b08a5a", ANTHRACITE)])],
  "oskarshamn": [group("Cover", "Gunnared black-gray", [c("Tibbleby beige/gray", "#b8ae9c"), c("Gunnared black-gray", "#3c3d3f"), c("Tonerud red", "#a8322d")])],
  "poang-ottoman": [
    group("Cover", "Knisa light beige", POANG_COVERS, "cover"),
    group("Frame", "Birch veneer", [c("Birch veneer", "#d8b98f"), c("Black-brown", BLACK_BROWN), c("Dark green", "#2f4a3a"), c("Walnut effect", "#6b4a33")], "frame"),
  ],
  "kivik-ottoman": [group("Cover", "Tibbleby beige/gray", KIVIK_COVERS)],

  // Dressers (secondary = drawer fronts where they differ)
  "brimnes-dresser": [group("Color", "Black", [c("Black", BLACK), c("Gray/frosted glass", "#8d8f90", "#d6e2e4"), c("White", WHITE)])],
  "storklinta-6": [group("Color", "White/anchor/unlock function", [
    c("White/anchor/unlock function", WHITE), c("Dark-brown/oak effect anchor/unlock function", "#4a3526"), c("Oak effect/anchor/unlock function", "#b99468"),
  ])],
  "storemolla-8": [group("Color", "Gray-brown stained", [c("Gray-brown stained", "#7d6a5a"), c("Light grey-beige stained", "#bfb3a2")])],
  "storklinta-3": [group("Color", "White/anchor/unlock function", [
    c("Gray/green/anchor/unlock function", "#7f8f84"), c("White/anchor/unlock function", WHITE),
    c("Dark-brown/oak effect anchor/unlock function", "#4a3526"), c("Oak effect/anchor/unlock function", "#b99468"),
  ])],
  "hemnes-8": [group("Color", "White stain", [c("Black-brown", BLACK_BROWN), c("White stain", "#eeeae0")])],

  // Lamps (primary = base/stand, secondary = shade)
  "arstid": [group("Color", "Nickel plated/white", [c("Brass/white", "#b08d57", "#f4f1e8"), c("Nickel plated/white", "#b8b9ba", "#f4f1e8")])],
  "tarnaby": [group("Color", "Dimmable anthracite", [c("Dimmable anthracite", "#3a3c3f"), c("Dimmable beige", "#d6c6a8"), c("Dimmable dark yellow", "#c9a13b")])],
  "lersta": [group("Color", "Aluminum chrome effect", [c("Aluminum chrome effect", "#c9cccf")])],
  "lauters": [group("Color", "Ash/white", [c("Ash/white", "#cdb48e", "#f4f1e8"), c("Brown ash/white", "#7a5a40", "#f4f1e8")])],
  "barlast": [group("Color", "Black/white", [c("Black/white", BLACK, "#f4f1e8")])],
  "fado": [group("Color", "White", [c("White", "#f6f4ee")])],

  // Mirrors (color = frame)
  "nissedal": [group("Color", "Black", [c("Black", BLACK), c("White", WHITE)])],
  "lindbyn": [group("Color", "Black", [c("Black", BLACK), c("Gold", "#c8a24a")])],
  "stockholm-mirror": [group("Color", "Walnut veneer", [c("Walnut veneer", "#6b4a33")])],
  "hovet": [group("Color", "Oak effect/brown", [c("Aluminum", "#c0c4c8"), c("Black", BLACK), c("Gold", "#c8a24a"), c("Oak effect/brown", "#9c7a55")])],
  "karmsund": [group("Color", "Black", [c("Black", BLACK)])],

  // Mini fridges (Amazon color names; Upstreman's black is from the sheet, the page lists the others)
  "frigidaire-efmis171": [group("Color", "White", [
    c("White", "#f3f2ee"), c("Green", "#9fd3b0"), c("Pink", "#f2b8c6"), c("Red", "#c8323a"), c("SkyBlu", "#8ecae6"),
    c("Black", BLACK), c("Blue", "#3f6fb5"), c("Grey", "#9a9a9a"), c("MOONLIGHT", "#c9d3e0"),
  ])],
  "crownful-4l": [group("Color", "White", [c("White", "#f3f2ee"), c("Black", BLACK), c("Green", "#7cbf8e"), c("Orange", "#f0913a"), c("Pink", "#f2b8c6"), c("Purple", "#a58ad1"), c("Blue", "#6fa8dc")])],
  "cooluli-4l": [group("Color", "Black", [c("Black", BLACK), c("Blue", "#5b8fd6"), c("Cow Print", "#f5f5f5", "#1f1f1f"), c("White", "#f3f2ee"), c("Pink", "#f2b8c6"), c("Fuchsia", "#d6337f")])],
  "igloo-32": [group("Color", "Black", [c("Black", BLACK), c("Coke Black", "#1a1a1a", "#d0202f"), c("Platinum", "#c9cbcc"), c("White", "#f3f2ee"), c("Coke Red", "#d0202f", "#f3f2ee"), c("Stainless", "#b8bcbf")])],
  "frigidaire-10l": [group("Color", "BLACK STAINLESS", [c("BLACK STAINLESS", "#3a3b3d"), c("STAINLESS", "#b8bcbf")])],
  "upstreman-32": [group("Color", "Black", [c("Black", BLACK), c("Baby Blue", "#a7c7e7"), c("Cameo Pink", "#efbbcc"), c("Mint Green", "#a8e0c8"), c("Snow White", "#f7f7f5"), c("Stainless Steel", "#b4b8bb")])],
};

// The bed that comes with the room: a wood frame by default, with bedding on top. Both also take a custom color.
export const bedColorGroups: ColorGroup[] = [
  {
    id: "frame", label: "Frame", defaultName: "Natural oak", allowCustom: true, options: [
      c("Natural oak", "#b98a5a"), c("Light maple", "#d8b98c"), c("Honey pine", "#c9955a"), c("Cherry", "#8a4b2e"),
      c("Walnut", "#5d4030"), c("Espresso", "#3a2a22"), c("White", WHITE), c("Gray", "#8d8c8a"), c("Black", BLACK),
    ],
  },
  {
    id: "bedding", label: "Bedding", defaultName: "White", allowCustom: true, options: [
      c("White", "#f4f2ee"), c("Light gray", "#c9c9c7"), c("Charcoal", "#46484b"), c("Navy", "#2f3e5c"), c("Sky blue", "#a9c5dd"),
      c("Sage", "#9aab94"), c("Blush", "#e5b9b3"), c("Mustard", "#d4a73c"), c("Burgundy", "#6e2635"),
    ],
  },
];

/** Shortlist row id for a product id like "shortlist-markus". */
export const shortlistKey = (productId: string) => productId.replace(/^shortlist-/, "");

export function colorGroupsFor(product: Product): ColorGroup[] {
  if (product.id.startsWith("room-bed-")) return bedColorGroups;
  return shortlistColors[shortlistKey(product.id)] ?? [];
}

export const isCustomColor = (value: string | undefined): value is string => Boolean(value && /^#[0-9a-f]{6}$/i.test(value));

/**
 * Chosen option for one group, falling back to the product's listed color. Custom colors apply only
 * to groups that allow them or have no retailer options (imported products); other products ignore them.
 */
export function selectedChoice(group: ColorGroup, value: string | undefined): ColorChoice {
  if (isCustomColor(value) && (group.allowCustom || !group.options.length)) return { name: `Custom ${value.toLowerCase()}`, hex: value.toLowerCase() };
  return group.options.find((option) => option.name === value) ?? group.options.find((option) => option.name === group.defaultName) ?? group.options[0];
}

/** Human-readable color of an item, e.g. "Knisa black / Walnut effect" or "Custom #aabbcc". */
export function describeColor(product: Product, selection: Item["colorSelection"]): string {
  const groups = colorGroupsFor(product);
  if (!groups.length) return isCustomColor(selection?.color) ? `Custom ${selection.color}` : product.variant;
  return groups.map((colorGroup) => selectedChoice(colorGroup, selection?.[colorGroup.id]).name).join(" / ");
}
