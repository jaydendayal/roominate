"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, DoorOpen, ImagePlus, LoaderCircle, Palette, Plus, Ruler, ScanLine, Trash2, Upload, Video } from "lucide-react";
import { calculateIssues } from "@/lib/calculations";
import { apiFetch } from "@/lib/api";
import type { EvidenceSource, MediaAsset, PaletteSwatch, Project } from "@/lib/types";
import { RoomCanvas } from "../RoomCanvas";

const sourceLabels: Record<EvidenceSource, string> = {
  user_confirmed: "Measured / confirmed",
  imported_plan: "Housing plan",
  scan: "Device scan",
  media_estimate: "Media estimate",
  url: "Product URL",
  screenshot: "Screenshot",
  demo_fixture: "Demo fixture",
};

interface RoomAnalysisResponse {
  status: "complete" | "manual_fallback" | "cached";
  schema_version: string;
  palette: { hex: string; label: string; confidence: number; evidence: string }[];
  room: { width_m: number | null; length_m: number | null; height_m: number | null; notes: string[] };
  message?: string;
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
  const issues = calculateIssues(project);

  const updateRoom = (patch: Partial<Project["room"]>) => update((current) => ({
    ...current,
    room: { ...current.room, ...patch, geometryVersion: current.room.geometryVersion + 1 },
    proposal: current.proposal ? { ...current.proposal, stale: true } : null,
  }));

  const changeDimension = (key: "width" | "length" | "height", value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    update((current) => ({
      ...current,
      room: { ...current.room, [key]: value, geometryVersion: current.room.geometryVersion + 1 },
      proposal: current.proposal ? { ...current.proposal, stale: true } : null,
    }));
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
    const assets = await Promise.all([...files].map(fileToAsset));
    updateRoom({ mediaAssets: [...project.room.mediaAssets, ...assets] });
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
      form.set("confirmed_dimensions", JSON.stringify({ width_m: project.room.width, length_m: project.room.length, height_m: project.room.height }));
      for (const asset of project.room.mediaAssets.slice(0, 3)) {
        if (!asset.dataUrl) continue;
        const blob = await fetch(asset.dataUrl).then((response) => response.blob());
        form.append("files", blob, asset.name);
      }
      const result = await apiFetch<RoomAnalysisResponse>("/api/v1/analyze-room", { method: "POST", body: form });
      const palette: PaletteSwatch[] = result.palette.map((swatch, index) => ({ id: `swatch-ai-${Date.now()}-${index}`, hex: swatch.hex, label: swatch.label, source: swatch.evidence, pinned: false }));
      updateRoom({ palette: palette.length ? palette : project.room.palette, reconstructionStatus: result.status === "manual_fallback" ? "manual" : "estimated" });
      setAnalysisState("done");
      setAnalysisMessage(result.message ?? "Analysis ready. Confirm the suggested details before using them.");
    } catch (error) {
      setAnalysisState("error");
      setAnalysisMessage(error instanceof Error ? `${error.message} Your measurements remain available for manual editing.` : "Analysis unavailable. Continue with manual measurements.");
    }
  };

  return (
    <div className="flow-page capture-page">
      <header className="flow-header">
        <div><p className="eyebrow">Room capture</p><h1>Anchor the room in reality.</h1><p>Media helps us understand the space. Confirmed measurements decide what actually fits.</p></div>
        <button className="primary-button" onClick={onContinue}>Open 3D Studio <ArrowRight size={17} /></button>
      </header>
      <div className="capture-grid">
        <section className="panel-surface form-card">
          <div className="step-heading"><span>1</span><div><h2>Add room media</h2><p>Photos and representative video frames stay private by default.</p></div></div>
          <label className="upload-dropzone">
            <input type="file" accept="image/*,video/*" multiple onChange={(event) => void addMedia(event.target.files)} />
            <span className="upload-icon"><ImagePlus size={22} /></span>
            <strong>Choose photos or a walkthrough</strong>
            <small>Images under 3 MB are retained locally for this prototype.</small>
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
        </section>

        <section className="panel-surface form-card">
          <div className="step-heading"><span>2</span><div><h2>Confirm dimensions</h2><p>All geometry uses meters internally. These measurements override media estimates.</p></div></div>
          <div className="dimension-fields">
            {(["width", "length", "height"] as const).map((key) => (
              <div className="dimension-field" key={key}>
                <label><span>{key[0].toUpperCase() + key.slice(1)}</span><div className="unit-input"><input type="number" min="0.1" max="30" step="0.01" value={project.room[key]} onChange={(event) => changeDimension(key, Number(event.target.value))} /><b>m</b></div></label>
                <select value={project.room.dimensionEvidence[key].source} onChange={(event) => changeEvidence(key, event.target.value as EvidenceSource)} aria-label={`${key} evidence source`}>
                  {(["user_confirmed", "imported_plan", "scan", "media_estimate"] as EvidenceSource[]).map((source) => <option value={source} key={source}>{sourceLabels[source]}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="evidence-note"><Ruler size={17} /><span><strong>Scale is anchored.</strong> The room has a valid floor and positive confirmed dimensions for placement.</span></div>
          <div className="subsection-title"><h3>Openings & fixed features</h3><button className="text-button" onClick={() => updateRoom({ features: [...project.room.features, { id: `door-${crypto.randomUUID()}`, name: "New door", kind: "door", position: { x: 0.5, z: 0 }, width: 0.9, depth: 0.08, height: 2.03, confirmed: false }] })}><Plus size={15} /> Add</button></div>
          <div className="feature-list">
            {project.room.features.map((feature) => <div className="feature-row" key={feature.id}><span><DoorOpen size={17} /><strong>{feature.name}</strong></span><small>{feature.width.toFixed(2)} m · {feature.confirmed ? "confirmed" : "needs review"}</small></div>)}
            {!project.room.features.length && <p className="empty-row">No openings added yet. Door clearance remains unknown.</p>}
          </div>
        </section>

        <section className="capture-preview viewport-card">
          <div className="preview-heading"><div><p className="eyebrow">Live scaled preview</p><h2>{project.room.width.toFixed(2)} × {project.room.length.toFixed(2)} × {project.room.height.toFixed(2)} m</h2></div><span className="source-chip confirmed"><Check size={13} /> measured</span></div>
          <div className="capture-canvas"><RoomCanvas project={project} issues={issues} cutaway compact viewCommand={{ type: "reset", nonce: project.room.geometryVersion }} /></div>
          <div className="palette-bar">
            <span><Palette size={16} /> Room palette</span>
            <div>{project.room.palette.map((swatch) => <label key={swatch.id} title={`${swatch.label} · ${swatch.source}`}><input type="color" value={swatch.hex} onChange={(event) => updateRoom({ palette: project.room.palette.map((candidate) => candidate.id === swatch.id ? { ...candidate, hex: event.target.value } : candidate) })} /><i style={{ background: swatch.hex }} /></label>)}<button className="swatch-add" title="Add color" onClick={() => updateRoom({ palette: [...project.room.palette, { id: `swatch-${crypto.randomUUID()}`, hex: "#d5c6ad", label: "manual color", source: "manual selection", pinned: false }] })}><Plus size={15} /></button></div>
            <small>Suggestions only; lighting can shift appearance.</small>
          </div>
        </section>
      </div>
    </div>
  );
}
