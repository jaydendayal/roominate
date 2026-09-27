"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, BedDouble, Check, DoorOpen, DraftingCompass, LoaderCircle, Palette, Plus, Ruler, Sparkles, Trash2, Upload } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { addRoomBed, BED_SIZES, bedProduct, bedSizeOf, DEFAULT_BED_SIZE, isRoomBedItem, MAX_BED_LOFT_METERS, removeRoomBed, roomBeds, setRoomBedSize } from "@/lib/beds";
import { calculateIssues, productFor } from "@/lib/calculations";
import { DOORWAY_EVIDENCE, PLAN_DOOR_SWING_ID } from "@/lib/floorPlan";
import { occupancyFromRoomType, quantityForOccupancy } from "@/lib/dorm";
import { optimizeLayout } from "@/lib/layoutOptimizer";
import { layoutResultMessage, recommendLayout } from "@/lib/layoutRecommendation";
import { visualProfileFor } from "@/lib/productModels";
import { hasShapedOutline, roomArea, roomPolygon } from "@/lib/roomShape";
import { toUnit } from "@/lib/units";
import type { BedSize, EvidenceSource, Product, Project } from "@/lib/types";
import { ColorChoicePicker } from "../ColorChoicePicker";
import { LengthInput } from "../LengthInput";
import { RoomCanvas } from "../RoomCanvas";
import { FloorPlanScan, type FloorPlanResult } from "./FloorPlanScan";
import { DormResearch, type DormResearchResult } from "./DormResearch";

const sourceLabels: Record<EvidenceSource, string> = {
  user_confirmed: "Measured / confirmed",
  imported_plan: "Housing plan",
  scan: "Device scan",
  media_estimate: "Diagram estimate",
  url: "Product URL",
  screenshot: "Screenshot",
  demo_fixture: "Demo fixture",
  retailer_api: "Retailer API",
};

export function CapturePanel({ project, update, onContinue }: { project: Project; update: (updater: (project: Project) => Project) => void; onContinue: () => void }) {
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [planScanOpen, setPlanScanOpen] = useState(false);
  const [keepProportions, setKeepProportions] = useState(true);
  const [layoutLoading, setLayoutLoading] = useState(false);
  const issues = calculateIssues(project);
  const units = useUnitPreferences();
  const shaped = hasShapedOutline(project.room);
  const scaleConfirmed = project.room.dimensionEvidence.width.confirmedByUser || project.room.dimensionEvidence.length.confirmedByUser;
  const beds = roomBeds(project);
  const modeledBedItems = project.items.filter((item) => productFor(project, item)?.category.toLowerCase() === "bed");
  const loftHeight = modeledBedItems[0]?.transform?.elevation ?? 0;
  const mattressLabel = ([width, length]: [number, number]) => units.objectUnit === "in" ? `${width} × ${length} in` : `${Math.round(width * 2.54)} × ${Math.round(length * 2.54)} cm`;

  const updateRoom = (patch: Partial<Project["room"]>) => update((current) => ({
    ...current,
    room: { ...current.room, ...patch, geometryVersion: current.room.geometryVersion + 1 },
    proposal: current.proposal ? { ...current.proposal, stale: true } : null,
  }));

  const changeDimension = (key: "width" | "length" | "height", value: number | null) => {
    if (value == null || !Number.isFinite(value) || value <= 0) return;
    update((current) => {
      const room = { ...current.room, [key]: value, geometryVersion: current.room.geometryVersion + 1 };
      // A traced shape scales as a whole from one measured side, unless the user wants to stretch it.
      if (key !== "height" && keepProportions && hasShapedOutline(current.room)) {
        const other = key === "width" ? "length" : "width";
        room[other] = Math.round(current.room[other] * (value / current.room[key]) * 1000) / 1000;
      }
      return { ...current, room, proposal: current.proposal ? { ...current.proposal, stale: true } : null };
    });
  };

  const changeEvidence = (key: "width" | "length" | "height", source: EvidenceSource) => update((current) => ({
    ...current,
    room: {
      ...current.room,
      dimensionEvidence: {
        ...current.room.dimensionEvidence,
        [key]: { source, confidence: source === "user_confirmed" || source === "imported_plan" ? 1 : 0.65, confirmedByUser: source === "user_confirmed" || source === "imported_plan" },
      },
    },
  }));

  const applyFloorPlan = (result: FloorPlanResult) => {
    update((current) => {
      const evidence = {
        source: result.measured ? "imported_plan" as const : "media_estimate" as const,
        confidence: result.measured ? 0.95 : 0.3,
        confirmedByUser: result.measured,
        note: result.note,
      };
      // Doors and windows read from an earlier plan are replaced unless they were confirmed. A newly marked
      // doorway replaces one marked on an earlier plan, along with its swing area.
      const markedAgain = Boolean(result.doorway);
      const retained = current.room.features.filter((feature) => (feature.source !== "imported_plan" || feature.confirmed) && !(markedAgain && feature.evidence === DOORWAY_EVIDENCE));
      const zones = current.room.clearanceZones.filter((zone) => !(markedAgain && zone.id.startsWith(PLAN_DOOR_SWING_ID)));
      return {
        ...current,
        room: {
          ...current.room,
          width: result.width,
          length: result.length,
          outline: result.outline,
          dimensionEvidence: { ...current.room.dimensionEvidence, width: evidence, length: evidence },
          features: [...retained, ...result.features, ...(result.doorway ? [result.doorway.feature] : [])],
          clearanceZones: [...zones, ...(result.doorway ? [result.doorway.zone] : [])],
          reconstructionStatus: result.measured ? "reviewed" : "estimated",
          geometryVersion: current.room.geometryVersion + 1,
        },
        proposal: current.proposal ? { ...current.proposal, stale: true } : null,
      };
    });
    setPlanScanOpen(false);
    setAnalysisState("done");
    setAnalysisMessage(result.measured
      ? "Floor plan shape applied at the measured scale. Review any doors or windows it added."
      : "Floor plan shape applied at an estimated size. Enter a measured width or length below; the shape keeps its proportions.");
  };

  const applyDormResearch = (result: DormResearchResult) => {
    const occupancy = occupancyFromRoomType(result.room_type);
    update((current) => {
      const included = result.items.filter((item) => item.included_with_room);
      const previousDormProductIds = new Set(current.products.filter((product) => product.tags.some((tag) => tag.startsWith("dorm-source-"))).map((product) => product.id));
      const cleaned = {
        ...current,
        products: current.products.filter((product) => !previousDormProductIds.has(product.id)),
        items: current.items.filter((item) => !previousDormProductIds.has(item.productId)),
      };
      const hasExtractedBed = included.some((item) => item.category === "bed");
      let prepared = cleaned;
      if (hasExtractedBed) {
        for (const bed of roomBeds(prepared)) prepared = removeRoomBed(prepared, bed.id);
      } else if (occupancy && !prepared.items.some(isRoomBedItem)) {
        prepared = addRoomBed(prepared, DEFAULT_BED_SIZE);
      }
      const products: Product[] = included.map((item, index) => {
        const bedFallback = item.category === "bed" ? bedProduct(DEFAULT_BED_SIZE) : null;
        const modeledHeight = item.height_m ?? bedFallback?.dimensions.height ?? null;
        const note = item.evidence.map((entry) => entry.quote).join(" ").slice(0, 300);
        return {
          id: `dorm-product-${crypto.randomUUID()}`,
          name: item.name,
          store: result.college,
          sourceURL: item.evidence[0]?.source_url ?? result.sources[0]?.source_url ?? null,
          category: item.category,
          variant: result.residence_hall || result.room_type || "Housing-provided",
          dimensions: { width: item.width_m, depth: item.depth_m, height: modeledHeight },
          ...(bedFallback ? { visualProfile: visualProfileFor(bedFallback) } : {}),
          price: null,
          fieldEvidence: {
            dimensions: {
              source: "url",
              confidence: item.height_m == null && bedFallback ? Math.min(item.confidence, 0.7) : item.confidence,
              confirmedByUser: false,
              note: `${note}${item.height_m == null && bedFallback ? " Bed-frame height is a modeling default; confirm it on site." : ""}`.trim(),
            },
          },
          tags: ["housing-provided", `dorm-source-${index + 1}`],
        };
      });
      const sourceNote = result.room_evidence.map((entry) => entry.quote).join(" ").slice(0, 360) || "Extracted from official housing pages; requires confirmation.";
      const room = {
        ...prepared.room,
        ...(result.room_width_m ? { width: result.room_width_m } : {}),
        ...(result.room_length_m ? { length: result.room_length_m } : {}),
        ...(result.room_height_m ? { height: result.room_height_m } : {}),
        dimensionEvidence: {
          ...prepared.room.dimensionEvidence,
          ...(result.room_width_m ? { width: { source: "url" as const, confidence: result.room_confidence, confirmedByUser: false, note: sourceNote } } : {}),
          ...(result.room_length_m ? { length: { source: "url" as const, confidence: result.room_confidence, confirmedByUser: false, note: sourceNote } } : {}),
          ...(result.room_height_m ? { height: { source: "url" as const, confidence: result.room_confidence, confirmedByUser: false, note: sourceNote } } : {}),
        },
        reconstructionStatus: "estimated" as const,
        geometryVersion: prepared.room.geometryVersion + 1,
      };
      const items = products.flatMap((product, productIndex) => {
        const extracted = included[productIndex];
        const quantity = quantityForOccupancy(extracted.quantity, result.room_type);
        return Array.from({ length: quantity }, () => ({
        id: `dorm-item-${crypto.randomUUID()}`,
        productId: product.id,
        ownerId: prepared.ownerId,
        acquisitionStatus: "owned" as const,
        purchaseStatus: "not_purchasing" as const,
        quantity: 1,
        essentiality: "essential" as const,
        needsServed: [product.category],
        transform: null,
        placementType: "floor" as const,
        }));
      });
      const existingRoomBeds = prepared.items.filter(isRoomBedItem);
      const bedTemplate = existingRoomBeds[0];
      const inferredBeds = !hasExtractedBed && bedTemplate && occupancy && occupancy > existingRoomBeds.length
        ? Array.from({ length: occupancy - existingRoomBeds.length }, () => ({
          ...bedTemplate,
          id: `dorm-bed-${crypto.randomUUID()}`,
          transform: null,
          locked: false,
        }))
        : [];
      const staged = {
        ...prepared,
        roomType: result.room_type || prepared.roomType,
        room,
        products: [...prepared.products, ...products],
        items: [...prepared.items, ...inferredBeds, ...items],
        proposal: prepared.proposal ? { ...prepared.proposal, stale: true } : null,
      };
      const layoutItems = [...items, ...inferredBeds, ...(occupancy && occupancy > 1 ? existingRoomBeds : [])];
      return optimizeLayout(staged, { movableItemIds: new Set(layoutItems.map((item) => item.id)) }).project;
    });
    setAnalysisState("done");
    setAnalysisMessage(`Dorm research applied as unconfirmed evidence.${occupancy && occupancy > 1 ? ` The ${result.room_type} design includes at least ${occupancy} of every housing-provided furniture item.` : ""} Furniture was automatically arranged with collision, wall, and clearance checks; review the layout and measurements before confirming it.`);
  };

  const regenerateLayout = async () => {
    setLayoutLoading(true);
    try {
      const recommendation = await recommendLayout(project);
      if (!recommendation) {
        setAnalysisState("error");
        setAnalysisMessage("No movable furniture has complete dimensions. Add dimensions or unlock an item before generating a layout.");
        return;
      }
      update((current) => ({
        ...recommendation.result.project,
        cartVersion: current.cartVersion + 1,
        proposal: current.proposal ? { ...current.proposal, stale: true } : null,
      }));
      setAnalysisState("done");
      setAnalysisMessage(layoutResultMessage(recommendation));
    } catch (error) {
      console.error("Could not generate an optimal layout", error);
      setAnalysisState("error");
      setAnalysisMessage("Roominate could not generate a layout from this room data. Check the room and item dimensions, then try again.");
    } finally {
      setLayoutLoading(false);
    }
  };

  const setBedLoft = (meters: number | null) => {
    if (meters == null) return;
    const elevation = Math.max(0, Math.min(MAX_BED_LOFT_METERS, meters));
    update((current) => ({
      ...current,
      items: current.items.map((item) => productFor(current, item)?.category.toLowerCase() === "bed" && item.transform
        ? { ...item, transform: { ...item.transform, elevation } }
        : item),
      cartVersion: current.cartVersion + 1,
      proposal: current.proposal ? { ...current.proposal, stale: true } : null,
    }));
  };

  return (
    <div className="flow-page capture-page">
      <header className="flow-header">
        <div><p className="eyebrow">Room setup</p><h1>Build from the housing details.</h1><p>Research the exact dorm design, add its provided furniture, and confirm the measurements that decide what fits.</p></div>
        <button className="primary-button" onClick={onContinue}>Open 3D Studio <ArrowRight size={17} /></button>
      </header>
      <div className="capture-grid">
        <section className="panel-surface form-card">
          <div className="step-heading"><span>1</span><div><h2>Find the dorm design</h2><p>Official housing sources and optional floor-plan diagrams provide the room and furniture dimensions.</p></div></div>
          <DormResearch projectId={project.id} onApply={applyDormResearch} onOpenFloorPlan={() => setPlanScanOpen(true)} />
          {analysisMessage && <div className={`analysis-message ${analysisState}`}><span>{analysisState === "done" ? <Check size={16} /> : <Upload size={16} />}</span>{analysisMessage}</div>}
        </section>

        <section className="panel-surface form-card">
          <div className="step-heading"><span>2</span><div><h2>Confirm dimensions</h2><p>Enter measurements in your preferred units, or trace the room&rsquo;s shape from a floor plan. These measurements override media estimates.</p></div></div>
          <button className="plan-scan-button" onClick={() => setPlanScanOpen(true)}><span className="upload-icon"><DraftingCompass size={22} /></span><span><strong>{shaped ? "Read a different floor plan" : "Read a floor plan or diagram"}</strong><small>Upload a screenshot; OpenAI reads printed labels and code traces the room walls</small></span><ArrowRight size={17} /></button>
          {shaped && <div className="shape-summary">
            <svg viewBox={`0 0 ${project.room.width} ${project.room.length}`} aria-hidden="true"><polygon transform={`matrix(1 0 0 -1 0 ${project.room.length})`} points={roomPolygon(project.room).map((point) => `${point.x},${point.y}`).join(" ")} /></svg>
            <span><strong>Traced shape</strong><small>{roomPolygon(project.room).length} walls · {units.unitSystem === "imperial" ? `${Math.round(roomArea(project.room) * 10.7639)} sq ft` : `${roomArea(project.room).toFixed(1)} m²`}</small></span>
            <button className="text-button" onClick={() => updateRoom({ outline: undefined })}>Use a rectangle</button>
            <label className="snap-toggle"><input type="checkbox" checked={keepProportions} onChange={(event) => setKeepProportions(event.target.checked)} /><span>Keep proportions when changing width or length</span></label>
          </div>}
          <div className="dimension-fields">
            {(["width", "length", "height"] as const).map((key) => (
              <div className="dimension-field" key={key}>
                <label><span>{shaped && key !== "height" ? `Overall ${key}` : key[0].toUpperCase() + key.slice(1)}</span><div className="unit-input"><LengthInput min={0} step={units.roomUnit === "ft" ? 0.25 : 0.01} unit={units.roomUnit} meters={project.room[key]} onChange={(meters) => changeDimension(key, meters)} /><b>{units.roomUnit}</b></div></label>
                <select value={project.room.dimensionEvidence[key].source} onChange={(event) => changeEvidence(key, event.target.value as EvidenceSource)} aria-label={`${key} evidence source`}>
                  {(["user_confirmed", "imported_plan", "media_estimate", "url"] as EvidenceSource[]).map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}
                </select>
              </div>
            ))}
          </div>
          {scaleConfirmed
            ? <div className="evidence-note"><Ruler size={17} /><span><strong>Scale is anchored.</strong> The room has a valid floor and positive confirmed dimensions for placement.</span></div>
            : <div className="evidence-note unanchored"><AlertTriangle size={17} /><span><strong>Scale is an estimate.</strong> Measure the width or length and mark it confirmed before trusting what fits.</span></div>}
          <div className="subsection-title"><h3>Beds that come with the room</h3><button className="text-button" onClick={() => update((current) => addRoomBed(current))}><Plus size={15} /> Add bed</button></div>
          <div className="bed-list">
            {beds.map((bed, index) => {
              const model = productFor(project, bed);
              const updateBed = (patch: Partial<typeof bed>) => update((current) => ({ ...current, items: current.items.map((item) => item.id === bed.id ? { ...item, ...patch } : item) }));
              return <div className="bed-setting" key={bed.id}>
                <div className="bed-fields">
                  <label><span>{beds.length > 1 ? `Bed ${index + 1} size` : "Bed size"}</span>
                    <select value={bedSizeOf(bed.productId)!} onChange={(event) => update((current) => setRoomBedSize(current, bed.id, event.target.value as BedSize))}>
                      {BED_SIZES.map((info) => <option value={info.id} key={info.id}>{info.label} · {mattressLabel(info.mattress)} mattress{info.id === DEFAULT_BED_SIZE ? " (typical dorm)" : ""}</option>)}
                    </select>
                  </label>
                  {project.people.length > 1 && <label><span>Whose bed</span>
                    <select value={bed.ownerId} onChange={(event) => updateBed({ ownerId: event.target.value })}>
                      {project.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
                    </select>
                  </label>}
                  <button className="icon-button danger" onClick={() => update((current) => removeRoomBed(current, bed.id))} aria-label={beds.length > 1 ? `Remove bed ${index + 1}` : "Remove bed"} title="Remove bed"><Trash2 size={15} /></button>
                </div>
                {model && <ColorChoicePicker product={model} selection={bed.colorSelection} onChange={(colorSelection) => updateBed({ colorSelection })} />}
              </div>;
            })}
            {!beds.length && <p className="empty-row">No bed is modeled. Add one for each bed the room comes with.</p>}
            <small className="bed-note"><BedDouble size={14} /> {beds.length ? "Placed in the 3D Studio as owned items you can move or lock. Beds count for fit and clearance, never for the cart." : "Rooms without a provided bed leave the floor free for your own."}</small>
            {!!modeledBedItems.length && <label><span>Loft height · all {modeledBedItems.length} bed{modeledBedItems.length === 1 ? "" : "s"}</span><LengthInput min={0} max={toUnit(MAX_BED_LOFT_METERS, units.roomUnit)} step={units.roomUnit === "ft" ? 0.25 : 0.05} unit={units.roomUnit} meters={loftHeight} onChange={setBedLoft} /></label>}
            {!!modeledBedItems.length && <small className="bed-note"><BedDouble size={14} /> Loft height applies to all modeled beds, is limited to 60 inches, and participates in collision checks.</small>}
          </div>
          <div className="subsection-title"><h3>Openings & fixed features</h3><button className="text-button" onClick={() => updateRoom({ features: [...project.room.features, { id: `door-${crypto.randomUUID()}`, name: "New door", kind: "door", position: { x: 0.5, y: 0 }, width: 0.9, depth: 0.08, height: 2.03, confirmed: false }] })}><Plus size={15} /> Add</button></div>
          <div className="feature-list">
            {project.room.features.map((feature) => <div className="feature-row" key={feature.id}><span><DoorOpen size={17} /><strong>{feature.name}</strong></span><small>{units.formatLength(feature.width, "object")} wide · {feature.wall && feature.wall !== "unknown" ? `${feature.wall} wall · ` : ""}{feature.confirmed ? "confirmed" : "needs review"}</small><span className="feature-actions">{!feature.confirmed && <button className="text-button" onClick={() => updateRoom({ features: project.room.features.map((candidate) => candidate.id === feature.id ? { ...candidate, confirmed: true } : candidate) })}><Check size={13} /> Confirm</button>}<button className="icon-button danger" onClick={() => updateRoom({ features: project.room.features.filter((candidate) => candidate.id !== feature.id) })} aria-label={`Remove ${feature.name}`}><Trash2 size={13} /></button></span></div>)}
            {!project.room.features.length && <p className="empty-row">No openings added yet. Door clearance remains unknown.</p>}
          </div>
        </section>

        <section className="capture-preview viewport-card">
          <div className="preview-heading"><div><p className="eyebrow">Live scaled preview</p><h2>{units.formatLength(project.room.width)} × {units.formatLength(project.room.length)} × {units.formatLength(project.room.height)}{shaped ? " · traced shape" : ""}</h2><small>{project.room.features.length ? `${project.room.features.length} structural feature${project.room.features.length === 1 ? "" : "s"} modeled` : "Add openings manually or from an uploaded floor-plan diagram."}</small></div><div className="capture-preview-actions">{scaleConfirmed ? <span className="source-chip confirmed"><Check size={13} /> measured shell</span> : <span className="source-chip uncertain"><AlertTriangle size={13} /> estimated shell</span>}<button className="secondary-button small" disabled={layoutLoading} onClick={() => void regenerateLayout()}>{layoutLoading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} Generate optimal layout</button></div></div>
          <div className="capture-canvas"><RoomCanvas project={project} issues={issues} cutaway compact viewCommand={{ type: "reset", nonce: project.room.geometryVersion }} /></div>
          <div className="palette-bar">
            <span><Palette size={16} /> Room palette</span>
            <div>{project.room.palette.map((swatch) => <label key={swatch.id} title={`${swatch.label} · ${swatch.source}`}><input type="color" value={swatch.hex} onChange={(event) => updateRoom({ palette: project.room.palette.map((candidate) => candidate.id === swatch.id ? { ...candidate, hex: event.target.value } : candidate) })} /><i style={{ background: swatch.hex }} /></label>)}<button className="swatch-add" title="Add color" onClick={() => updateRoom({ palette: [...project.room.palette, { id: `swatch-${crypto.randomUUID()}`, hex: "#d5c6ad", label: "manual color", source: "manual selection", pinned: false }] })}><Plus size={15} /></button></div>
            <small>Suggestions only; lighting can shift appearance.</small>
          </div>
        </section>
      </div>
      {planScanOpen && <FloorPlanScan room={project.room} projectId={project.id} onClose={() => setPlanScanOpen(false)} onApply={applyFloorPlan} />}
    </div>
  );
}
