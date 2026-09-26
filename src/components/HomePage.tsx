"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { AlertTriangle, CircleDollarSign, Copy, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { calculateIssues, cents, featureWall, itemHasConflict, productFor, purchaseSubtotal } from "@/lib/calculations";
import type { Issue, Project } from "@/lib/types";
import { Brand } from "./Brand";
import type { DioramaTarget } from "./HomeDiorama";
import { shareTarget, workspaceTabs, type Screen } from "./workspaceTabs";

const HomeDiorama = dynamic(() => import("./HomeDiorama"), {
  ssr: false,
  loading: () => <p className="diorama-loading">Building the model…</p>,
});

/** The room in plan, drawn from its real dimensions, features, keep-clear zones, and placed items. */
function PlanThumbnail({ project, issues }: { project: Project; issues: Issue[] }) {
  const { width, length } = project.room;
  const pad = Math.max(width, length) * 0.06;
  return (
    <svg className="plan-thumb" viewBox={`${-pad} ${-pad} ${width + pad * 2} ${length + pad * 2}`} aria-hidden="true">
      <rect className="plan-floor" width={width} height={length} />
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
      <rect className="plan-walls" width={width} height={length} />
      {project.room.features.map((feature) => {
        const wall = featureWall(feature, project);
        const [w, d] = wall === "east" || wall === "west" ? [Math.max(feature.depth, 0.1), feature.width] : [feature.width, Math.max(feature.depth, 0.1)];
        return <rect key={feature.id} className={`plan-feature ${feature.kind}`} x={feature.position.x - w / 2} y={feature.position.y - d / 2} width={w} height={d} />;
      })}
    </svg>
  );
}

interface HomePageProps {
  projects: Project[];
  current: Project;
  onChooseCurrent: (id: string) => void;
  onOpen: (id: string, target?: DioramaTarget) => void;
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
  const issuesByProject = useMemo(() => new Map(projects.map((project) => [project.id, calculateIssues(project)])), [projects]);
  const issues = issuesByProject.get(current.id) ?? [];
  const blocking = issues.filter((issue) => issue.severity === "error").length;
  const subtotal = purchaseSubtotal(current);
  const over = subtotal.amount - current.budgetAmount;
  const { room } = current;
  const roomSize = `${units.formatLength(room.width)} × ${units.formatLength(room.length)}`;

  const status: Record<Screen, string> = {
    capture: roomSize,
    studio: `${current.items.filter((item) => item.transform).length} of ${current.items.length} placed`,
    products: `${current.items.filter((item) => item.purchaseStatus === "in_cart").length} in cart`,
    constraints: `${cents(current.budgetAmount)} budget`,
    issues: issues.length ? `${issues.length} open` : "all clear",
    better: current.proposal ? "proposal ready" : over > 0 ? `${cents(over)} over` : "within budget",
  };

  const legendRow = (target: DioramaTarget) => ({
    type: "button" as const,
    className: active === target ? "active" : undefined,
    onMouseEnter: () => setActive(target),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(target),
    onBlur: () => setActive(null),
    onClick: () => onOpen(current.id, target),
  });
  const ShareIcon = shareTarget.icon;

  return (
    <main className="home-page">
      <header className="home-header">
        <Brand />
        <span className="home-header-note">Projects are saved in this browser</span>
      </header>

      <section className="home-stage" aria-labelledby="home-title">
        <div className="stage-copy">
          {projects.length > 1 ? (
            <label className="room-switch">
              <span>Now planning</span>
              <select value={current.id} onChange={(event) => onChooseCurrent(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          ) : <p className="eyebrow">Now planning</p>}
          <h1 id="home-title">{current.name}</h1>
          <p className="stage-lede">Every part of the plan has a place in this room. Pick an object to open it.</p>
          <ol className="stage-legend">
            {workspaceTabs.map((tab) => (
              <li key={tab.id}>
                <button {...legendRow(tab.id)}>
                  <b>{tab.index}</b>
                  <span><strong>{tab.label}</strong><small>{tab.object} · {tab.summary}</small></span>
                  <em className={tab.id === "issues" && blocking > 0 ? "alert" : undefined}>{status[tab.id]}</em>
                </button>
              </li>
            ))}
            <li>
              <button {...legendRow("share")}>
                <b><ShareIcon size={14} aria-hidden="true" /></b>
                <span><strong>{shareTarget.label}</strong><small>{shareTarget.object} · {shareTarget.summary}</small></span>
                <em>{current.people.length} {current.people.length === 1 ? "person" : "people"}</em>
              </button>
            </li>
          </ol>
        </div>

        <div className="stage-model">
          <div className="diorama-frame" role="img" aria-label={`Miniature model of ${current.name}. Each object opens part of the plan; the list beside it has the same links.`}>
            <HomeDiorama issueCount={issues.length} hasErrors={blocking > 0} active={active} onHover={setActive} onSelect={(target) => onOpen(current.id, target)} />
          </div>
          <p className="stage-hint">Drag to turn the model</p>
          <dl className="title-block">
            <div><dt>Room</dt><dd>{roomSize} · {units.formatLength(room.height)} high</dd></div>
            <div><dt>Group cart</dt><dd className={over > 0 ? "warn-text" : undefined}>{cents(subtotal.amount)} of {cents(current.budgetAmount)}</dd></div>
            <div><dt>Checks</dt><dd>{issues.length ? `${issues.length} open · ${blocking} blocking` : "All clear"}</dd></div>
            <div><dt>Roommates</dt><dd>{current.people.map((person) => person.name).join(", ") || "Just you"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="rooms-section" aria-labelledby="rooms-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Index</p>
            <h2 id="rooms-title">Your rooms</h2>
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
            <small>Photos, video, or measurements</small>
          </button>
        </div>
      </section>
    </main>
  );
}
