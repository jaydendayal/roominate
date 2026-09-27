"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BedDouble, Camera, Check, Crosshair, DoorOpen, DraftingCompass, ImagePlus, LoaderCircle, Palette, Plus, Ruler, ScanLine, Trash2, Upload, Video } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { addRoomBed, BED_SIZES, bedSizeOf, DEFAULT_BED_SIZE, removeRoomBed, roomBeds, setRoomBedSize } from "@/lib/beds";
import { calculateIssues, productFor } from "@/lib/calculations";
import { apiFetch, normalizeImageUpload } from "@/lib/api";
import { FEATURE_DEFAULTS, hasShapedOutline, pointOnWall, roomArea, roomPolygon } from "@/lib/roomShape";
import type { BedSize, EvidenceSource, MediaAsset, PaletteSwatch, Project, RoomFeature } from "@/lib/types";
import { ColorChoicePicker } from "../ColorChoicePicker";
import { LengthInput } from "../LengthInput";
import { RoomCanvas } from "../RoomCanvas";
import { FloorPlanScan, type FloorPlanResult } from "./FloorPlanScan";
import { GuidedRoomScan } from "./GuidedRoomScan";

const sourceLabels: Record<EvidenceSource, string> = {
  user_confirmed: "Measured / confirmed",
  imported_plan: "Housing plan",
  scan: "Device scan",
  media_estimate: "Media estimate",
  url: "Product URL",
  screenshot: "Screenshot",
  demo_fixture: "Demo fixture",
  retailer_api: "Retailer API",
};

interface RoomAnalysisResponse {
  status: "complete" | "partial" | "manual_fallback" | "cached";
  schema_version: string;
  palette: { hex: string; label: string; confidence: number; evidence: string }[];
  room: {
    width_m: number | null;
    length_m: number | null;
    height_m: number | null;
    notes: string[];
    features: Array<{
      kind: RoomFeature["kind"];
      label: string;
      wall?: NonNullable<RoomFeature["wall"]>;
      offset_ratio?: number;
      width_m?: number | null;
      depth_m?: number | null;
      height_m?: number | null;
      elevation_m?: number | null;
      confidence: number;
      evidence: string;
    }>;
  };
  corners: { frame_index: number; position: { x: number; y: number }; kind: "wall_floor" | "wall_ceiling" | "wall_wall" | "opening" | "other"; confidence: number; evidence: string }[];
  surfaces: { frame_index: number; kind: "wall" | "floor" | "ceiling"; polygon: { x: number; y: number }[]; confidence: number; evidence: string }[];
  dimension_estimates: { dimension: "width" | "length" | "height"; meters: number | null; confidence: number; basis: "confirmed_reference" | "visual_estimate" | "insufficient_evidence"; evidence: string }[];
  uncertainties: string[];
  message?: string;
}

function analysisFeatures(result: RoomAnalysisResponse, project: Project): RoomFeature[] {
  const fallbackWalls = ["south", "north", "west", "east"] as const;
  return result.room.features.map((feature, index) => {
    const defaults = FEATURE_DEFAULTS[feature.kind];
    const proposedWall = feature.wall;
    const wall = !proposedWall || proposedWall === "unknown" ? fallbackWalls[index % fallbackWalls.length] : proposedWall;
    const width = feature.width_m ?? defaults.width;
    const depth = feature.depth_m ?? defaults.depth;
    const height = feature.height_m ?? defaults.height;
    const suggestedRatio = Number.isFinite(feature.offset_ratio) ? feature.offset_ratio! : (index + 1) / (result.room.features.length + 1);
    const ratio = Math.max(0.05, Math.min(0.95, suggestedRatio));
    const position = wall === "interior" ? { x: project.room.width * ratio, y: project.room.length / 2 } : pointOnWall(project.room, wall, ratio, depth / 2);
    return {
      id: `ai-feature-${crypto.randomUUID()}`,
      name: feature.label,
      kind: feature.kind,
      position,
      width,
      depth,
      height,
      elevation: feature.elevation_m ?? defaults.elevation,
      wall,
      source: "media_estimate",
      confidence: feature.confidence,
      evidence: feature.evidence,
      confirmed: false,
    };
  });
}

async function fileToAsset(file: File): Promise<MediaAsset> {
  const canPersist = file.size < 3_000_000;
  const dataUrl = canPersist
    ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      })
    : undefined;
  return {
    id: `media-${crypto.randomUUID()}`,
    name: file.name,
    type: file.type.startsWith("video") ? "video" : "image",
    dataUrl,
    privacy: "private",
    size: file.size,
  };
}

export function CapturePanel({ project, update, onContinue }: { project: Project; update: (updater: (project: Project) => Project) => void; onContinue: () => void }) {
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [analysisResult, setAnalysisResult] = useState<RoomAnalysisResponse | null>(null);
  const [guidedScanOpen, setGuidedScanOpen] = useState(false);
  const [planScanOpen, setPlanScanOpen] = useState(false);
  const [keepProportions, setKeepProportions] = useState(true);
  const issues = calculateIssues(project);
  const units = useUnitPreferences();
  const shaped = hasShapedOutline(project.room);
  const scaleConfirmed = project.room.dimensionEvidence.width.confirmedByUser || project.room.dimensionEvidence.length.confirmedByUser;
  const guidedAssets = project.room.mediaAssets.filter((asset) => asset.name.startsWith("guided-"));
  const analysisAssets = guidedAssets.length >= 5 ? [guidedAssets[0], guidedAssets[2], guidedAssets[4]] : project.room.mediaAssets.slice(0, 3);
  const beds = roomBeds(project);
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

  const addMedia = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const normalized = await Promise.all([...files].map(normalizeImageUpload));
      const assets = await Promise.all(normalized.map(fileToAsset));
      updateRoom({ mediaAssets: [...project.room.mediaAssets, ...assets] });
    } catch (error) {
      setAnalysisState("error");
      setAnalysisMessage(error instanceof Error ? error.message : "One of the selected images could not be prepared.");
    }
  };

  const moveMedia = (index: number, offset: number) => {
    const next = [...project.room.mediaAssets];
    const destination = index + offset;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    updateRoom({ mediaAssets: next });
  };

  const analyze = async () => {
    setAnalysisState("loading");
    setAnalysisMessage("");
    try {
      const form = new FormData();
      form.set("project_id", project.id);
      const confirmedDimensions = Object.fromEntries((["width", "length", "height"] as const).flatMap((key) => project.room.dimensionEvidence[key].confirmedByUser ? [[`${key}_m`, project.room[key]]] : []));
      form.set("confirmed_dimensions", JSON.stringify(confirmedDimensions));
      for (const asset of analysisAssets) {
        if (!asset.dataUrl) continue;
        const blob = await fetch(asset.dataUrl).then((response) => response.blob());
        form.append("files", blob, asset.name);
      }
      const result = await apiFetch<RoomAnalysisResponse>("/api/v1/analyze-room", { method: "POST", body: form });
      setAnalysisResult(result);
      const palette: PaletteSwatch[] = result.palette.map((swatch, index) => ({ id: `swatch-ai-${Date.now()}-${index}`, hex: swatch.hex, label: swatch.label, source: swatch.evidence, pinned: false }));
      const detectedFeatures = result.status === "manual_fallback" ? [] : analysisFeatures(result, project);
      const retainedFeatures = project.room.features.filter((feature) => feature.source !== "media_estimate" || feature.confirmed);
      updateRoom({
        palette: palette.length ? palette : project.room.palette,
        features: [...retainedFeatures, ...detectedFeatures],
        reconstructionStatus: result.status === "manual_fallback" ? "manual" : "estimated",
      });
      setAnalysisState("done");
      setAnalysisMessage(result.message ?? "Analysis ready. Confirm the suggested details before using them.");
    } catch (error) {
      setAnalysisState("error");
      setAnalysisMessage(error instanceof Error ? `${error.message} Your measurements remain available for manual editing.` : "Analysis unavailable. Continue with manual measurements.");
    }
  };

  const applyFloorPlan = (result: FloorPlanResult) => {
    update((current) => {
      const evidence = {
        source: result.measured ? "imported_plan" as const : "media_estimate" as const,
        confidence: result.measured ? 0.95 : 0.3,
        confirmedByUser: result.measured,
        note: result.note,
      };
      // Doors and windows read from an earlier plan are replaced unless they were confirmed.
      const retained = current.room.features.filter((feature) => feature.source !== "imported_plan" || feature.confirmed);
      return {
        ...current,
        room: {
          ...current.room,
          width: result.width,
          length: result.length,
          outline: result.outline,
          dimensionEvidence: { ...current.room.dimensionEvidence, width: evidence, length: evidence },
          features: [...retained, ...result.features],
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

  const applyEstimate = (dimension: "width" | "length" | "height", meters: number) => update((current) => ({
    ...current,
    room: {
      ...current.room,
      [dimension]: meters,
      geometryVersion: current.room.geometryVersion + 1,
      dimensionEvidence: { ...current.room.dimensionEvidence, [dimension]: { source: "media_estimate", confidence: analysisResult?.dimension_estimates.find((candidate) => candidate.dimension === dimension)?.confidence ?? 0.4, confirmedByUser: false, note: "OpenAI vision estimate; requires user confirmation" } },
    },
    proposal: current.proposal ? { ...current.proposal, stale: true } : null,
  }));

  return (
    <div className="flow-page capture-page">
      <header className="flow-header">
        <div><p className="eyebrow">Room capture</p><h1>Anchor the room in reality.</h1><p>Media helps us understand the space. Confirmed measurements decide what actually fits.</p></div>
        <button className="primary-button" onClick={onContinue}>Open 3D Studio <ArrowRight size={17} /></button>
      </header>
      <div className="capture-grid">
        <section className="panel-surface form-card">
          <div className="step-heading"><span>1</span><div><h2>Add room media</h2><p>Photos and representative video frames stay private by default.</p></div></div>
          <button className="guided-scan-button" onClick={() => setGuidedScanOpen(true)}><span className="upload-icon"><Camera size={22} /></span><span><strong>Start guided camera scan</strong><small>Capture six overlapping, quality-checked viewpoints</small></span><ArrowRight size={17} /></button>
          <label className="upload-dropzone compact">
            <input type="file" accept="image/*,.heic,.heif,video/*" multiple onChange={(event) => void addMedia(event.target.files)} />
            <span className="upload-icon"><ImagePlus size={22} /></span>
            <strong>Choose photos or a walkthrough</strong>
            <small>HEIC, HEIF, JPEG, PNG, WebP, and video. Images under 3 MB are retained locally.</small>
          </label>
          <div className="media-list">
            {project.room.mediaAssets.map((asset, index) => (
              <div className="media-card" key={asset.id}>
                <div className="media-preview">
                  {asset.type === "image" && asset.dataUrl ? <img src={asset.dataUrl} alt={`Reference ${asset.name}`} /> : asset.type === "video" && asset.dataUrl ? <video src={asset.dataUrl} controls muted aria-label={`Video reference ${asset.name}`} /> : <Video size={25} />}
                </div>
                <div><strong>{asset.name}</strong><small>{asset.type} · private {asset.dataUrl ? "· saved locally" : "· metadata only"}</small></div>
                <div className="media-actions">
                  <button className="icon-button" disabled={index === 0} onClick={() => moveMedia(index, -1)} aria-label="Move media up"><ArrowUp size={14} /></button>
                  <button className="icon-button" disabled={index === project.room.mediaAssets.length - 1} onClick={() => moveMedia(index, 1)} aria-label="Move media down"><ArrowDown size={14} /></button>
                  <button className="icon-button danger" onClick={() => updateRoom({ mediaAssets: project.room.mediaAssets.filter((candidate) => candidate.id !== asset.id) })} aria-label="Remove media"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          <button className="secondary-button full" disabled={!project.room.mediaAssets.length || analysisState === "loading"} onClick={() => void analyze()}>
            {analysisState === "loading" ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />} Analyze selected media
          </button>
          {analysisMessage && <div className={`analysis-message ${analysisState}`}><span>{analysisState === "done" ? <Check size={16} /> : <Upload size={16} />}</span>{analysisMessage}</div>}
          {analysisResult && analysisResult.status !== "manual_fallback" && <div className="scan-findings">
            <div className="subsection-title"><h3>Detected room structure</h3><span>{analysisResult.corners.length} corners</span></div>
            <div className="finding-frames">{analysisAssets.map((asset, index) => <div className="finding-frame" key={asset.id}>
              {asset.dataUrl ? <img src={asset.dataUrl} alt={`Analyzed frame ${index + 1}`} /> : <div className="finding-frame-empty">Frame {index + 1}</div>}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{analysisResult.surfaces.filter((surface) => surface.frame_index === index + 1).map((surface, surfaceIndex) => <polygon key={`${surface.kind}-${surfaceIndex}`} className={surface.kind} points={surface.polygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" ")} />)}</svg>
              {analysisResult.corners.filter((corner) => corner.frame_index === index + 1).map((corner, cornerIndex) => <span key={`${corner.kind}-${cornerIndex}`} className={`finding-point ${corner.kind}`} style={{ left: `${corner.position.x * 100}%`, top: `${corner.position.y * 100}%` }} title={`${corner.kind.replaceAll("_", " ")} · ${Math.round(corner.confidence * 100)}%`}><Crosshair size={13} /></span>)}
              <b>Frame {index + 1}</b>
            </div>)}</div>
            <div className="dimension-suggestions">{analysisResult.dimension_estimates.map((estimate) => <div key={estimate.dimension}><span><strong>{estimate.dimension}</strong><small>{estimate.evidence}</small></span><b>{estimate.meters == null ? "Not enough evidence" : units.formatLength(estimate.meters)}</b>{estimate.meters != null && estimate.basis !== "confirmed_reference" ? <button className="text-button" onClick={() => applyEstimate(estimate.dimension, estimate.meters!)}>Use estimate</button> : <span className={`estimate-basis ${estimate.basis}`}>{estimate.basis === "confirmed_reference" ? "confirmed" : "unverified"}</span>}</div>)}</div>
            {!!analysisResult.uncertainties.length && <div className="finding-uncertainties"><AlertTriangle size={15} /><span><strong>Needs review</strong>{analysisResult.uncertainties.slice(0, 3).map((uncertainty) => <small key={uncertainty}>{uncertainty}</small>)}</span></div>}
          </div>}
        </section>

        <section className="panel-surface form-card">
          <div className="step-heading"><span>2</span><div><h2>Confirm dimensions</h2><p>Enter measurements in your preferred units, or trace the room&rsquo;s shape from a floor plan. These measurements override media estimates.</p></div></div>
          <button className="guided-scan-button plan-scan-button" onClick={() => setPlanScanOpen(true)}><span className="upload-icon"><DraftingCompass size={22} /></span><span><strong>{shaped ? "Rescan the floor plan" : "Scan a floor plan"}</strong><small>Trace the room&rsquo;s walls from a housing plan; one known wall sets the scale</small></span><ArrowRight size={17} /></button>
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
                  {(["user_confirmed", "imported_plan", "scan", "media_estimate"] as EvidenceSource[]).map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}
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
          </div>
          <div className="subsection-title"><h3>Openings & fixed features</h3><button className="text-button" onClick={() => updateRoom({ features: [...project.room.features, { id: `door-${crypto.randomUUID()}`, name: "New door", kind: "door", position: { x: 0.5, y: 0 }, width: 0.9, depth: 0.08, height: 2.03, confirmed: false }] })}><Plus size={15} /> Add</button></div>
          <div className="feature-list">
            {project.room.features.map((feature) => <div className="feature-row" key={feature.id}><span><DoorOpen size={17} /><strong>{feature.name}</strong></span><small>{units.formatLength(feature.width, "object")} wide · {feature.wall && feature.wall !== "unknown" ? `${feature.wall} wall · ` : ""}{feature.confirmed ? "confirmed" : "needs review"}</small><span className="feature-actions">{!feature.confirmed && <button className="text-button" onClick={() => updateRoom({ features: project.room.features.map((candidate) => candidate.id === feature.id ? { ...candidate, confirmed: true } : candidate) })}><Check size={13} /> Confirm</button>}<button className="icon-button danger" onClick={() => updateRoom({ features: project.room.features.filter((candidate) => candidate.id !== feature.id) })} aria-label={`Remove ${feature.name}`}><Trash2 size={13} /></button></span></div>)}
            {!project.room.features.length && <p className="empty-row">No openings added yet. Door clearance remains unknown.</p>}
          </div>
        </section>

        <section className="capture-preview viewport-card">
          <div className="preview-heading"><div><p className="eyebrow">Live scaled preview</p><h2>{units.formatLength(project.room.width)} × {units.formatLength(project.room.length)} × {units.formatLength(project.room.height)}{shaped ? " · traced shape" : ""}</h2><small>{project.room.features.length ? `${project.room.features.length} structural feature${project.room.features.length === 1 ? "" : "s"} modeled` : "Analyze room media to add visible doors, windows, and fixed features."}</small></div>{scaleConfirmed ? <span className="source-chip confirmed"><Check size={13} /> measured shell</span> : <span className="source-chip uncertain"><AlertTriangle size={13} /> estimated shell</span>}</div>
          <div className="capture-canvas"><RoomCanvas project={project} issues={issues} cutaway compact viewCommand={{ type: "reset", nonce: project.room.geometryVersion }} /></div>
          <div className="palette-bar">
            <span><Palette size={16} /> Room palette</span>
            <div>{project.room.palette.map((swatch) => <label key={swatch.id} title={`${swatch.label} · ${swatch.source}`}><input type="color" value={swatch.hex} onChange={(event) => updateRoom({ palette: project.room.palette.map((candidate) => candidate.id === swatch.id ? { ...candidate, hex: event.target.value } : candidate) })} /><i style={{ background: swatch.hex }} /></label>)}<button className="swatch-add" title="Add color" onClick={() => updateRoom({ palette: [...project.room.palette, { id: `swatch-${crypto.randomUUID()}`, hex: "#d5c6ad", label: "manual color", source: "manual selection", pinned: false }] })}><Plus size={15} /></button></div>
            <small>Suggestions only; lighting can shift appearance.</small>
          </div>
        </section>
      </div>
      {planScanOpen && <FloorPlanScan room={project.room} projectId={project.id} onClose={() => setPlanScanOpen(false)} onApply={applyFloorPlan} />}
      {guidedScanOpen && <GuidedRoomScan onClose={() => setGuidedScanOpen(false)} onComplete={(assets, reference) => {
        update((current) => {
          const room = { ...current.room, mediaAssets: [...current.room.mediaAssets, ...assets], reconstructionStatus: "estimated" as const, geometryVersion: current.room.geometryVersion + 1 };
          if (reference) {
            room[reference.dimension] = reference.meters;
            room.dimensionEvidence = { ...room.dimensionEvidence, [reference.dimension]: { source: "user_confirmed" as const, confidence: 1, confirmedByUser: true, note: "Scale reference entered during guided browser scan" } };
          }
          return { ...current, room, proposal: current.proposal ? { ...current.proposal, stale: true } : null };
        });
        setGuidedScanOpen(false);
        setAnalysisMessage(`${assets.length} guided viewpoints added. Analyze them, then review all dimensions.`);
      }} />}
    </div>
  );
}
