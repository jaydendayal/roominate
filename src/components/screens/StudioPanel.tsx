"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, ChevronRight, Eye, Grid3X3, Lock, Maximize2, Move3D, PackagePlus, RotateCw, ScanLine, ShoppingCart, Unlock } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { cents, productFor, purchaseSubtotal, settledElevation } from "@/lib/calculations";
import { snapItemPosition } from "@/lib/snap";
import type { Issue, Item, Project, Vec2 } from "@/lib/types";
import { LengthInput } from "../LengthInput";
import { RoomCanvas } from "../RoomCanvas";

export function StudioPanel({
  project,
  issues,
  update,
  onOpenProducts,
  onOpenIssues,
}: {
  project: Project;
  issues: Issue[];
  update: (updater: (project: Project) => Project) => void;
  onOpenProducts: () => void;
  onOpenIssues: () => void;
}) {
  const [selectedId, setSelectedId] = useState(project.items.find((item) => item.transform)?.id ?? null);
  const [cutaway, setCutaway] = useState(true);
  const [viewCommand, setViewCommand] = useState<{ type: "reset" | "overhead"; nonce: number }>({ type: "reset", nonce: 0 });
  const selected = project.items.find((item) => item.id === selectedId);
  const selectedProduct = selected ? productFor(project, selected) : null;
  const selectedIssues = issues.filter((issue) => selectedId && issue.affectedItemIds.includes(selectedId));
  const subtotal = purchaseSubtotal(project);
  const units = useUnitPreferences();

  const changeItem = (itemId: string, patch: Partial<Project["items"][number]>) => {
    update((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
      cartVersion: current.cartVersion + 1,
      proposal: current.proposal ? { ...current.proposal, stale: true } : null,
    }));
  };

  // Per-item lock: freezes position and rotation (drag, lift, typed values, nudges, rotate, unplace) and Better Cart treats it as fixed.
  const toggleLock = (item: Item) => changeItem(item.id, { locked: !item.locked });

  // Typed and nudged moves settle like drags: off the top of an item they drop to the floor, into one they land on top.
  const moveTo = (item: Item, position: Vec2) => {
    if (item.locked) return;
    const transform = item.transform ?? { position, rotationZ: 0 };
    changeItem(item.id, { transform: { ...transform, position, elevation: settledElevation(project, { ...item, transform }, position) } });
  };

  const rotateSelected = () => {
    if (!selected || selected.locked) return;
    const rotationZ = (selected.transform?.rotationZ ?? 0) + Math.PI / 2;
    const center = selected.transform?.position ?? { x: project.room.width / 2, y: project.room.length / 2 };
    // Rotating swaps width and depth, so re-align edges when snapping is on.
    const position = units.snapToGrid ? snapItemPosition(project, selected.id, center, units.gridSize, rotationZ) : center;
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
    moveTo(selected, position);
  };

  const setSelectedElevation = (meters: number | null) => {
    if (!selected || selected.locked || meters == null) return;
    const transform = selected.transform ?? { position: { x: project.room.width / 2, y: project.room.length / 2 }, rotationZ: 0 };
    changeItem(selected.id, { transform: { ...transform, elevation: meters } });
  };

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
            const hasIssue = issues.some((issue) => issue.affectedItemIds.includes(item.id));
            const name = product?.name ?? "Unknown item";
            return (
              <div className={`room-item-row ${selectedId === item.id ? "selected" : ""}`} key={item.id}>
                <button className="room-item-select" onClick={() => setSelectedId(item.id)}>
                  <span className="object-thumb" style={{ background: owner?.color }}><Box size={18} /></span>
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
            <button className={`viewport-button ${cutaway ? "active" : ""}`} onClick={() => setCutaway((current) => !current)}><Eye size={16} /><span>Cutaway</span></button>
            <button className="viewport-button" onClick={() => setViewCommand({ type: "overhead", nonce: Date.now() })}><Grid3X3 size={16} /><span>Overhead</span></button>
            <button className="viewport-button" onClick={() => setViewCommand({ type: "reset", nonce: Date.now() })}><Maximize2 size={16} /><span>Reset</span></button>
          </div>
        </div>
        <RoomCanvas
          project={project}
          issues={issues}
          selectedItemId={selectedId}
          onSelectItem={(id) => setSelectedId(id || null)}
          onMoveItem={(itemId, position, elevation) => {
            const item = project.items.find((candidate) => candidate.id === itemId);
            if (item?.transform) changeItem(itemId, { transform: { ...item.transform, position, elevation } });
          }}
          cutaway={cutaway}
          viewCommand={viewCommand}
        />
        <div className="viewport-legend"><span><i className="legend-owned" /> Owned</span><span><i className="legend-planned" /> Planned</span><span><i className="legend-conflict" /> Conflict</span><span><i className="legend-outside" /> Outside room</span><span><Move3D size={14} /> Drag items to move · arrow handle lifts</span></div>
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
              <label>Z ({units.roomUnit})<LengthInput disabled={selected.locked} step={coordinateStep} unit={units.roomUnit} meters={selected.transform?.elevation ?? 0} onChange={setSelectedElevation} /></label>
            </div>
            <div className="nudge-row" role="group" aria-label={`Move by ${stepLabel}`}>
              <span>Move {stepLabel}</span>
              {([["x", -1, "−X", ArrowLeft], ["x", 1, "+X", ArrowRight], ["y", -1, "−Y", ArrowUp], ["y", 1, "+Y", ArrowDown]] as const).map(([axis, direction, label, Icon]) => (
                <button key={label} type="button" className="secondary-button" disabled={selected.locked || !selected.transform} aria-label={`Move ${label} by ${stepLabel}`} title={`Move ${label} by ${stepLabel}`} onClick={() => nudgeSelected(axis, direction)}>
                  <Icon size={14} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            <div className="button-pair">
              <button className="secondary-button" disabled={selected.locked} onClick={rotateSelected}><RotateCw size={16} /> Rotate 90°</button>
              <button className="secondary-button" disabled={selected.locked} onClick={() => changeItem(selected.id, { transform: null })}>Unplace</button>
            </div>
            {selected.locked && <div className="info-note">Locked: dragging, lifting, typed positions, nudges, rotating, and unplacing are off for this item, and Better Cart won’t change it. Unlock it above to edit.</div>}
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
