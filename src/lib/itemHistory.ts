import type { Item, Project } from "./types";

// Undo/redo for edits made in the 3D Studio. Each entry records only the item fields the edit
// changed (e.g. transform, locked, colorSelection), with their values before and after, so undoing
// a move never reverts unrelated changes made elsewhere since (a new bed size, a Better Cart swap,
// a cart status change). History lives in memory per project; it is not saved with the project.

export type ItemPatch = Partial<Pick<Item, "transform" | "locked" | "colorSelection">>;

export interface ItemEdit {
  itemId: string;
  /** What the edit did, e.g. "Move", "Rotate", "Lock"; shown as "Undo move MARKUS". */
  label: string;
  before: ItemPatch;
  after: ItemPatch;
  /** Milliseconds timestamp of the latest change folded into this entry. */
  at: number;
  /** Came from a typed value, so further keystrokes may fold into it. */
  typed?: boolean;
}

export interface ItemHistory {
  past: ItemEdit[];
  future: ItemEdit[];
}

export const emptyHistory: ItemHistory = { past: [], future: [] };

/** Oldest entries are dropped past this many undo steps. */
export const HISTORY_LIMIT = 100;
/** Typed edits of the same kind to the same item within this window (typing "2.45" into X) undo as one step. */
export const COALESCE_MS = 1200;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Applies a patch to one item the way every Studio edit does: bumps the cart version and marks a proposal stale. */
export function applyItemPatch(project: Project, itemId: string, patch: ItemPatch): Project {
  return {
    ...project,
    items: project.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
    cartVersion: project.cartVersion + 1,
    proposal: project.proposal ? { ...project.proposal, stale: true } : null,
  };
}

/** Human label for a Studio edit, from the fields it changes. */
export function editLabel(item: Item, patch: ItemPatch): string {
  if ("locked" in patch) return patch.locked ? "Lock" : "Unlock";
  if ("colorSelection" in patch) return "Color change";
  if ("transform" in patch) {
    const before = item.transform;
    const after = patch.transform;
    if (!after) return "Unplace";
    if (!before) return "Place";
    if (before.rotationZ !== after.rotationZ) return "Rotate";
    if ((before.elevation ?? 0) !== (after.elevation ?? 0) && same(before.position, after.position)) return "Lift";
    return "Move";
  }
  return "Edit";
}

/**
 * Records an edit about to be applied to `project`. No-op edits are ignored and a new edit clears
 * redo. With `coalesce` (typed values, which change on every keystroke), a quick follow-up of the
 * same kind on the same item extends the previous typed entry instead of adding a step.
 */
export function recordEdit(history: ItemHistory, project: Project, itemId: string, patch: ItemPatch, now = Date.now(), coalesce = false): ItemHistory {
  const item = project.items.find((candidate) => candidate.id === itemId);
  if (!item) return history;
  const keys = Object.keys(patch) as (keyof ItemPatch)[];
  if (keys.every((key) => same(item[key], patch[key]))) return history;
  const before = Object.fromEntries(keys.map((key) => [key, item[key]])) as ItemPatch;
  const label = editLabel(item, patch);
  const last = history.past[history.past.length - 1];
  if (coalesce && last?.typed && last.itemId === itemId && last.label === label && same(Object.keys(last.after).sort(), [...keys].sort()) && now - last.at < COALESCE_MS) {
    const merged: ItemEdit = { ...last, after: patch, at: now };
    return { past: [...history.past.slice(0, -1), merged], future: [] };
  }
  const past = [...history.past, { itemId, label, before, after: patch, at: now, ...(coalesce ? { typed: true } : {}) }];
  return { past: past.slice(-HISTORY_LIMIT), future: [] };
}

function step(history: ItemHistory, project: Project, direction: "undo" | "redo"): { history: ItemHistory; project: Project } | null {
  const from = direction === "undo" ? [...history.past] : [...history.future];
  const to = direction === "undo" ? [...history.future] : [...history.past];
  // Skip entries whose item has since been removed from the project.
  while (from.length) {
    const edit = from.pop()!;
    if (!project.items.some((item) => item.id === edit.itemId)) continue;
    to.push({ ...edit, typed: false }); // never fold new typing into an edit that was undone or redone
    const next = applyItemPatch(project, edit.itemId, direction === "undo" ? edit.before : edit.after);
    return { project: next, history: direction === "undo" ? { past: from, future: to } : { past: to, future: from } };
  }
  return null;
}

export const undoEdit = (history: ItemHistory, project: Project) => step(history, project, "undo");
export const redoEdit = (history: ItemHistory, project: Project) => step(history, project, "redo");

/** The next entry undo or redo would apply, ignoring ones whose item is gone. */
export function nextEdit(history: ItemHistory, project: Project, direction: "undo" | "redo"): ItemEdit | null {
  const entries = direction === "undo" ? history.past : history.future;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (project.items.some((item) => item.id === entries[index].itemId)) return entries[index];
  }
  return null;
}
