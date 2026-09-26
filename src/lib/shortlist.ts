import type { Dimensions, Product } from "./types";

type ShortlistRow = readonly [
  id: string,
  category: string,
  store: "IKEA US" | "Amazon",
  name: string,
  description: string,
  price: number,
  widthIn: number,
  depthIn: number,
  heightIn: number,
  color: string,
  url: string,
  note?: string,
];

// Curated from the user-provided room-furnishing shortlist. Width/depth/height
// use the listed maximum assembled dimensions. A small depth is estimated for
// wall mirrors because the source sheet supplies only face dimensions.
const rows: ShortlistRow[] = [
  ["markus", "chair", "IKEA US", "MARKUS", "Office chair, high mesh back", 299.99, 24.375, 23.625, 55.125, "Vissle dark gray", "https://www.ikea.com/us/en/p/markus-office-chair-vissle-dark-gray-90289172/"],
  ["millberget", "chair", "IKEA US", "MILLBERGET", "Swivel chair, padded arms", 129.99, 27.5, 27.5, 48.375, "Murum black", "https://www.ikea.com/us/en/p/millberget-swivel-chair-murum-black-00489397/"],
  ["poang-chair", "chair", "IKEA US", "POÄNG armchair", "Bentwood armchair", 149, 26.75, 32.25, 39.375, "Birch veneer / Knisa light beige", "https://www.ikea.com/us/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s59305928/"],
  ["flintan", "chair", "IKEA US", "FLINTAN", "Office chair, mesh back", 99.99, 28, 28, 44.875, "Beige", "https://www.ikea.com/us/en/p/flintan-office-chair-beige-00492205/"],
  ["renberget", "chair", "IKEA US", "RENBERGET", "Swivel chair, adjustable arms", 99.99, 26.375, 26.375, 43.75, "Bomstad black", "https://www.ikea.com/us/en/p/renberget-swivel-chair-bomstad-black-40611094/"],
  ["loberget-malskar", "chair", "IKEA US", "LOBERGET / MALSKÄR", "Swivel chair, molded shell", 59.99, 26.375, 26.375, 35.375, "White", "https://www.ikea.com/us/en/p/loberget-malskaer-swivel-chair-white-s19445469/"],
  ["glostad", "couch", "IKEA US", "GLOSTAD", "Loveseat", 169, 47.625, 30.75, 26.75, "Knisa dark gray", "https://www.ikea.com/us/en/p/glostad-loveseat-knisa-dark-gray-70489011/"],
  ["kivik-sofa", "couch", "IKEA US", "KIVIK sofa", "3-seat sofa, washable cover", 799, 89.75, 37.375, 32.625, "Tibbleby beige/gray", "https://www.ikea.com/us/en/p/kivik-sofa-tibbleby-beige-gray-s39440593/"],
  ["friheten-klagshamn", "couch", "IKEA US", "FRIHETEN / KLAGSHAMN", "Sleeper sectional with storage", 1099, 90.5, 59.5, 33.875, "Faringe light gray", "https://www.ikea.com/us/en/p/friheten-klagshamn-sleeper-sectional-3-seat-w-storage-faringe-light-gray-s49520240/"],
  ["klippan", "couch", "IKEA US", "KLIPPAN", "Loveseat, cotton cover", 379, 70.875, 34.625, 26, "Grimsmåla black/beige", "https://www.ikea.com/us/en/p/klippan-loveseat-grimsmala-black-beige-s19654127/"],
  ["uppland", "couch", "IKEA US", "UPPLAND", "3-seat sofa, rolled arms", 899, 88.25, 36.25, 36.25, "Blekinge white", "https://www.ikea.com/us/en/p/uppland-sofa-blekinge-white-s19384116/"],
  ["micke", "desk", "IKEA US", "MICKE", "Desk with drawer and cabinet", 109.99, 41.375, 19.625, 29.5, "White", "https://www.ikea.com/us/en/p/micke-desk-white-80213074/"],
  ["linnmon-adils", "desk", "IKEA US", "LINNMON / ADILS", "Table / simple desk", 49.99, 39.375, 23.625, 29.125, "White", "https://www.ikea.com/us/en/p/linnmon-adils-table-white-s29932181/"],
  ["lagkapten-alex", "desk", "IKEA US", "LAGKAPTEN / ALEX", "Desk on two drawer units", 239.99, 55.125, 23.625, 28.75, "White", "https://www.ikea.com/us/en/p/lagkapten-alex-desk-white-s99431982/"],
  ["torald", "desk", "IKEA US", "TORALD", "Compact desk", 29.99, 25.625, 15.75, 29.5, "White", "https://www.ikea.com/us/en/p/torald-desk-white-90493955/"],
  ["lagkapten-adils", "desk", "IKEA US", "LAGKAPTEN / ADILS", "Desk, tabletop and legs", 79.99, 55.125, 23.625, 28.75, "White", "https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-s59417153/"],
  ["brimnes-wardrobe-3", "wardrobe", "IKEA US", "BRIMNES 3-door wardrobe", "Wardrobe, 3 doors (1 mirror)", 249.99, 46, 19.75, 74.75, "White", "https://www.ikea.com/us/en/p/brimnes-wardrobe-with-3-doors-white-90574800/"],
  ["kleppstad-wardrobe-3", "wardrobe", "IKEA US", "KLEPPSTAD 3-door wardrobe", "Wardrobe, 3 doors", 199.99, 46.125, 21.625, 69.25, "White", "https://www.ikea.com/us/en/p/kleppstad-wardrobe-with-3-doors-white-20441757/"],
  ["brimnes-wardrobe-2", "wardrobe", "IKEA US", "BRIMNES 2-door wardrobe", "Wardrobe, 2 doors", 199.99, 30.75, 19.625, 74.75, "White", "https://www.ikea.com/us/en/p/brimnes-wardrobe-with-2-doors-white-30574799/"],
  ["kleppstad-wardrobe-2", "wardrobe", "IKEA US", "KLEPPSTAD 2-door wardrobe", "Wardrobe, 2 doors", 149.99, 31.25, 21.625, 69.25, "White", "https://www.ikea.com/us/en/p/kleppstad-wardrobe-with-2-doors-white-90586803/"],
  ["hauga-wardrobe", "wardrobe", "IKEA US", "HAUGA wardrobe", "Wardrobe, sliding doors", 299.99, 46.5, 21.625, 78.375, "White", "https://www.ikea.com/us/en/p/hauga-wardrobe-with-sliding-doors-white-60456916/"],
  ["klunka", "laundry hamper", "IKEA US", "KLUNKA", "Laundry bag, 16 gal", 16.99, 14.25, 14.25, 23.5, "White/black", "https://www.ikea.com/us/en/p/klunka-laundry-bag-white-black-10364373/"],
  ["jall", "laundry hamper", "IKEA US", "JÄLL", "Laundry bag with stand, 13 gal", 5.99, 17, 16.5, 23.5, "White", "https://www.ikea.com/us/en/p/jaell-laundry-bag-with-stand-white-30553607/"],
  ["torkis", "laundry hamper", "IKEA US", "TORKIS", "Flexible laundry basket, 9 gal", 9.99, 24.5, 16, 10.75, "Green", "https://www.ikea.com/us/en/p/torkis-flexible-laundry-basket-in-outdoor-green-20579165/", "Source lists length and height only; depth is estimated for placement."],
  ["purrpingla", "laundry hamper", "IKEA US", "PURRPINGLA", "Laundry bag, 26 gal", 24.99, 18.5, 14.5, 22.75, "Beige", "https://www.ikea.com/us/en/p/purrpingla-laundry-bag-beige-20614239/"],
  ["fyllen", "laundry hamper", "IKEA US", "FYLLEN", "Collapsible laundry basket, 21 gal", 12.99, 17.75, 17.75, 19.75, "White", "https://www.ikea.com/us/en/p/fyllen-laundry-basket-white-60522049/"],
  ["hobestluk-velvet", "bean bag", "Amazon", "Hobestluk Velvet Bean Bag Chair, Large", "Large velvet bean bag chair", 72.99, 22, 36, 36, "Blue", "https://www.amazon.com/dp/B0DHNY43MM", "The source sheet flags the listed width as unusually low; verify before purchase."],
  ["kisoy-faux-fur", "bean bag", "Amazon", "Kisoy Faux-Fur Bean Bag Chair, 2.5 ft", "Faux-fur bean bag chair", 39.99, 28, 28, 22, "Grey", "https://www.amazon.com/dp/B0GY5H4CF9"],
  ["maxyoyo-foam", "bean bag", "Amazon", "MAXYOYO Foam-Filled Bean Bag Chair, 3 ft", "Foam-filled bean bag chair", 54.99, 31.5, 31.5, 19.75, "Pink", "https://www.amazon.com/dp/B0H1L672D6"],
  ["hobestluk-lounger", "bean bag", "Amazon", "Hobestluk Large Bean Bag Sofa Lounger", "Bean bag sofa lounger", 95.74, 63, 31.5, 63, "Grey", "https://www.amazon.com/dp/B0DFB81517", "The source sheet flags the listed height as unusually tall; verify before purchase."],
  ["hobestluk-convertible", "bean bag", "Amazon", "Hobestluk 3-in-1 Convertible Bean Bag Sofa", "Convertible bean bag sofa", 88.39, 75.6, 55.1, 19.7, "Dark grey (striped)", "https://www.amazon.com/dp/B0DGFTJ4CX"],
  ["big-joe-classic", "bean bag", "Amazon", "Big Joe Classic Bean Bag Chair", "Classic bean bag chair", 43.99, 27.5, 27.5, 16, "Sapphire", "https://www.amazon.com/dp/B00DQT7B2C"],
  ["kjuge", "ottoman", "IKEA US", "KJUGE", "Pouf with storage", 12.99, 15, 15, 13, "Knisa dark gray", "https://www.ikea.com/us/en/p/kjuge-pouf-with-storage-knisa-dark-gray-30531903/"],
  ["gamlehult", "ottoman", "IKEA US", "GAMLEHULT", "Rattan ottoman with storage", 99.99, 24.375, 24.375, 14.125, "Rattan / anthracite", "https://www.ikea.com/us/en/p/gamlehult-ottoman-with-storage-rattan-anthracite-10434309/"],
  ["oskarshamn", "ottoman", "IKEA US", "OSKARSHAMN", "Ottoman with storage", 200, 15.75, 22.5, 16.5, "Gunnared black-gray", "https://www.ikea.com/us/en/p/oskarshamn-ottoman-with-storage-gunnared-black-gray-70521676/"],
  ["poang-ottoman", "ottoman", "IKEA US", "POÄNG ottoman", "Ottoman matching the POÄNG armchair", 80, 26.75, 21.25, 15.375, "Birch veneer / Knisa light beige", "https://www.ikea.com/us/en/p/poaeng-ottoman-birch-veneer-knisa-light-beige-s19305954/"],
  ["kivik-ottoman", "ottoman", "IKEA US", "KIVIK ottoman", "Ottoman with storage", 299, 35.375, 27.5, 16.875, "Tibbleby beige/gray", "https://www.ikea.com/us/en/p/kivik-ottoman-with-storage-tibbleby-beige-gray-s89440500/"],
  ["brimnes-dresser", "dresser", "IKEA US", "BRIMNES 4-drawer dresser", "4-drawer dresser", 229.99, 30.75, 18.125, 48.875, "Black", "https://www.ikea.com/us/en/p/brimnes-4-drawer-dresser-black-70574245/"],
  ["storklinta-6", "dresser", "IKEA US", "STORKLINTA 6-drawer dresser", "Wide 6-drawer dresser", 249.99, 55.125, 18.875, 29.5, "White", "https://www.ikea.com/us/en/p/storklinta-6-drawer-dresser-white-anchor-unlock-function-60561248/"],
  ["storemolla-8", "dresser", "IKEA US", "STOREMOLLA 8-drawer dresser", "8-drawer dresser, solid pine", 649.99, 67.375, 19.625, 35.875, "Gray-brown stained", "https://www.ikea.com/us/en/p/storemolla-8-drawer-dresser-gray-brown-stained-60522394/"],
  ["storklinta-3", "dresser", "IKEA US", "STORKLINTA 3-drawer dresser", "3-drawer dresser", 129.99, 27.5, 18.875, 29.5, "White", "https://www.ikea.com/us/en/p/storklinta-3-drawer-dresser-white-anchor-unlock-function-00559291/"],
  ["hemnes-8", "dresser", "IKEA US", "HEMNES 8-drawer dresser", "8-drawer dresser, solid wood", 449.99, 63, 19.625, 37.75, "White stain", "https://www.ikea.com/us/en/p/hemnes-8-drawer-dresser-white-stain-10576191/"],
  ["arstid", "lamp", "IKEA US", "ÅRSTID", "Table lamp, fabric shade", 39.99, 9, 9, 22, "Nickel-plated / white", "https://www.ikea.com/us/en/p/arstid-table-lamp-nickel-plated-white-60280639/"],
  ["tarnaby", "lamp", "IKEA US", "TÄRNABY", "Table lamp, dimmable", 34.99, 6, 6, 10, "Anthracite", "https://www.ikea.com/us/en/p/taernaby-table-lamp-dimmable-anthracite-00323887/"],
  ["lersta", "lamp", "IKEA US", "LERSTA", "Floor / reading lamp", 22.99, 10, 10, 52, "Aluminum chrome effect", "https://www.ikea.com/us/en/p/lersta-floor-reading-lamp-aluminum-chrome-effect-20110903/"],
  ["lauters", "lamp", "IKEA US", "LAUTERS", "Floor lamp, adjustable height", 79.99, 15, 15, 59, "Ash / white", "https://www.ikea.com/us/en/p/lauters-floor-lamp-ash-white-00405048/"],
  ["barlast", "lamp", "IKEA US", "BARLAST", "Floor lamp", 9.99, 12, 12, 59, "Black / white", "https://www.ikea.com/us/en/p/barlast-floor-lamp-black-white-70437814/"],
  ["fado", "lamp", "IKEA US", "FADO", "Globe table lamp", 29.99, 10, 10, 9, "White", "https://www.ikea.com/us/en/p/fado-table-lamp-white-70096377/"],
  ["nissedal", "mirror", "IKEA US", "NISSEDAL", "Wall mirror", 99.99, 25.625, 1.5, 59, "Black", "https://www.ikea.com/us/en/p/nissedal-mirror-black-50503777/", "Depth is estimated for room placement; verify mounting clearance."],
  ["lindbyn", "mirror", "IKEA US", "LINDBYN", "Round wall mirror", 79.99, 31.5, 1.5, 31.5, "Black", "https://www.ikea.com/us/en/p/lindbyn-mirror-black-60507204/", "Depth is estimated for room placement; verify mounting clearance."],
  ["stockholm-mirror", "mirror", "IKEA US", "STOCKHOLM mirror", "Round wall mirror", 179.99, 31.5, 1.5, 31.5, "Walnut veneer", "https://www.ikea.com/us/en/p/stockholm-mirror-walnut-veneer-20503793/", "Depth is estimated for room placement; verify mounting clearance."],
  ["hovet", "mirror", "IKEA US", "HOVET", "Full-length mirror", 169.99, 30.75, 1.5, 77.125, "Oak effect / brown", "https://www.ikea.com/us/en/p/hovet-mirror-oak-effect-brown-00625601/", "Depth is estimated for room placement; verify mounting clearance."],
  ["karmsund", "mirror", "IKEA US", "KARMSUND", "Standing mirror", 99.99, 15.75, 18, 65.75, "Black", "https://www.ikea.com/us/en/p/karmsund-floor-mirror-black-40294982/", "Stand depth is estimated for room placement."],
  ["frigidaire-efmis171", "mini fridge", "Amazon", "Frigidaire EFMIS171 Retro Mini Fridge", "Personal fridge, 6-can", 29.99, 7, 10, 10, "White", "https://www.amazon.com/dp/B0FTGGXMMB"],
  ["crownful-4l", "mini fridge", "Amazon", "CROWNFUL Mini Fridge, 4 L", "Personal fridge, 6-can, cools and warms", 44.98, 6.1, 5.3, 8, "White", "https://www.amazon.com/dp/B087Z2MLN2", "The source sheet flags these dimensions as unusually small; verify before purchase."],
  ["cooluli-4l", "mini fridge", "Amazon", "Cooluli Mini Fridge, 4 L", "Personal fridge, 6-can, cools and warms", 55.08, 10.2, 7.7, 10.5, "Black", "https://www.amazon.com/dp/B0771S9XT8"],
  ["igloo-32", "mini fridge", "Amazon", "Igloo 3.2 cu ft Mini Fridge with Freezer", "Dorm-size, single door", 159.99, 17.1, 18.6, 32.5, "Black", "https://www.amazon.com/dp/B0CCF8CY8B"],
  ["frigidaire-10l", "mini fridge", "Amazon", "Frigidaire Mini Personal Fridge, 10 L", "Countertop, 15-can", 54.97, 15, 11, 16, "Black stainless", "https://www.amazon.com/dp/B0CVBHKC52"],
  ["upstreman-32", "mini fridge", "Amazon", "Upstreman 3.2 cu ft Mini Fridge with Freezer", "Dorm-size, model BR321", 159.99, 18.7, 17.4, 33.1, "Black", "https://www.amazon.com/dp/B09RWFZTWW"],
];

const inchesToMeters = (inches: number) => Number((inches * 0.0254).toFixed(4));

function dimensions(width: number, depth: number, height: number): Dimensions {
  return { width: inchesToMeters(width), depth: inchesToMeters(depth), height: inchesToMeters(height) };
}

export const shortlistProducts: Product[] = rows.map(([id, category, store, name, description, amount, width, depth, height, color, sourceURL, note]) => ({
  id: `shortlist-${id}`,
  name,
  store,
  sourceURL,
  retailer: store === "Amazon" ? "amazon" : "ikea",
  category,
  variant: color,
  dimensions: dimensions(width, depth, height),
  price: { amount: Math.round(amount * 100), currency: "USD", observedAt: "2026-09-26T00:00:00.000Z", confirmed: false },
  fieldEvidence: {
    dimensions: { source: "demo_fixture", confidence: note ? 0.65 : 0.9, confirmedByUser: false, note: note ?? "Imported from the supplied furnishing shortlist; verify retailer details before purchase." },
    price: { source: "demo_fixture", confidence: 0.8, confirmedByUser: false, note: "Shortlist price; retailer pricing may change." },
  },
  tags: [category, description.toLowerCase(), "shortlist"],
}));

export function mergeShortlistProducts(products: Product[]): Product[] {
  const existing = new Set(products.map((product) => product.id));
  return [...products, ...shortlistProducts.filter((product) => !existing.has(product.id))];
}
