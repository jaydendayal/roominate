"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ImagePlus, LoaderCircle, MousePointerClick, Ruler, ScanLine, X } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { apiFetch, normalizeImageUpload } from "@/lib/api";
import { assignOverallDimensions, outlineBox, planOpeningFeatures, planRoomShape, planScale, planWalls, wallMeters, type PlanOpening, type PlanWall } from "@/lib/floorPlan";
import { DEFAULT_TRACE_TOLERANCE, findRoomSeeds, traceFloorPlan, type FloorTrace, type RasterImage, type TraceDetail } from "@/lib/floorPlanTrace";
import { roomArea } from "@/lib/roomShape";
import type { Room, RoomFeature, Vec2 } from "@/lib/types";
import { LengthInput } from "../LengthInput";

/** Longest side, in pixels, of the copy the tracer works on. Plenty for walls; keeps a retrace quick. */
const MAX_TRACE_SIDE = 900;
/** Longest side of the copies sent to read printed dimensions, which need legible text. */
const MAX_READ_SIDE = 2000;
/** Measurements along one axis that differ by more than this are worth a second look. */
const DISAGREEMENT_WARNING = 0.03;

interface LoadedPlan {
  name: string;
  url: string;
  /** The downscaled pixels the tracer works on; overlay coordinates are in this image's pixels. */
  raster: RasterImage;
  /** Likely rooms, best first, for the automatic first trace and "Try another room". */
  seeds: Vec2[];
}

interface FloorPlanReading {
  status: "complete" | "partial" | "manual_fallback" | "cached";
  message: string;
  dimensions: { text: string; meters: number; wall_label: string | null; spans: "wall" | "overall_width" | "overall_length"; confidence: number; evidence: string }[];
  openings: { kind: RoomFeature["kind"]; label: string; wall_label: string | null; position: Vec2; width_ratio: number | null; confidence: number; evidence: string }[];
  uncertainties: string[];
}

export interface FloorPlanResult extends Pick<Room, "width" | "length" | "outline"> {
  /** False when no wall was measured and the size is an estimate. */
  measured: boolean;
  note: string;
  features: RoomFeature[];
}

/** A wall as drawn over the plan: endpoints in the plan image's pixels, plus where its label goes. */
interface WallView extends PlanWall {
  from: Vec2;
  to: Vec2;
  middle: Vec2;
  labelAt: Vec2;
}

/** A measurement pinned to where its wall is on the plan, so it stays with that wall when the trace is adjusted. */
interface Pinned {
  at: Vec2;
  axis: PlanWall["axis"];
}

function decodeImage(url: string) {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image);
}

function drawScaled(image: HTMLImageElement, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser can't read the plan's pixels.");
  // Transparent plans read as paper.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function loadPlan(file: File): Promise<LoadedPlan> {
  const normalized = await normalizeImageUpload(file);
  const url = URL.createObjectURL(normalized);
  try {
    const image = await decodeImage(url).catch(() => {
      throw new Error("That file couldn't be opened as an image. Try a PNG or JPEG screenshot of the plan.");
    });
    const { canvas, context } = drawScaled(image, MAX_TRACE_SIDE);
    const raster = context.getImageData(0, 0, canvas.width, canvas.height);
    return { name: normalized.name, url, raster, seeds: findRoomSeeds(raster) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The plan couldn't be prepared for reading."))), type, 0.92));

/** The plan as uploaded, and a copy with the traced outline and wall letters drawn on, so a reading can name walls. */
async function readingImages(plan: LoadedPlan, overlay: Vec2[], walls: WallView[]) {
  const image = await decodeImage(plan.url);
  const clean = await toBlob(drawScaled(image, MAX_READ_SIDE).canvas, "image/jpeg");
  const { canvas, context } = drawScaled(image, MAX_READ_SIDE);
  const factor = canvas.width / plan.raster.width;
  context.lineWidth = Math.max(2, canvas.width / 320);
  context.strokeStyle = "#d81b72";
  context.beginPath();
  overlay.forEach((point, index) => (index ? context.lineTo(point.x * factor, point.y * factor) : context.moveTo(point.x * factor, point.y * factor)));
  context.closePath();
  context.stroke();
  const size = Math.max(14, canvas.width / 38);
  context.font = `700 ${size}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const wall of walls) {
    const x = wall.labelAt.x * factor;
    const y = wall.labelAt.y * factor;
    const half = size * (0.45 + 0.3 * wall.label.length);
    context.fillStyle = "#ffffff";
    context.fillRect(x - half, y - size * 0.7, half * 2, size * 1.4);
    context.strokeRect(x - half, y - size * 0.7, half * 2, size * 1.4);
    context.fillStyle = "#d81b72";
    context.fillText(wall.label, x, y);
  }
  return { clean, annotated: await toBlob(canvas, "image/jpeg") };
}

const rotateAbout = (point: Vec2, angle: number, center: Vec2): Vec2 => ({
  x: center.x + (point.x - center.x) * Math.cos(angle) - (point.y - center.y) * Math.sin(angle),
  y: center.y + (point.x - center.x) * Math.sin(angle) + (point.y - center.y) * Math.cos(angle),
});

function wallViews(trace: FloorTrace, labelOffset: number): WallView[] {
  return planWalls(trace.outline).map((wall) => {
    const from = rotateAbout(wall.start, trace.angle, trace.center);
    const to = rotateAbout(wall.end, trace.angle, trace.center);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    // The walls run clockwise on screen, so outside is to the left of each one.
    const outward = { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
    return { ...wall, from, to, middle, labelAt: { x: middle.x + outward.x * labelOffset, y: middle.y + outward.y * labelOffset } };
  });
}

/** Index of the wall nearest a pinned spot along the same axis, within `reach` pixels, or -1. */
function matchWall(walls: WallView[], pin: Pinned, reach: number) {
  let best = -1;
  let bestDistance = reach;
  walls.forEach((wall, index) => {
    const distance = Math.hypot(wall.middle.x - pin.at.x, wall.middle.y - pin.at.y);
    if (wall.axis === pin.axis && distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

export function FloorPlanScan({ room, projectId, onClose, onApply }: { room: Room; projectId: string; onClose: () => void; onApply: (result: FloorPlanResult) => void }) {
  const units = useUnitPreferences();
  const [plan, setPlan] = useState<LoadedPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [seed, setSeed] = useState<Vec2 | null>(null);
  const [tolerance, setTolerance] = useState(DEFAULT_TRACE_TOLERANCE);
  const [detail, setDetail] = useState<TraceDetail>("balanced");
  const [straighten, setStraighten] = useState(true);
  // 0–10; each step seals doorways half a percent of the plan's size wider.
  const [doorways, setDoorways] = useState(0);
  const [trace, setTrace] = useState<FloorTrace | null>(null);
  const [tracing, setTracing] = useState(false);
  const [measurements, setMeasurements] = useState<(Pinned & { meters: number })[]>([]);
  const [overall, setOverall] = useState<{ x?: number; y?: number }>({});
  const [reading, setReading] = useState<{ state: "idle" | "loading" | "done" | "error"; message: string; result: FloorPlanReading | null; labels: Record<string, Pinned> }>({ state: "idle", message: "", result: null, labels: {} });
  const [includeOpenings, setIncludeOpenings] = useState(true);

  const activeSeed = seed ?? plan?.seeds[0] ?? null;

  useEffect(() => {
    if (!plan) return;
    setTracing(true);
    // Let "Tracing…" paint before the synchronous work.
    const timer = window.setTimeout(() => {
      const doorwayRadius = Math.round(doorways * Math.max(plan.raster.width, plan.raster.height) * 0.005);
      setTrace(traceFloorPlan(plan.raster, { seed: activeSeed, tolerance, detail, straighten, doorways: doorwayRadius }));
      setTracing(false);
    }, 16);
    return () => window.clearTimeout(timer);
  }, [activeSeed, detail, doorways, plan, straighten, tolerance]);

  useEffect(() => () => {
    if (plan) URL.revokeObjectURL(plan.url);
  }, [plan]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const size = plan ? { width: plan.raster.width, height: plan.raster.height } : { width: 1, height: 1 };
  const labelSize = Math.max(size.width, size.height) * 0.034;
  const walls = useMemo(() => (trace ? wallViews(trace, labelSize * 1.1) : []), [labelSize, trace]);
  const reach = trace ? Math.hypot(outlineBox(trace.outline).width, outlineBox(trace.outline).height) * 0.12 : 0;

  const wallMeasurements = useMemo(() => {
    const byWall: Record<number, number> = {};
    for (const entry of measurements) {
      const index = matchWall(walls, entry, reach);
      if (index >= 0) byWall[index] = entry.meters;
    }
    return byWall;
  }, [measurements, reach, walls]);

  const currentArea = roomArea(room);
  const scale = useMemo(() => (trace ? planScale(trace.outline, { walls: wallMeasurements, overall }, currentArea) : null), [currentArea, overall, trace, wallMeasurements]);
  const shape = useMemo(() => (trace && scale ? planRoomShape(trace.outline, scale) : null), [scale, trace]);

  // A reading names walls by the letters it was shown; follow those walls if the trace has changed since.
  const labelFor = (label: string | null) => {
    const pin = label ? reading.labels[label] : undefined;
    const index = pin ? matchWall(walls, pin, reach) : -1;
    return index >= 0 ? walls[index] : null;
  };
  const printed = reading.result?.dimensions ?? [];
  const printedWidth = printed.find((dimension) => dimension.spans === "overall_width");
  const printedLength = printed.find((dimension) => dimension.spans === "overall_length");
  // Printed overall sizes are matched to the axes by the traced proportions, not by which label they had.
  const overallAxes = trace && printedWidth && printedLength ? assignOverallDimensions(printedWidth.meters, printedLength.meters, trace.outline) : null;

  const choose = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setLoading(true);
    setLoadError("");
    try {
      const loaded = await loadPlan(file);
      setPlan(loaded);
      setSeed(null);
      setDoorways(0);
      setTrace(null);
      setMeasurements([]);
      setOverall({});
      setReading({ state: "idle", message: "", result: null, labels: {} });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The plan couldn't be opened.");
    } finally {
      setLoading(false);
    }
  };

  const tap = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSeed({ x: ((event.clientX - rect.left) / rect.width) * size.width, y: ((event.clientY - rect.top) / rect.height) * size.height });
  };

  const nextRoom = () => {
    if (!plan?.seeds.length) return;
    const current = plan.seeds.findIndex((candidate) => candidate === activeSeed);
    setSeed(plan.seeds[(current + 1) % plan.seeds.length]);
  };

  const measure = (wall: WallView, meters: number | null) => setMeasurements((current) => {
    const others = current.filter((entry) => matchWall(walls, entry, reach) !== wall.index);
    return meters != null && meters > 0 ? [...others, { at: wall.middle, axis: wall.axis, meters }] : others;
  });

  const read = async () => {
    if (!plan || !trace) return;
    setReading((current) => ({ ...current, state: "loading", message: "" }));
    try {
      const { clean, annotated } = await readingImages(plan, trace.overlay, walls);
      const form = new FormData();
      form.set("project_id", projectId);
      form.set("walls", JSON.stringify(walls.map((wall) => ({
        label: wall.label,
        start: { x: wall.from.x / size.width, y: wall.from.y / size.height },
        end: { x: wall.to.x / size.width, y: wall.to.y / size.height },
      }))));
      form.append("files", clean, "floor-plan.jpg");
      form.append("files", annotated, "floor-plan-traced-walls.jpg");
      const result = await apiFetch<FloorPlanReading>("/api/v1/read-floor-plan", { method: "POST", body: form });
      const labels = Object.fromEntries(walls.map((wall) => [wall.label, { at: wall.middle, axis: wall.axis }]));
      setReading({ state: result.status === "manual_fallback" ? "error" : "done", message: result.message, result, labels });
    } catch (error) {
      setReading((current) => ({ ...current, state: "error", message: error instanceof Error ? error.message : "The plan couldn't be read. Enter a wall length you know instead." }));
    }
  };

  const apply = () => {
    if (!plan || !trace || !scale || !shape) return;
    const openings: PlanOpening[] = includeOpenings ? (reading.result?.openings ?? []).map((opening) => ({
      kind: opening.kind,
      label: opening.label,
      wallLabel: labelFor(opening.wall_label)?.label ?? null,
      position: opening.position,
      widthRatio: opening.width_ratio,
      confidence: opening.confidence,
      evidence: opening.evidence,
    })) : [];
    const measuredWalls = Object.keys(wallMeasurements).map((index) => walls[Number(index)]?.label).filter(Boolean);
    const sources = [...measuredWalls.map((label) => `wall ${label}`), ...(overall.x ? ["overall width"] : []), ...(overall.y ? ["overall length"] : [])];
    onApply({
      ...shape,
      measured: scale.measured,
      note: scale.measured ? `Scaled from ${sources.join(" and ")} on floor plan ${plan.name}` : `Proportions traced from floor plan ${plan.name}; size estimated, not measured`,
      features: planOpeningFeatures(openings, trace, size, scale, shape),
    });
  };

  const area = shape ? roomArea(shape) : 0;
  const areaText = units.unitSystem === "imperial" ? `${Math.round(area * 10.7639)} sq ft` : `${area.toFixed(1)} m²`;
  const measuredCount = Object.keys(wallMeasurements).length + (overall.x ? 1 : 0) + (overall.y ? 1 : 0);

  return (
    <div className="scan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-scan-title">
      <div className="scan-shell plan-shell">
        <header>
          <div><p className="eyebrow">Floor plan scan</p><h2 id="plan-scan-title">{plan ? "Check the traced walls" : "Trace your room from a plan"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close floor plan scan"><X size={18} /></button>
        </header>

        {!plan ? (
          <div className="plan-start">
            <label className="upload-dropzone">
              <input type="file" accept="image/*,.heic,.heif" aria-label="Choose a floor plan image" disabled={loading} onChange={(event) => void choose(event.target.files)} />
              <span className="upload-icon">{loading ? <LoaderCircle className="spin" size={22} /> : <ImagePlus size={22} />}</span>
              <strong>{loading ? "Opening the plan…" : "Choose a floor plan image"}</strong>
              <small>A screenshot or photo of your housing plan: PNG, JPEG, WebP, or HEIC. For a PDF, screenshot your room.</small>
            </label>
            <ol className="plan-steps">
              <li><b>01</b><span><strong>Tap your room</strong><small>The outline follows its walls, skipping labels and door swings.</small></span></li>
              <li><b>02</b><span><strong>Check the shape</strong><small>Adjust detail and colour match until the walls line up.</small></span></li>
              <li><b>03</b><span><strong>Enter one wall you know</strong><small>Every other wall scales from it. Without one, the size is an estimate.</small></span></li>
            </ol>
            {loadError && <div className="warning-note"><AlertTriangle size={16} /> {loadError}</div>}
          </div>
        ) : (
          <div className="plan-layout">
            <div className="plan-stage">
              {/* Sized to the plan's exact proportions (and at most 62% of the screen height), so the overlay lines up with the image. */}
              <div className="plan-figure" style={{ aspectRatio: `${size.width} / ${size.height}`, width: `min(100%, calc(62dvh * ${size.width / size.height}))` }}>
                <img src={plan.url} alt={`Floor plan ${plan.name}`} />
                <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" onClick={tap} aria-label="Traced outline over the plan. Click inside another room to trace it instead.">
                  {trace && <polygon className="plan-trace" points={trace.overlay.map((point) => `${point.x},${point.y}`).join(" ")} />}
                  {walls.map((wall) => (
                    <g key={wall.label} className={`plan-wall-tag${wallMeasurements[wall.index] ? " measured" : ""}`} transform={`translate(${wall.labelAt.x} ${wall.labelAt.y})`}>
                      <rect x={-labelSize * (0.42 + 0.3 * wall.label.length)} y={-labelSize * 0.62} width={labelSize * (0.84 + 0.6 * wall.label.length)} height={labelSize * 1.24} rx={labelSize * 0.16} />
                      <text fontSize={labelSize} dy="0.35em">{wall.label}</text>
                    </g>
                  ))}
                  {seed && <g className="plan-seed" transform={`translate(${seed.x} ${seed.y})`}><circle r={labelSize * 0.28} /><path d={`M${-labelSize * 0.6} 0H${labelSize * 0.6}M0 ${-labelSize * 0.6}V${labelSize * 0.6}`} /></g>}
                </svg>
                {tracing && <span className="plan-status"><LoaderCircle className="spin" size={14} /> Tracing…</span>}
              </div>
              <p className="plan-hint"><MousePointerClick size={14} /> Click or tap inside your room on the plan to trace it.{plan.seeds.length > 1 && <> <button className="text-button" onClick={nextRoom}>Try another room</button></>}</p>
              <div className="plan-controls">
                <div className="plan-detail" role="group" aria-label="Trace detail">
                  {(["simple", "balanced", "detailed"] as const).map((option) => <button key={option} type="button" aria-pressed={detail === option} onClick={() => setDetail(option)}>{option[0].toUpperCase() + option.slice(1)}</button>)}
                </div>
                <label className="snap-toggle"><input type="checkbox" checked={straighten} onChange={(event) => setStraighten(event.target.checked)} /><span>Square corners</span></label>
                <label className="plan-tolerance"><span>Colour match</span><input type="range" min={12} max={96} step={2} value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} aria-valuetext={`${tolerance} of 96`} /></label>
                <label className="plan-tolerance" title="Raise this if the outline spills through a doorway into the next room or hall"><span>Seal doorways</span><input type="range" min={0} max={10} step={1} value={doorways} onChange={(event) => setDoorways(Number(event.target.value))} aria-valuetext={doorways ? `${doorways} of 10` : "off"} /></label>
              </div>
              {!tracing && !trace && <div className="warning-note"><AlertTriangle size={16} /> No room found there. Click inside a room on the plan, or loosen the colour match.</div>}
              {!tracing && trace?.touchesEdge && <div className="warning-note"><AlertTriangle size={16} /> The outline runs to the edge of the image, so it may have spilled past your room. Click inside the room, tighten the colour match, or seal doorways.</div>}
            </div>

            <aside className="plan-panel" aria-label="Traced room">
              <div className="plan-result">
                <span className="eyebrow">Traced room</span>
                <strong>{shape ? `${units.formatLength(shape.width)} × ${units.formatLength(shape.length)}` : "—"}</strong>
                <small>{shape ? `${areaText} · ${walls.length} walls` : "Waiting for an outline"}</small>
              </div>
              {scale && (scale.measured
                ? <div className="plan-scale measured"><Ruler size={15} /><span><strong>Measured scale.</strong> Walls without a measurement are scaled from {measuredCount === 1 ? "the one you entered" : "the ones you entered"}.</span></div>
                : <div className="plan-scale"><AlertTriangle size={15} /><span><strong>Scale not measured.</strong> The shape is sized to your current floor area. Enter any wall you know to make it exact.</span></div>)}
              {trace && (overall.x || overall.y
                ? <p className="plan-overall">Overall size set: {overall.x ? units.formatLength(overall.x) : "—"} across × {overall.y ? units.formatLength(overall.y) : "—"} down. <button className="text-button" onClick={() => setOverall({})}>Clear</button></p>
                : <p className="plan-overall">Already measured this room? <button className="text-button" onClick={() => setOverall(assignOverallDimensions(room.width, room.length, trace.outline))}>Use its current size ({units.formatLength(room.width)} × {units.formatLength(room.length)})</button></p>)}
              {scale && scale.disagreement > DISAGREEMENT_WARNING && <div className="warning-note"><AlertTriangle size={16} /> Your measurements disagree by {Math.round(scale.disagreement * 100)}% along one direction. Check them, or clear one.</div>}
              <div className="plan-walls" role="table" aria-label="Walls">
                <div role="row" className="plan-walls-head"><span role="columnheader">Wall</span><span role="columnheader">Traced</span><span role="columnheader">Measured ({units.roomUnit})</span></div>
                {scale && walls.map((wall) => (
                  <div role="row" className="plan-wall-row" key={wall.label}>
                    <b role="cell">{wall.label}</b>
                    <span role="cell">{units.formatLength(wallMeters(wall, scale))}</span>
                    <span role="cell" className="unit-input"><LengthInput aria-label={`Measured length of wall ${wall.label} (${units.roomUnit})`} placeholder="—" min={0} step={units.roomUnit === "ft" ? 0.25 : 0.01} unit={units.roomUnit} meters={wallMeasurements[wall.index] ?? null} onChange={(meters) => measure(wall, meters)} /></span>
                  </div>
                ))}
              </div>

              <div className="plan-read">
                <button className="secondary-button full" disabled={!trace || tracing || reading.state === "loading"} onClick={() => void read()}>
                  {reading.state === "loading" ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />} Read printed dimensions
                </button>
                <small>Sends the plan to the analysis service to read dimension labels, doors, and windows. Nothing is used until you choose it.</small>
                {reading.message && <div className={`analysis-message ${reading.state === "error" ? "error" : "done"}`}><span>{reading.state === "error" ? <AlertTriangle size={16} /> : <Check size={16} />}</span>{reading.message}</div>}
                {reading.result && reading.state === "done" && <>
                  {printed.length ? <ul className="plan-printed" aria-label="Printed dimensions">
                    {printed.map((dimension, index) => {
                      const wall = dimension.spans === "wall" ? labelFor(dimension.wall_label) : null;
                      const axis = dimension.spans === "overall_width" ? "x" : dimension.spans === "overall_length" ? "y" : null;
                      const meters = axis && overallAxes ? overallAxes[axis] : dimension.meters;
                      const name = wall ? `Wall ${wall.label}` : axis === "x" ? "Overall width" : axis === "y" ? "Overall length" : "Unplaced";
                      const used = wall ? wallMeasurements[wall.index] === meters : axis ? overall[axis] === meters : false;
                      return (
                        <li key={`${dimension.text}-${index}`}>
                          <span><strong>{name}</strong><small>“{dimension.text}” · {dimension.evidence}</small></span>
                          <b>{units.formatLength(meters)}</b>
                          {used ? <span className="source-chip confirmed"><Check size={12} /> used</span>
                            : wall ? <button className="text-button" onClick={() => measure(wall, meters)}>Use</button>
                            : axis ? <button className="text-button" onClick={() => setOverall((current) => ({ ...current, [axis]: meters }))}>Use</button>
                            : <span className="source-chip">no wall</span>}
                        </li>
                      );
                    })}
                  </ul> : <p className="plan-empty">No dimensions are printed on this plan.</p>}
                  {!!reading.result.openings.length && <label className="snap-toggle plan-openings"><input type="checkbox" checked={includeOpenings} onChange={(event) => setIncludeOpenings(event.target.checked)} /><span>Add the {reading.result.openings.length} door{reading.result.openings.length === 1 ? "" : "s"} and window{reading.result.openings.length === 1 ? "" : "s"} found, for review</span></label>}
                  {!!reading.result.uncertainties.length && <div className="finding-uncertainties"><AlertTriangle size={15} /><span><strong>Needs review</strong>{reading.result.uncertainties.slice(0, 3).map((uncertainty) => <small key={uncertainty}>{uncertainty}</small>)}</span></div>}
                </>}
              </div>
            </aside>
          </div>
        )}

        <footer className="scan-actions">
          {plan ? <label className="secondary-button plan-replace"><input type="file" accept="image/*,.heic,.heif" aria-label="Choose another floor plan image" onChange={(event) => void choose(event.target.files)} />Choose another plan</label> : <span />}
          <div>
            <button className="secondary-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={!shape || tracing} onClick={apply}><Check size={16} /> Use this shape</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
