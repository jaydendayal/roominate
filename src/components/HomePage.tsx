"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleDollarSign, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { calculateIssues, cents, featureWall, itemHasConflict, productFor, purchaseSubtotal } from "@/lib/calculations";
import { roomPolygon } from "@/lib/roomShape";
import type { Issue, Project } from "@/lib/types";
import { Brand } from "./Brand";
import type { DioramaTarget, ProjectTarget } from "./HomeDiorama";
import { roomsTarget, shareTarget, workspaceTabs } from "./workspaceTabs";

const HomeDiorama = dynamic(() => import("./HomeDiorama"), {
  ssr: false,
  loading: () => <p className="diorama-loading">Building the model…</p>,
});

/** The room in plan, north up, drawn from its real dimensions and shape, features, keep-clear zones, and placed items. */
function PlanThumbnail({ project, issues }: { project: Project; issues: Issue[] }) {
  const { width, length } = project.room;
  const pad = Math.max(width, length) * 0.06;
  const outline = roomPolygon(project.room).map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg className="plan-thumb" viewBox={`${-pad} ${-pad} ${width + pad * 2} ${length + pad * 2}`} aria-hidden="true">
      {/* Room Y runs north, SVG y runs down: flip so the plan reads like the drawing it came from. */}
      <g transform={`matrix(1 0 0 -1 0 ${length})`}>
        <polygon className="plan-floor" points={outline} />
        {project.room.clearanceZones.map((zone) => (
          <rect key={zone.id} className="plan-zone" x={zone.position.x - zone.width / 2} y={zone.position.y - zone.depth / 2} width={zone.width} height={zone.depth} />
        ))}
        {project.items.map((item) => {
          const dimensions = productFor(project, item)?.dimensions;
          if (!item.transform || item.purchaseStatus === "deferred" || dimensions?.width == null || dimensions.depth == null) return null;
          const { x, y } = item.transform.position;
          const state = itemHasConflict(issues, item.id) ? "conflict" : item.acquisitionStatus === "owned" ? "owned" : "planned";
          return (
            <rect
              key={item.id}
              className={`plan-item ${state}`}
              x={x - dimensions.width / 2}
              y={y - dimensions.depth / 2}
              width={dimensions.width}
              height={dimensions.depth}
              transform={`rotate(${(item.transform.rotationZ * 180) / Math.PI} ${x} ${y})`}
            />
          );
        })}
        <polygon className="plan-walls" points={outline} />
        {project.room.features.map((feature) => {
          const wall = featureWall(feature, project);
          const [w, d] = wall === "east" || wall === "west" ? [Math.max(feature.depth, 0.1), feature.width] : [feature.width, Math.max(feature.depth, 0.1)];
          return <rect key={feature.id} className={`plan-feature ${feature.kind}`} x={feature.position.x - w / 2} y={feature.position.y - d / 2} width={w} height={d} />;
        })}
      </g>
    </svg>
  );
}

interface HomePageProps {
  projects: Project[];
  current: Project;
  onChooseCurrent: (id: string) => void;
  onOpen: (id: string, target?: ProjectTarget) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onRename: (id: string, name: string) => void;
}

export function HomePage({ projects, current, onChooseCurrent, onOpen, onCreate, onDuplicate, onDelete, onReset, onRename }: HomePageProps) {
  const units = useUnitPreferences();
  const [active, setActive] = useState<DioramaTarget | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const roomsSection = useRef<HTMLElement>(null);
  const roomsHeading = useRef<HTMLHeadingElement>(null);
  const issuesByProject = useMemo(() => new Map(projects.map((project) => [project.id, calculateIssues(project)])), [projects]);
  const issues = issuesByProject.get(current.id) ?? [];
  const blocking = issues.filter((issue) => issue.severity === "error").length;
  const over = purchaseSubtotal(current).amount - current.budgetAmount;
  const roomSize = `${units.formatLength(current.room.width)} × ${units.formatLength(current.room.length)}`;

  const status: Record<DioramaTarget, string> = {
    capture: roomSize,
    studio: `${current.items.filter((item) => item.transform).length} of ${current.items.length} placed`,
    products: `${current.items.filter((item) => item.purchaseStatus === "in_cart").length} in cart`,
    constraints: `${cents(current.budgetAmount)} budget`,
    issues: issues.length ? `${issues.length} open` : "all clear",
    better: current.proposal ? "proposal ready" : over > 0 ? `${cents(over)} over` : "within budget",
    share: `${current.people.length} ${current.people.length === 1 ? "person" : "people"}`,
    rooms: `${projects.length} ${projects.length === 1 ? "room" : "rooms"}`,
  };
  const ShareIcon = shareTarget.icon;
  const RoomsIcon = roomsTarget.icon;

  const selectTarget = (target: DioramaTarget) => {
    if (target !== "rooms") return onOpen(current.id, target);
    roomsSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    roomsHeading.current?.focus({ preventScroll: true });
  };

  return (
    <main className="home-page">
      <header className="home-header">
        <Brand />
        <div className="home-header-meta">
          <span className="home-header-note">Projects are saved in this browser</span>
          <a href="#rooms">Your rooms · {projects.length}</a>
        </div>
      </header>

      {/* The model is the whole first screen. Its callouts are the navigation, and their cards carry the numbers. */}
      <section className="home-stage" aria-labelledby="home-title">
        <h1 id="home-title" className="visually-hidden">{current.name}</h1>
        <div className="stage-model">
          <div className="diorama-frame" role="group" aria-label={`Model of ${current.name}. Each labelled object opens part of the plan.`}>
            <HomeDiorama issueCount={issues.length} hasErrors={blocking > 0} statuses={status} active={active} onHover={setActive} onSelect={selectTarget} />
            <p className="stage-hint">Drag to turn · pick an object to open it</p>
          </div>
        </div>
        {/* On phones the callouts shrink to numbers, so this key spells them out. Hidden on wider screens. */}
        <ol className="stage-index" aria-label="Parts of the plan">
          {workspaceTabs.map((tab) => (
            <li key={tab.id}>
              <button type="button" onClick={() => onOpen(current.id, tab.id)}>
                <b>{tab.index}</b>
                <strong>{tab.label}</strong>
                <em className={tab.id === "issues" && blocking > 0 ? "alert" : undefined}>{status[tab.id]}</em>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => onOpen(current.id, "share")}>
              <b><ShareIcon size={13} aria-hidden="true" /></b>
              <strong>{shareTarget.label}</strong>
              <em>{status.share}</em>
            </button>
          </li>
          <li>
            <button type="button" onClick={() => selectTarget("rooms")}>
              <b><RoomsIcon size={13} aria-hidden="true" /></b>
              <strong>{roomsTarget.label}</strong>
              <em>{status.rooms}</em>
            </button>
          </li>
        </ol>
      </section>

      <section className="rooms-section" id="rooms" ref={roomsSection} aria-labelledby="rooms-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Index</p>
            <h2 id="rooms-title" ref={roomsHeading} tabIndex={-1}>Your rooms</h2>
          </div>
          <div className="section-actions">
            <button className="secondary-button" onClick={onReset}><RotateCcw size={16} /> Reset demo</button>
            <button className="primary-button" onClick={onCreate}><Plus size={16} /> Create a room</button>
          </div>
        </div>
        <div className="project-grid">
          {projects.map((project) => {
            const projectIssues = issuesByProject.get(project.id) ?? [];
            const projectSubtotal = purchaseSubtotal(project);
            const isCurrent = project.id === current.id;
            return (
              <article className={`project-card${isCurrent ? " current" : ""}`} key={project.id}>
                <button className="project-preview" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
                  <PlanThumbnail project={project} issues={projectIssues} />
                  <span className="room-label">{project.roomType}</span>
                  {isCurrent && <span className="current-label">In the model</span>}
                </button>
                <div className="project-card-body">
                  <input
                    className="inline-name"
                    value={project.name}
                    aria-label="Project name"
                    readOnly={project.collaboration?.permission === "view"}
                    onChange={(event) => onRename(project.id, event.target.value)}
                  />
                  <p>Updated {new Date(project.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                  <div className="project-stats">
                    <span><CircleDollarSign size={15} /> {cents(projectSubtotal.amount)} / {cents(project.budgetAmount)}</span>
                    <span className={projectIssues.some((issue) => issue.severity === "error") ? "warn-text" : "good-text"}><AlertTriangle size={15} /> {projectIssues.length} open</span>
                  </div>
                  {pendingDeleteId === project.id ? (
                    <div className="delete-confirm" role="alertdialog" aria-labelledby={`delete-${project.id}`} onKeyDown={(event) => { if (event.key === "Escape") setPendingDeleteId(null); }}>
                      <p id={`delete-${project.id}`}><strong>Delete “{project.name}”?</strong> Its room, cart, and media are removed from this browser. This can’t be undone.</p>
                      <div>
                        <button className="secondary-button small" autoFocus onClick={() => setPendingDeleteId(null)}>Cancel</button>
                        <button className="danger-button small" onClick={() => { onDelete(project.id); setPendingDeleteId(null); }}><Trash2 size={14} /> Delete room</button>
                      </div>
                    </div>
                  ) : (
                    <div className="project-actions">
                      <button className="primary-button small" onClick={() => onOpen(project.id)}>Open room</button>
                      {!isCurrent && <button className="secondary-button small" onClick={() => { onChooseCurrent(project.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Show in model</button>}
                      <button className="icon-button" title="Duplicate" aria-label={`Duplicate ${project.name}`} onClick={() => onDuplicate(project.id)}><Copy size={16} /></button>
                      {project.id !== "project-demo" && <button className="icon-button danger" title="Delete" aria-label={`Delete ${project.name}`} onClick={() => setPendingDeleteId(project.id)}><Trash2 size={16} /></button>}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
          <button className="new-project-card" onClick={onCreate}>
            <Plus size={20} />
            <strong>Start a new room</strong>
            <small>Dorm research, floor plan, or measurements</small>
          </button>
        </div>
      </section>
    </main>
  );
}
