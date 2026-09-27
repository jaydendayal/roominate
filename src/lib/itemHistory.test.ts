import { describe, expect, it } from "vitest";
import { removeRoomBed, ROOM_BED_ITEM_ID, setRoomBedSize } from "./beds";
import { createDemoProject } from "./demo";
import { applyItemPatch, COALESCE_MS, emptyHistory, HISTORY_LIMIT, nextEdit, recordEdit, recordRemoval, redoEdit, removeItem, undoEdit, type ItemHistory, type ItemPatch } from "./itemHistory";
import type { Project } from "./types";

const item = (project: Project, id: string) => project.items.find((candidate) => candidate.id === id)!;

/** Records and applies an edit the way the Studio does. */
function edit(state: { project: Project; history: ItemHistory }, itemId: string, patch: ItemPatch, at: number, typed = false) {
  return { history: recordEdit(state.history, state.project, itemId, patch, at, typed), project: applyItemPatch(state.project, itemId, patch) };
}

const moveChair = (x: number) => ({ transform: { position: { x, y: 2.05 }, rotationZ: Math.PI } });

describe("3D Studio undo/redo", () => {
  it("undoes and redoes a move", () => {
    const start = { project: createDemoProject(), history: emptyHistory };
    const moved = edit(start, "item-chair", moveChair(2.5), 1000);
    expect(nextEdit(moved.history, moved.project, "undo")?.label).toBe("Move");

    const undone = undoEdit(moved.history, moved.project)!;
    expect(item(undone.project, "item-chair").transform).toEqual(item(start.project, "item-chair").transform);
    expect(undone.history).toMatchObject({ past: [], future: [{ label: "Move" }] });

    const redone = redoEdit(undone.history, undone.project)!;
    expect(item(redone.project, "item-chair").transform!.position.x).toBe(2.5);
    expect(undoEdit(emptyHistory, start.project)).toBeNull();
    expect(redoEdit(redone.history, redone.project)).toBeNull();
  });

  it("walks back through several edits in order and a new edit clears redo", () => {
    let state = { project: createDemoProject(), history: emptyHistory };
    const original = item(state.project, "item-chair");
    state = edit(state, "item-chair", moveChair(2.5), 1000);
    state = edit(state, "item-chair", { transform: { ...item(state.project, "item-chair").transform!, rotationZ: Math.PI * 1.5 } }, 5000);
    state = edit(state, "item-chair", { locked: true }, 9000);
    state = edit(state, "item-desk", { colorSelection: { color: "Black-brown" } }, 13000);
    expect(state.history.past.map((entry) => entry.label)).toEqual(["Move", "Rotate", "Lock", "Color change"]);

    for (let index = 0; index < 4; index += 1) state = { ...state, ...undoEdit(state.history, state.project)! };
    expect(item(state.project, "item-chair")).toEqual(original);
    expect(item(state.project, "item-desk").colorSelection).toBeUndefined();

    state = { ...state, ...redoEdit(state.history, state.project)! };
    expect(item(state.project, "item-chair").transform!.position.x).toBe(2.5);
    state = edit(state, "item-pouf", { transform: null }, 20000);
    expect(state.history.future).toEqual([]);
    expect(state.history.past.map((entry) => entry.label)).toEqual(["Move", "Unplace"]);
  });

  it("merges the keystrokes of a typed coordinate into one step", () => {
    let state = { project: createDemoProject(), history: emptyHistory };
    const original = item(state.project, "item-chair").transform;
    state = edit(state, "item-chair", moveChair(2), 1000, true);
    state = edit(state, "item-chair", moveChair(2.4), 1000 + COALESCE_MS / 2, true);
    state = edit(state, "item-chair", moveChair(2.45), 1000 + COALESCE_MS, true);
    expect(state.history.past).toHaveLength(1);
    expect(item(undoEdit(state.history, state.project)!.project, "item-chair").transform).toEqual(original);
    // After a pause, the next typed change is its own step.
    state = edit(state, "item-chair", moveChair(2.6), 1000 + COALESCE_MS * 3, true);
    expect(state.history.past).toHaveLength(2);
  });

  it("keeps quick clicks (nudges, drags) as separate steps", () => {
    let state = { project: createDemoProject(), history: emptyHistory };
    state = edit(state, "item-chair", moveChair(3.0), 1000);
    state = edit(state, "item-chair", moveChair(3.1), 1100);
    expect(state.history.past).toHaveLength(2);
    // Typing right after a nudge starts a new step rather than folding into the nudge.
    state = edit(state, "item-chair", moveChair(3.2), 1200, true);
    expect(state.history.past).toHaveLength(3);
  });

  it("ignores edits that change nothing and caps the history", () => {
    const project = createDemoProject();
    const same = recordEdit(emptyHistory, project, "item-chair", { transform: item(project, "item-chair").transform });
    expect(same).toBe(emptyHistory);
    let history = emptyHistory;
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) history = recordEdit(history, project, "item-chair", moveChair(index), index * 10_000);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("only reverts the fields the edit changed", () => {
    let state = { project: createDemoProject(), history: emptyHistory };
    state = edit(state, "item-room-bed", { transform: { position: { x: 1.2, y: 2.52 }, rotationZ: Math.PI / 2 } }, 1000);
    // Changed outside the Studio afterwards: the bed size.
    const resized = setRoomBedSize(state.project, ROOM_BED_ITEM_ID, "full");
    const undone = undoEdit(state.history, resized)!;
    expect(item(undone.project, "item-room-bed").productId).toBe("room-bed-full");
    expect(item(undone.project, "item-room-bed").transform!.position.x).toBe(1.09);
  });

  it("skips edits to items that were removed since", () => {
    let state = { project: createDemoProject(), history: emptyHistory };
    state = edit(state, "item-chair", moveChair(2.5), 1000);
    state = edit(state, "item-room-bed", { locked: true }, 5000);
    const noBed = removeRoomBed(state.project, ROOM_BED_ITEM_ID);
    expect(nextEdit(state.history, noBed, "undo")?.itemId).toBe("item-chair");
    const undone = undoEdit(state.history, noBed)!;
    expect(item(undone.project, "item-chair").transform!.position.x).toBe(2.9);
    expect(undone.history.past).toEqual([]);
  });

  it("removes an item, and undo puts it back in its place in the list", () => {
    const project = createDemoProject();
    const index = project.items.findIndex((candidate) => candidate.id === "item-chair");
    const original = item(project, "item-chair");
    const history = recordRemoval(emptyHistory, project, "item-chair", 1000);
    const removed = removeItem(project, "item-chair");
    expect(removed.items.some((candidate) => candidate.id === "item-chair")).toBe(false);
    expect(nextEdit(history, removed, "undo")).toMatchObject({ label: "Remove", itemId: "item-chair" });

    const undone = undoEdit(history, removed)!;
    expect(undone.project.items[index]).toEqual(original);
    const redone = redoEdit(undone.history, undone.project)!;
    expect(redone.project.items.some((candidate) => candidate.id === "item-chair")).toBe(false);
  });

  it("keeps the room's bed setting in step when a bed is removed and restored", () => {
    const project = createDemoProject();
    const history = recordRemoval(emptyHistory, project, ROOM_BED_ITEM_ID);
    const removed = removeItem(project, ROOM_BED_ITEM_ID);
    const undone = undoEdit(history, removed)!.project;
    const bed = item(undone, ROOM_BED_ITEM_ID);
    expect(bed).toEqual(item(project, ROOM_BED_ITEM_ID));
    expect(undone.products.some((product) => product.id === bed.productId)).toBe(true);
    expect(undone.room.providedBed).toBe(project.room.providedBed);
  });

  it("marks a Better Cart proposal stale like any Studio edit", () => {
    const project = { ...createDemoProject(), proposal: { stale: false } as Project["proposal"] };
    const next = applyItemPatch(project, "item-chair", moveChair(2.5));
    expect(next.proposal!.stale).toBe(true);
    expect(next.cartVersion).toBe(project.cartVersion + 1);
  });
});
