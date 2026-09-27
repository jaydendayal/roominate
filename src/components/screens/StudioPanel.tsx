"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BedDouble, Box, ChevronRight, Eye, Grid3X3, LoaderCircle, Lock, Maximize2, Move3D, PackagePlus, Redo2, RotateCw, ScanLine, ShoppingCart, Sparkles, Trash2, Undo2, Unlock } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { MAX_BED_LOFT_METERS } from "@/lib/beds";
import { cents, productFor, purchaseSubtotal, settledElevation } from "@/lib/calculations";
import { applyItemPatch, nextEdit, recordEdit, recordRemoval, redoEdit, removeItem, undoEdit, type ItemEdit, type ItemHistory, type ItemPatch } from "@/lib/itemHistory";
import { arrowAxis, isArrowKey, verticalKey } from "@/lib/keyboardMoves";
import { layoutResultMessage, recommendLayout } from "@/lib/layoutRecommendation";
import { snapItemPlacement } from "@/lib/snap";
import type { Issue, Item, Project, Vec2 } from "@/lib/types";
import { ColorChoicePicker } from "../ColorChoicePicker";
import { LengthInput } from "../LengthInput";
import { personTone } from "../personTones";
import { RoomCanvas } from "../RoomCanvas";

const CONTROLS_HELP = "Drag to move · purple ring rotates · blue arrow lifts · arrow keys move · + / − raise and lower";

export function StudioPanel({
  project,
  issues,
  update,
  history,
  onHistoryChange,
  onOpenProducts,
  onOpenIssues,
}: {
  project: Project;
  issues: Issue[];
  update: (updater: (project: Project) => Project) => void;
  history: ItemHistory;
  onHistoryChange: (change: (history: ItemHistory) => ItemHistory) => void;
  onOpenProducts: () => void;
  onOpenIssues: () => void;
}) {
  const [selectedId, setSelectedId] = useState(project.items.find((item) => item.transform)?.id ?? null);
  const [cutaway, setCutaway] = useState(true);
  const [viewCommand, setViewCommand] = useState<{ type: "reset" | "overhead"; nonce: number }>({ type: "reset", nonce: 0 });
  const [isMac, setIsMac] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const selected = project.items.find((item) => item.id === selectedId);
  const selectedProduct = selected ? productFor(project, selected) : null;
  const selectedIssues = issues.filter((issue) => selectedId && issue.affectedItemIds.includes(selectedId));
  const subtotal = purchaseSubtotal(project);
  const units = useUnitPreferences();
  const viewOnly = project.collaboration?.permission === "view";

  // Every Studio edit (drag, rotate, lift, typed or nudged move, lock, color, unplace) goes through here and is undoable.
  // `typed` values change on every keystroke, so quick follow-ups fold into one undo step.
  const changeItem = (itemId: string, patch: ItemPatch, typed = false) => {
    if (!viewOnly) onHistoryChange((current) => recordEdit(current, project, itemId, patch, Date.now(), typed));
    update((current) => applyItemPatch(current, itemId, patch));
  };

  // Removing an item asks first; this holds the id of the item awaiting confirmation.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const removeSelected = () => {
    if (!selected || selected.locked || viewOnly) return;
    onHistoryChange((current) => recordRemoval(current, project, selected.id));
    update((current) => removeItem(current, selected.id));
    setPendingRemoveId(null);
    setSelectedId(null);
  };

  const undoTarget = nextEdit(history, project, "undo");
  const redoTarget = nextEdit(history, project, "redo");
  const describe = (edit: ItemEdit | null) => {
    // A removed item is no longer in the project, so its name comes from the saved copy.
    const item = edit && (project.items.find((candidate) => candidate.id === edit.itemId) ?? edit.removed?.item);
    const name = item ? productFor(project, item)?.name ?? "item" : "";
    return edit ? `${edit.label.toLowerCase()} ${name}` : "";
  };
  const shortcut = (redo: boolean) => isMac ? (redo ? "⇧⌘Z" : "⌘Z") : (redo ? "Ctrl+Y" : "Ctrl+Z");

  const travel = (direction: "undo" | "redo") => {
    if (viewOnly) return;
    const result = direction === "undo" ? undoEdit(history, project) : redoEdit(history, project);
    if (!result) return;
    const moved = (direction === "undo" ? result.history.future : result.history.past).slice(-1)[0];
    onHistoryChange(() => result.history);
    update(() => result.project);
    if (moved) setSelectedId(moved.itemId);
  };

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);

  // Per-item lock: freezes position and rotation (drag, lift, typed values, nudges, rotate, unplace) and Better Cart treats it as fixed.
  const toggleLock = (item: Item) => changeItem(item.id, { locked: !item.locked });

  // Typed and nudged moves settle like drags: off the top of an item they drop to the floor, into one they land on top.
  const moveTo = (item: Item, position: Vec2, typed = false) => {
    if (item.locked) return;
    const transform = item.transform ?? { position, rotationZ: 0 };
    changeItem(item.id, { transform: { ...transform, position, elevation: settledElevation(project, { ...item, transform }, position) } }, typed);
  };

  const rotateSelected = () => {
    if (!selected || selected.locked) return;
    const rotationZ = (selected.transform?.rotationZ ?? 0) + Math.PI / 2;
    const center = selected.transform?.position ?? { x: project.room.width / 2, y: project.room.length / 2 };
    // Rotating swaps width and depth, so re-align edges when snapping is on.
    const position = snapItemPlacement(project, selected.id, center, { grid: units.snapToGrid, furniture: units.snapToFurniture, cell: units.gridSize, rotationZ });
    changeItem(selected.id, { transform: { ...selected.transform, position, rotationZ } });
  };

  // Nudges move by exactly the user's step distance from the current position.
  const stepLabel = units.formatLength(units.moveStep, "object");
  const coordinateStep = units.roomUnit === "ft" ? 0.25 : 0.05;
  const nudgeSelected = (axis: keyof Vec2, direction: -1 | 1) => {
    if (!selected?.transform || selected.locked) return;
    const { position } = selected.transform;
    moveTo(selected, { ...position, [axis]: Number((position[axis] + direction * units.moveStep).toFixed(4)) });
  };

  const moveSelectedAxis = (axis: keyof Vec2, meters: number | null) => {
    if (!selected || meters == null) return;
    const position = { x: selected.transform?.position.x ?? 0, y: selected.transform?.position.y ?? 0, [axis]: meters };
    moveTo(selected, position, true);
  };

  const setSelectedElevation = (meters: number | null) => {
    if (!selected || selected.locked || meters == null) return;
    const transform = selected.transform ?? { position: { x: project.room.width / 2, y: project.room.length / 2 }, rotationZ: 0 };
    const elevation = selectedProduct?.category.toLowerCase() === "bed"
      ? Math.max(0, Math.min(MAX_BED_LOFT_METERS, meters))
      : meters;
    changeItem(selected.id, { transform: { ...transform, elevation } }, true);
  };

  const generateOptimalLayout = async () => {
    setOptimizing(true);
    setLayoutMessage("");
    try {
      const recommendation = await recommendLayout(project);
      if (!recommendation) {
        setLayoutMessage("No movable items have complete dimensions. Add dimensions or unlock an item before generating a layout.");
        return;
      }
      update((current) => ({
        ...recommendation.result.project,
        cartVersion: current.cartVersion + 1,
        proposal: current.proposal ? { ...current.proposal, stale: true } : null,
      }));
      setViewCommand({ type: "reset", nonce: Date.now() });
      setLayoutMessage(layoutResultMessage(recommendation));
    } catch (error) {
      console.error("Could not generate an optimal layout", error);
      setLayoutMessage("Roominate could not generate a layout from this room data. Check the room and item dimensions, then try again.");
    } finally {
      setOptimizing(false);
    }
  };

  // Raises or lowers the selected item by one step; it stops at the floor.
  const liftSelected = (direction: -1 | 1) => {
    if (!selected?.transform || selected.locked) return;
    const current = selected.transform.elevation ?? 0;
    const raised = Math.max(0, Number((current + direction * units.moveStep).toFixed(4)));
    const elevation = selectedProduct?.category.toLowerCase() === "bed" ? Math.min(MAX_BED_LOFT_METERS, raised) : raised;
    if (elevation !== current) changeItem(selected.id, { transform: { ...selected.transform, elevation } });
  };

  // Keyboard shortcuts, active while the Studio is open and focus isn't in a text field or color list:
  // - arrow keys step the selected item along X or Y, whichever matches that direction on screen;
  // - + and − step it up and down the Z axis;
  // - Ctrl/⌘+Z undoes; Ctrl+Y or Ctrl/⌘+Shift+Z redoes.
  // Each press moves by the "Move in steps" distance and is its own undo step.
  const screenRightRef = useRef<(() => Vec2) | null>(null);
  const onStudioKey = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true'], [role='listbox'], [aria-haspopup='listbox']")) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      const direction = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" && !event.shiftKey ? "redo" : null;
      if (!direction) return;
      event.preventDefault();
      travel(direction);
      return;
    }
    if (event.altKey || !selected?.transform) return;
    if (isArrowKey(event.key)) {
      event.preventDefault();
      const { axis, direction } = arrowAxis(event.key, screenRightRef.current?.() ?? { x: 1, y: 0 });
      nudgeSelected(axis, direction);
      return;
    }
    const vertical = verticalKey(event.key);
    if (vertical) {
      event.preventDefault();
      liftSelected(vertical);
    }
  };
  const keyHandler = useRef(onStudioKey);
  useEffect(() => {
    keyHandler.current = onStudioKey;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="studio-layout">
      <section className="studio-products panel-surface">
        <div className="panel-heading">
          <div><p className="eyebrow">Shared plan</p><h2>In the room</h2></div>
          <button className="icon-button" onClick={onOpenProducts} title="Add product"><PackagePlus size={18} /></button>
        </div>
        <div className="item-stack">
          {project.items.filter((item) => item.purchaseStatus !== "deferred").map((item) => {
            const product = productFor(project, item);
            const owner = project.people.find((person) => person.id === item.ownerId);
            const tone = personTone(project, item.ownerId);
            const hasIssue = issues.some((issue) => issue.affectedItemIds.includes(item.id));
            const name = product?.name ?? "Unknown item";
            return (
              <div className={`room-item-row ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
                <button className="room-item-select" onClick={() => setSelectedId(item.id)}>
                  <span className="object-thumb" style={{ background: tone.fill, color: tone.mark }}><Box size={18} /></span>
                  <span className="item-row-copy"><strong>{name}</strong><small>{owner?.name} · {item.transform ? "placed" : "fit unverified"}{item.locked ? " · locked" : ""}</small></span>
                  {hasIssue && <AlertTriangle size={16} className="warn-text" />}
                </button>
                <button
                  type="button"
                  className={`icon-button lock-button ${item.locked ? "on" : ""}`}
                  aria-pressed={Boolean(item.locked)}
                  aria-label={item.locked ? `Unlock ${name}` : `Lock position and rotation of ${name}`}
                  title={item.locked ? "Locked: position and rotation can't change. Click to unlock." : "Lock position and rotation"}
                  onClick={() => toggleLock(item)}
                >
                  {item.locked ? <Lock size={15} /> : <Unlock size={15} />}
                </button>
              </div>
            );
          })}
        </div>
        <button className="secondary-button full" onClick={onOpenProducts}><PackagePlus size={16} /> Add or import item</button>
      </section>

      <section className="viewport-card">
        <div className="viewport-topbar">
          <span className="view-badge"><ScanLine size={14} /> {units.formatLength(project.room.width)} × {units.formatLength(project.room.length)}</span>
          <div>
            <div className="history-buttons" role="group" aria-label="Edit history">
              <button
                type="button"
                className="viewport-button"
                disabled={viewOnly || !undoTarget}
                onClick={() => travel("undo")}
                aria-label={undoTarget ? `Undo ${describe(undoTarget)}` : "Nothing to undo"}
                title={undoTarget ? `Undo ${describe(undoTarget)} (${shortcut(false)})` : "Nothing to undo"}
              ><Undo2 size={16} /><span>Undo</span></button>
              <button
                type="button"
                className="viewport-button"
                disabled={viewOnly || !redoTarget}
                onClick={() => travel("redo")}
                aria-label={redoTarget ? `Redo ${describe(redoTarget)}` : "Nothing to redo"}
                title={redoTarget ? `Redo ${describe(redoTarget)} (${shortcut(true)})` : "Nothing to redo"}
              ><Redo2 size={16} /><span>Redo</span></button>
            </div>
            <button className="viewport-button optimize" disabled={optimizing} onClick={() => void generateOptimalLayout()}>{optimizing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}<span>{optimizing ? "Optimizing…" : "Generate optimal layout"}</span></button>
            <button className={`viewport-button ${cutaway ? "active" : ""}`} onClick={() => setCutaway((current) => !current)}><Eye size={16} /><span>Cutaway</span></button>
            <button className="viewport-button" onClick={() => setViewCommand({ type: "overhead", nonce: Date.now() })}><Grid3X3 size={16} /><span>Overhead</span></button>
            <button className="viewport-button" onClick={() => setViewCommand({ type: "reset", nonce: Date.now() })}><Maximize2 size={16} /><span>Reset</span></button>
          </div>
        </div>
        {layoutMessage && <div className="layout-result-banner"><Sparkles size={15} /><span>{layoutMessage}</span><button type="button" aria-label="Dismiss layout result" onClick={() => setLayoutMessage("")}>×</button></div>}
        <RoomCanvas
          project={project}
          issues={issues}
          selectedItemId={selectedId}
          onSelectItem={(id) => setSelectedId(id || null)}
          onMoveItem={(itemId, position, elevation, rotationZ) => {
            const item = project.items.find((candidate) => candidate.id === itemId);
            if (item?.transform) changeItem(itemId, { transform: { ...item.transform, position, elevation, rotationZ } });
          }}
          cutaway={cutaway}
          viewCommand={viewCommand}
          screenRightRef={screenRightRef}
          legend={<div className="viewport-legend">
            <span><i className="legend-finish" /> Chosen product colors</span>
            <span><i className="legend-conflict" /> Conflict</span>
            <span><i className="legend-outside" /> Outside room</span>
            {/* The full controls text shows on hover and to screen readers, keeping the bar to one line. */}
            <span className="legend-controls" tabIndex={0} title={CONTROLS_HELP} aria-label={`Controls: ${CONTROLS_HELP}`}><Move3D size={14} /> Controls</span>
          </div>}
        />
      </section>

      <section className="studio-inspector panel-surface">
        <div className="budget-card">
          <span>Group cart</span>
          <strong>{cents(subtotal.amount)}</strong>
          <small>of {cents(project.budgetAmount)} · tax/shipping not included</small>
          <div className="budget-track"><span style={{ width: `${Math.min(100, (subtotal.amount / project.budgetAmount) * 100)}%` }} /></div>
        </div>
        {selected && selectedProduct ? (
          <div className="inspector-content">
            <p className="eyebrow">Selected object</p>
            <h3>{selectedProduct.name}</h3>
            <p className="muted-copy">{units.formatDimensions(selectedProduct.dimensions)} · {selected.placementType}</p>
            {/* Finish changes the 3D model's colors; allowed on locked items since the lock covers position and rotation. */}
            <ColorChoicePicker product={selectedProduct} selection={selected.colorSelection} onChange={(colorSelection) => changeItem(selected.id, { colorSelection })} />
            <button
              type="button"
              className={`lock-toggle ${selected.locked ? "on" : ""}`}
              aria-pressed={Boolean(selected.locked)}
              title={selected.locked ? "Locked: position and rotation can't change. Click to unlock." : "Keeps this item from being moved, lifted, or rotated"}
              onClick={() => toggleLock(selected)}
            >
              {selected.locked ? <Lock size={15} /> : <Unlock size={15} />}
              <span><strong>{selected.locked ? "Position & rotation locked" : "Lock position & rotation"}</strong><small>{selected.locked ? "Click to unlock this item" : "Stops moves, lifts, and rotation"}</small></span>
            </button>
            <div className="coordinate-grid">
              <label>X ({units.roomUnit})<LengthInput disabled={selected.locked} step={coordinateStep} unit={units.roomUnit} meters={selected.transform?.position.x ?? 0} onChange={(meters) => moveSelectedAxis("x", meters)} /></label>
              <label>Y ({units.roomUnit})<LengthInput disabled={selected.locked} step={coordinateStep} unit={units.roomUnit} meters={selected.transform?.position.y ?? 0} onChange={(meters) => moveSelectedAxis("y", meters)} /></label>
              <label>{selectedProduct.category.toLowerCase() === "bed" ? "Loft" : "Z"} ({units.roomUnit})<LengthInput disabled={selected.locked} min={selectedProduct.category.toLowerCase() === "bed" ? 0 : undefined} max={selectedProduct.category.toLowerCase() === "bed" ? (units.roomUnit === "ft" ? 5 : MAX_BED_LOFT_METERS) : undefined} step={coordinateStep} unit={units.roomUnit} meters={selected.transform?.elevation ?? 0} onChange={setSelectedElevation} /></label>
            </div>
            {selectedProduct.category.toLowerCase() === "bed" && <div className="info-note"><BedDouble size={16} /> Loft beds up to 60 inches. Existing posts extend to the floor, and furniture can stay underneath without snapping onto the mattress.</div>}
            <div className="nudge-row" role="group" aria-label={`Move by ${stepLabel}`}>
              <span>Move {stepLabel}</span>
              {/* Icons match the default view, where +Y (north) runs up the screen, like the ↑ key. */}
              {([["x", -1, "−X", ArrowLeft], ["x", 1, "+X", ArrowRight], ["y", 1, "+Y", ArrowUp], ["y", -1, "−Y", ArrowDown]] as const).map(([axis, direction, label, Icon]) => (
                <button key={label} type="button" className="secondary-button" disabled={selected.locked || !selected.transform} aria-label={`Move ${label} by ${stepLabel}`} title={`Move ${label} by ${stepLabel}`} onClick={() => nudgeSelected(axis, direction)}>
                  <Icon size={14} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            <p className="key-hint"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move on screen · <kbd>+</kbd><kbd>−</kbd> raise / lower · {stepLabel} per press</p>
            <div className="button-pair">
              <button className="secondary-button" disabled={selected.locked} onClick={rotateSelected}><RotateCw size={16} /> Rotate 90°</button>
              <button className="secondary-button danger-outline" disabled={selected.locked || viewOnly} title={selected.locked ? "Unlock this item to remove it" : "Remove this item from the room"} aria-expanded={pendingRemoveId === selected.id} onClick={() => setPendingRemoveId(selected.id)}><Trash2 size={16} /> Remove</button>
            </div>
            {pendingRemoveId === selected.id && (
              <div className="delete-confirm" role="alertdialog" aria-labelledby={`remove-${selected.id}`} onKeyDown={(event) => { if (event.key === "Escape") setPendingRemoveId(null); }}>
                <p id={`remove-${selected.id}`}>
                  <strong>Remove {selectedProduct.name}?</strong>
                  It&rsquo;s taken out of the 3D room and the In the room list{selected.purchaseStatus === "in_cart" ? ", and out of the group cart" : ""}. You can undo this.
                </p>
                <div>
                  <button type="button" className="secondary-button compact-button" autoFocus onClick={() => setPendingRemoveId(null)}>Cancel</button>
                  <button type="button" className="danger-button compact-button" onClick={removeSelected}><Trash2 size={14} /> Remove</button>
                </div>
              </div>
            )}
            {selected.locked && <div className="info-note">Locked: dragging, lifting, typed positions, nudges, rotating, and removing are off for this item, and Better Cart won’t change it. Unlock it above to edit.</div>}
            {selectedIssues.length > 0 ? <div className="selected-issues">{selectedIssues.map((issue) => <button key={issue.id} onClick={onOpenIssues}><AlertTriangle size={16} /><span><strong>{issue.message}</strong><small>{issue.detail}</small></span><ChevronRight size={15} /></button>)}</div> : <div className="success-note"><span><Box size={16} /></span> No confirmed placement conflicts</div>}
          </div>
        ) : (
          <div className="empty-inspector"><ShoppingCart size={25} /><h3>Select an item</h3><p>Pick an object in the room or the list to inspect its dimensions and exact placement.</p></div>
        )}
        <button className="issue-strip" onClick={onOpenIssues}><span><AlertTriangle size={18} /> {issues.length} issues to review</span><ChevronRight size={18} /></button>
      </section>
    </div>
  );
}
