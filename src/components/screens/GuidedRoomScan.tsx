"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, X } from "lucide-react";
import type { MediaAsset } from "@/lib/types";

const SHOTS = [
  ["Corner 1", "Stand in a corner and include the floor, both walls, and ceiling line."],
  ["Corner 2", "Move to the next corner. Keep part of the previous wall in view."],
  ["Corner 3", "Continue around the room with overlapping wall details."],
  ["Corner 4", "Capture the final corner and overlap the first wall."],
  ["Doors and windows", "Frame every opening and include the surrounding wall and floor."],
  ["Fixed obstacles", "Capture radiators, columns, built-ins, outlets, or low ceilings."],
] as const;

interface ReferenceMeasurement { dimension: "width" | "length" | "height"; meters: number }

function assessFrame(canvas: HTMLCanvasElement) {
  const sample = document.createElement("canvas");
  sample.width = 64;
  sample.height = 48;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return { acceptable: true, message: "Frame captured." };
  context.drawImage(canvas, 0, 0, 64, 48);
  const pixels = context.getImageData(0, 0, 64, 48).data;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const count = pixels.length / 4;
  const mean = sum / count;
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
  if (mean < 35) return { acceptable: false, message: "This looks too dark. Turn on more lights and retake it." };
  if (mean > 235) return { acceptable: false, message: "This looks overexposed. Point away from bright windows and retake it." };
  if (contrast < 14) return { acceptable: false, message: "The frame has little visible detail. Include textured edges and corners." };
  return { acceptable: true, message: "Good coverage. Continue when ready." };
}

export function GuidedRoomScan({ onClose, onComplete }: { onClose: () => void; onComplete: (assets: MediaAsset[], reference: ReferenceMeasurement | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<"starting" | "ready" | "denied">("starting");
  const [captures, setCaptures] = useState<(MediaAsset | null)[]>(Array(SHOTS.length).fill(null));
  const [quality, setQuality] = useState("");
  const [dimension, setDimension] = useState<ReferenceMeasurement["dimension"]>("width");
  const [meters, setMeters] = useState("");

  useEffect(() => {
    let active = true;
    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("denied"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStatus("ready");
      } catch { setStatus("denied"); }
    };
    void startCamera();
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const result = assessFrame(canvas);
    setQuality(result.message);
    if (!result.acceptable) return;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const next = [...captures];
    next[step] = { id: `scan-${crypto.randomUUID()}`, name: `guided-${step + 1}-${SHOTS[step][0].toLowerCase().replaceAll(" ", "-")}.jpg`, type: "image", dataUrl, privacy: "private", size: Math.round(dataUrl.length * 0.75) };
    setCaptures(next);
  };

  const finish = () => {
    const parsed = Number(meters);
    onComplete(captures.filter((asset): asset is MediaAsset => asset !== null), Number.isFinite(parsed) && parsed > 0 ? { dimension, meters: parsed } : null);
  };

  const capturedCount = captures.filter(Boolean).length;
  return <div className="scan-modal" role="dialog" aria-modal="true" aria-label="Guided room scan">
    <div className="scan-shell">
      <header><div><p className="eyebrow">Guided browser scan</p><h2>{step < SHOTS.length ? SHOTS[step][0] : "Add a scale reference"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close scan"><X size={18} /></button></header>
      <div className="scan-progress">{SHOTS.map((shot, index) => <button key={shot[0]} className={`${index === step ? "active" : ""} ${captures[index] ? "done" : ""}`} onClick={() => setStep(index)} aria-label={`Go to ${shot[0]}`}>{captures[index] ? <Check size={13} /> : index + 1}</button>)}<button className={step === SHOTS.length ? "active" : ""} onClick={() => setStep(SHOTS.length)} aria-label="Go to scale reference">7</button></div>
      {step < SHOTS.length ? <>
        <div className="scan-camera">
          <video ref={videoRef} autoPlay muted playsInline />
          <div className="scan-guide"><span /><span /><span /><span /></div>
          {status === "starting" && <div className="scan-camera-message"><LoaderCircle className="spin" /><strong>Starting camera…</strong></div>}
          {status === "denied" && <div className="scan-camera-message"><AlertTriangle /><strong>Camera unavailable</strong><p>Allow camera access in your browser, or close this guide and upload photos.</p></div>}
          {captures[step]?.dataUrl && <img className="scan-captured-preview" src={captures[step]?.dataUrl} alt={`Captured ${SHOTS[step][0]}`} />}
        </div>
        <div className="scan-instruction"><strong>{SHOTS[step][0]}</strong><p>{SHOTS[step][1]}</p><small>Move slowly, use bright even lighting, and keep the phone upright.</small></div>
        {quality && <div className={`scan-quality ${captures[step] ? "good" : "warning"}`}>{captures[step] ? <Check size={15} /> : <AlertTriangle size={15} />}{quality}</div>}
        <div className="scan-actions"><button className="secondary-button" disabled={step === 0} onClick={() => { setStep(step - 1); setQuality(""); }}><ChevronLeft size={16} /> Back</button><button className="primary-button" disabled={status !== "ready"} onClick={capture}>{captures[step] ? <RotateCcw size={16} /> : <Camera size={16} />}{captures[step] ? "Retake" : "Capture"}</button><button className="secondary-button" disabled={!captures[step]} onClick={() => { setStep(step + 1); setQuality(""); }}>Next <ChevronRight size={16} /></button></div>
      </> : <div className="scan-reference">
        <div className="scan-reference-icon"><Check size={25} /></div><h3>{capturedCount} of {SHOTS.length} viewpoints captured</h3><p>Enter one measurement taken with a tape or trusted measuring tool. It gives the room analysis a real-world scale anchor.</p>
        <div><label>Reference edge<select value={dimension} onChange={(event) => setDimension(event.target.value as ReferenceMeasurement["dimension"])}><option value="width">Room width</option><option value="length">Room length</option><option value="height">Ceiling height</option></select></label><label>Measured distance<div className="unit-input"><input type="number" min="0.1" max="30" step="0.01" value={meters} onChange={(event) => setMeters(event.target.value)} placeholder="e.g. 3.65" /><b>m</b></div></label></div>
        <div className="warning-note"><AlertTriangle size={16} /> Browser photos do not produce LiDAR geometry. Review all estimated dimensions before fit decisions.</div>
        <div className="scan-actions"><button className="secondary-button" onClick={() => setStep(SHOTS.length - 1)}><ChevronLeft size={16} /> Back</button><button className="primary-button" disabled={capturedCount < 4} onClick={finish}><Check size={16} /> Use scan</button></div>
      </div>}
    </div>
  </div>;
}
