import type { Project } from "./types";

// The group's priorities, ranked. Each one decides a choice Better Cart actually makes, and a
// higher priority wins when two of them pull different ways.

export type PriorityId = "budget" | "keep_picks" | "even_split";

export interface PriorityInfo {
  id: PriorityId;
  label: string;
  /** What Better Cart does differently because of it. */
  effect: string;
}

export const PRIORITIES: PriorityInfo[] = [
  { id: "budget", label: "Stay under budget", effect: "Closes the gap with cheaper catalog equivalents that fit, closest in size first, then defers optional items, biggest savings first." },
  { id: "keep_picks", label: "Keep the products we chose", effect: "Moves items instead of swapping them for other models. Optional items can still wait." },
  { id: "even_split", label: "Keep spending even", effect: "When something has to be cut, it comes from whoever is spending more." },
];

export const DEFAULT_PRIORITIES: PriorityId[] = PRIORITIES.map((priority) => priority.id);

// Free-text priorities saved before the presets existed.
const LEGACY_LABELS: Record<string, PriorityId> = { "stay under budget": "budget" };

export const priorityInfo = (id: PriorityId) => PRIORITIES.find((priority) => priority.id === id)!;

/**
 * Every priority, most important first. Saved entries set the order; unknown entries are ignored
 * and any priority not listed follows in the default order.
 */
export function priorityOrder(project: Project): PriorityId[] {
  const listed = project.priorities
    .map((entry) => DEFAULT_PRIORITIES.includes(entry as PriorityId) ? entry as PriorityId : LEGACY_LABELS[entry.trim().toLowerCase()])
    .filter((id): id is PriorityId => Boolean(id));
  return [...new Set([...listed, ...DEFAULT_PRIORITIES])];
}

export const ranksAbove = (order: PriorityId[], a: PriorityId, b: PriorityId) => order.indexOf(a) < order.indexOf(b);
