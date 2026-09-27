import type { Item, Project } from "./types";

// Required functions: what the room has to provide (a place to sleep, a workspace, ...). Items
// record needs in two vocabularies: functions ("workspace", "seating") and, for items added from a
// store, their category ("desk", "chair"). Both map onto the same canonical needs here.

export type NeedId = "sleeping" | "workspace" | "seating" | "storage" | "room-lighting" | "cold-storage" | "laundry" | "mirror";

export interface NeedInfo {
  id: NeedId;
  label: string;
  /** What to add to cover it, e.g. "a desk". */
  suggestion: string;
  /** Needs and item categories that cover it, lowercase. */
  aliases: string[];
}

export const NEEDS: NeedInfo[] = [
  { id: "sleeping", label: "Sleeping", suggestion: "a bed", aliases: ["sleeping", "sleep", "bed"] },
  { id: "workspace", label: "Workspace", suggestion: "a desk", aliases: ["workspace", "study", "desk"] },
  { id: "seating", label: "Seating", suggestion: "a chair, couch, or bean bag", aliases: ["seating", "chair", "couch", "sofa", "bean bag", "ottoman", "pouf", "stool"] },
  { id: "storage", label: "Storage", suggestion: "a dresser or wardrobe", aliases: ["storage", "dresser", "wardrobe", "closet", "drawers", "shelf", "bookcase"] },
  { id: "room-lighting", label: "Lighting", suggestion: "a lamp", aliases: ["room-lighting", "lighting", "light", "lamp"] },
  { id: "cold-storage", label: "Cold storage", suggestion: "a mini fridge", aliases: ["cold-storage", "mini fridge", "fridge", "refrigerator"] },
  { id: "laundry", label: "Laundry", suggestion: "a laundry hamper", aliases: ["laundry", "laundry hamper", "hamper"] },
  { id: "mirror", label: "Mirror", suggestion: "a mirror", aliases: ["mirror"] },
];

const byAlias = new Map(NEEDS.flatMap((need) => need.aliases.map((alias) => [alias, need.id] as const)));

export const needInfo = (id: NeedId) => NEEDS.find((need) => need.id === id)!;

/** The canonical need for a need or category word, or null if it names none. */
export const needFor = (word: string): NeedId | null => byAlias.get(word.trim().toLowerCase()) ?? null;

/** The room's required needs, in the order added. Words that name no known need are ignored. */
export function requiredNeeds(project: Project): NeedId[] {
  return [...new Set(project.needs.map(needFor).filter((id): id is NeedId => id !== null))];
}

/** Needs an item covers: its own needs plus its product's category. */
export function needsCoveredBy(project: Project, item: Item): Set<NeedId> {
  const category = project.products.find((product) => product.id === item.productId)?.category ?? "";
  return new Set([...item.needsServed, category].map(needFor).filter((id): id is NeedId => id !== null));
}

/** Required needs that no item still in the plan (anything not deferred) covers. */
export function uncoveredRequiredNeeds(project: Project): NeedId[] {
  const covered = new Set(project.items.filter((item) => item.purchaseStatus !== "deferred").flatMap((item) => [...needsCoveredBy(project, item)]));
  return requiredNeeds(project).filter((need) => !covered.has(need));
}
