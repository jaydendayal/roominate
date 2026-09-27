"use client";

import { useState } from "react";
import { AlertCircle, Building2, Check, DraftingCompass, ExternalLink, Link2, LoaderCircle, Search, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";

const COLLEGE_SUGGESTIONS = [
  "Georgia Institute of Technology",
  "University of Georgia",
  "Massachusetts Institute of Technology",
  "New York University",
  "Stanford University",
  "University of California, Berkeley",
  "University of California, Los Angeles",
  "University of Michigan",
] as const;

interface Evidence {
  source_url: string;
  quote: string;
}

export interface DormResearchResult {
  status: "complete" | "partial" | "cached";
  college: string;
  residence_hall: string | null;
  room_type: string | null;
  room_width_m: number | null;
  room_length_m: number | null;
  room_height_m: number | null;
  room_confidence: number;
  room_evidence: Evidence[];
  items: Array<{
    name: string;
    category: "bed" | "desk" | "dresser" | "wardrobe" | "chair" | "bookshelf" | "mini_fridge" | "other";
    width_m: number | null;
    depth_m: number | null;
    height_m: number | null;
    quantity: number;
    included_with_room: boolean;
    confidence: number;
    evidence: Evidence[];
  }>;
  uncertainties: string[];
  sources: Array<{ source_url: string; raw_hash: string; fetched_at: string; fetch_method: string }>;
  discovered_sources?: Array<{ url: string; title: string }>;
  failures: Array<{ source_url: string; error: string }>;
  needs_manual_sources?: boolean;
  message: string;
}

function sourceLabel(url: string, title?: string) {
  if (title?.trim()) return title;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function DormResearch({ projectId, onApply, onOpenFloorPlan }: { projectId: string; onApply: (result: DormResearchResult) => void; onOpenFloorPlan: () => void }) {
  const [college, setCollege] = useState("");
  const [hall, setHall] = useState("");
  const [roomType, setRoomType] = useState("");
  const [urls, setUrls] = useState("");
  const [showManualSources, setShowManualSources] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DormResearchResult | null>(null);
  const units = useUnitPreferences();

  const updateSearchTerm = (setter: (value: string) => void, value: string) => {
    setter(value);
    setResult(null);
    setApplied(false);
    setState("idle");
    setError("");
  };

  const research = async () => {
    const sourceUrls = urls.split(/\s+/).map((url) => url.trim()).filter(Boolean);
    if (!college.trim() || !hall.trim()) {
      setError("Enter both your school and dorm or residence hall.");
      setState("error");
      return;
    }
    if (sourceUrls.length > 5) {
      setError("Add no more than five source links.");
      setState("error");
      return;
    }
    setState("loading");
    setError("");
    try {
      const response = await apiFetch<DormResearchResult>("/api/v1/research-dorm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, college: college.trim(), residence_hall: hall.trim(), room_type: roomType.trim() || null, urls: sourceUrls }),
      });
      const resolved = response.room_type || !roomType.trim() ? response : { ...response, room_type: roomType.trim() };
      setResult(resolved);
      const usable = [resolved.room_width_m, resolved.room_length_m, resolved.room_height_m].some((value) => value !== null)
        || resolved.items.some((item) => item.included_with_room && [item.width_m, item.depth_m, item.height_m].some((value) => value !== null));
      if (usable) {
        onApply(resolved);
        setApplied(true);
      }
      setShowManualSources(Boolean(resolved.needs_manual_sources));
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dorm research failed.");
      setShowManualSources(true);
      setState("error");
    }
  };

  const roomDimensions = result ? [result.room_width_m, result.room_length_m, result.room_height_m] : [];
  const hasRoomDimensions = roomDimensions.some((value) => value !== null);
  const hasUsableFurniture = result?.items.some((item) => item.included_with_room && [item.width_m, item.depth_m, item.height_m].some((value) => value !== null)) ?? false;
  const canApply = hasRoomDimensions || hasUsableFurniture;
  const enteredSources = urls.split(/\s+/).map((url) => url.trim()).filter(Boolean);

  return <section className="dorm-research">
    <div className="subsection-title"><h3><Building2 size={17} /> Research your dorm</h3><span>Official sources + OpenAI extraction</span></div>
    <p className="dorm-research-intro">Enter your school and dorm. Roominate searches for official housing pages, extracts labeled room and furniture dimensions, and leaves every result unconfirmed until you review it.</p>
    <div className="form-grid">
      <label>School<input list="roominate-colleges" value={college} onChange={(event) => updateSearchTerm(setCollege, event.target.value)} placeholder="e.g. Georgia Institute of Technology" autoComplete="organization" /></label>
      <datalist id="roominate-colleges">{COLLEGE_SUGGESTIONS.map((name) => <option key={name} value={name} />)}</datalist>
      <label>Dorm or residence hall<input value={hall} onChange={(event) => updateSearchTerm(setHall, event.target.value)} placeholder="e.g. Glenn Hall" /></label>
      <label className="span-2">Room design or type (optional)<input value={roomType} onChange={(event) => updateSearchTerm(setRoomType, event.target.value)} placeholder="e.g. Traditional double" /></label>
      {showManualSources && <label className="span-2">Official housing or furniture links<textarea rows={3} value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={"One public URL per line\nhttps://housing.example.edu/halls/example"} /><small>Use up to five public pages from the school. These links replace the automatic search results for this retry.</small></label>}
    </div>
    <button className="secondary-button full" disabled={state === "loading"} onClick={() => void research()}>{state === "loading" ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} {enteredSources.length ? "Research with added links" : "Search official dorm sources"}</button>
    {!showManualSources && <button className="text-button dorm-add-sources" type="button" onClick={() => setShowManualSources(true)}><Link2 size={13} /> Add official links instead</button>}
    {error && <div className="analysis-message error"><AlertCircle size={16} /> {error}</div>}
    {result && <div className="dorm-results">
      <header><span><Sparkles size={17} /><span><strong>{result.residence_hall || result.college}</strong><small>{result.room_type || "Room type not identified"} · {Math.round(result.room_confidence * 100)}% evidence confidence</small></span></span>{hasRoomDimensions && <b>{roomDimensions.map((value) => value !== null ? units.formatLength(value) : "?").join(" × ")}</b>}</header>
      <div className={`analysis-message ${result.needs_manual_sources ? "error" : ""}`}><AlertCircle size={16} /> {result.message}</div>
      {!!result.items.length && <div className="dorm-items">{result.items.map((item, index) => <div key={`${item.name}-${index}`}><span><strong>{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}</strong><small>{item.included_with_room ? "Provided by housing" : "Mentioned, not confirmed as provided"} · {Math.round(item.confidence * 100)}%</small></span><b>{[item.width_m, item.depth_m, item.height_m].map((value) => value !== null ? units.formatLength(value, "object") : "?").join(" × ")}</b></div>)}</div>}
      {!!result.uncertainties.length && <div className="warning-note"><AlertCircle size={16} /><span>{result.uncertainties.slice(0, 3).join(" ")}</span></div>}
      <div className="dorm-sources">
        {result.sources.map((source) => <a key={source.source_url} href={source.source_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {sourceLabel(source.source_url)}</a>)}
        {(result.discovered_sources ?? []).filter((source) => !result.sources.some((fetched) => fetched.source_url === source.url)).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {sourceLabel(source.url, source.title)}</a>)}
      </div>
      {canApply && <button className={applied ? "secondary-button full" : "primary-button full"} onClick={() => { onApply(result); setApplied(true); }}><Check size={16} /> {applied ? "Added to 3D room · reapply" : "Add all to 3D room"}</button>}
    </div>}
    <div className={`dorm-plan-option${result?.needs_manual_sources ? " recommended" : ""}`}>
      <span><DraftingCompass size={17} /></span>
      <div><strong>Have a floor plan or room diagram?</strong><small>Upload a screenshot or photo. After you select the room, OpenAI reads visible printed dimensions while code traces and scales the walls.</small></div>
      <button className="secondary-button small" type="button" onClick={onOpenFloorPlan}>Upload diagram</button>
    </div>
  </section>;
}
