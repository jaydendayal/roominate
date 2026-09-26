"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  CircleDollarSign,
  ClipboardList,
  Copy,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  PackageSearch,
  Plus,
  RotateCcw,
  Share2,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useProjectStore } from "@/hooks/useProjectStore";
import { calculateIssues, cents, purchaseSubtotal } from "@/lib/calculations";
import type { Project } from "@/lib/types";
import { CapturePanel } from "./screens/CapturePanel";
import { StudioPanel } from "./screens/StudioPanel";
import { ProductsPanel } from "./screens/ProductsPanel";
import { ConstraintsPanel } from "./screens/ConstraintsPanel";
import { IssuesPanel } from "./screens/IssuesPanel";
import { BetterCartPanel } from "./screens/BetterCartPanel";
import { InviteDialog, JoinInvite } from "./Collaboration";

type Screen = "capture" | "studio" | "products" | "constraints" | "issues" | "better";

const navItems: { id: Screen; label: string; icon: typeof Box }[] = [
  { id: "capture", label: "Room", icon: ImageIcon },
  { id: "studio", label: "3D Studio", icon: Box },
  { id: "products", label: "Products", icon: PackageSearch },
  { id: "constraints", label: "Constraints", icon: SlidersHorizontal },
  { id: "issues", label: "Issues", icon: AlertTriangle },
  { id: "better", label: "Better Cart", icon: Sparkles },
];

function Dashboard({
  projects,
  onOpen,
  onCreate,
  onDuplicate,
  onDelete,
  onReset,
  onRename,
}: {
  projects: Project[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
  onRename: (id: string, name: string) => void;
}) {
  return (
    <main className="dashboard-page">
      <header className="marketing-header">
        <a className="brand" href="#" aria-label="Roominate home">
          <span className="brand-mark"><Box size={18} /></span>
          <span>roominate</span>
        </a>
        <span className="privacy-pill"><span className="status-dot" /> Private by default</span>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">A room that works for everyone</p>
          <h1>Make room for<br /><em>better choices.</em></h1>
          <p className="hero-copy">Plan a shared space, catch expensive mistakes, and build a cart that fits your room and your life.</p>
        </div>
        <button className="primary-button hero-button" onClick={onCreate}><Plus size={18} /> Create a room</button>
      </section>
      <section className="projects-section">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Your spaces</p>
            <h2>Rooms in progress</h2>
          </div>
          <button className="secondary-button" onClick={onReset}><RotateCcw size={16} /> Reset demo</button>
        </div>
        <div className="project-grid">
          {projects.map((project) => {
            const issues = calculateIssues(project);
            const subtotal = purchaseSubtotal(project);
            return (
              <article className="project-card" key={project.id}>
                <button className="project-preview" onClick={() => onOpen(project.id)} aria-label={`Open ${project.name}`}>
                  <div className="mini-room">
                    <span className="mini-bed" />
                    <span className="mini-desk" />
                    <span className="mini-rug" />
                  </div>
                  <span className="room-label">{project.roomType}</span>
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
                    <span><CircleDollarSign size={15} /> {cents(subtotal.amount)} / {cents(project.budgetAmount)}</span>
                    <span className={issues.some((issue) => issue.severity === "error") ? "warn-text" : "good-text"}><AlertTriangle size={15} /> {issues.length} open</span>
                  </div>
                  <div className="project-actions">
                    <button className="primary-button small" onClick={() => onOpen(project.id)}>Open room</button>
                    <button className="icon-button" title="Duplicate" onClick={() => onDuplicate(project.id)}><Copy size={16} /></button>
                    {project.id !== "project-demo" && <button className="icon-button danger" title="Delete" onClick={() => onDelete(project.id)}><Trash2 size={16} /></button>}
                  </div>
                </div>
              </article>
            );
          })}
          <button className="new-project-card" onClick={onCreate}>
            <span><Plus size={22} /></span>
            <strong>Start a new room</strong>
            <small>Photos, video, or measurements</small>
          </button>
        </div>
      </section>
    </main>
  );
}

export function RoominateApp() {
  const store = useProjectStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("studio");
  const [mobileNav, setMobileNav] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoProject, setUndoProject] = useState<Project | null>(null);
  const activeProject = store.projects.find((project) => project.id === activeId) ?? null;
  const issues = useMemo(() => (activeProject ? calculateIssues(activeProject) : []), [activeProject]);
  const subtotal = activeProject ? purchaseSubtotal(activeProject) : { amount: 0, complete: true };

  useEffect(() => {
    setInviteToken(new URL(window.location.href).searchParams.get("invite"));
  }, []);

  const clearInviteUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setInviteToken(null);
  };

  if (!store.hydrated) return <div className="loading-screen"><span className="brand-mark"><Box /></span><p>Opening your room…</p></div>;
  if (inviteToken) {
    return <JoinInvite token={inviteToken} onCancel={clearInviteUrl} onJoined={(accepted) => {
      const imported: Project = {
        ...accepted.project,
        ownerId: accepted.participant_id,
        collaboration: {
          token: inviteToken,
          participantId: accepted.participant_id,
          permission: accepted.permission,
          revision: accepted.revision,
          expiresAt: accepted.expires_at,
        },
      };
      const id = store.importProject(imported);
      clearInviteUrl();
      setActiveId(id);
      setScreen("studio");
    }} />;
  }
  if (!activeProject) {
    return (
      <Dashboard
        projects={store.projects}
        onOpen={setActiveId}
        onCreate={() => { const id = store.createProject(); setActiveId(id); setScreen("capture"); }}
        onDuplicate={(id) => store.duplicateProject(id)}
        onDelete={store.deleteProject}
        onReset={store.resetDemo}
        onRename={(id, name) => store.updateProject(id, (project) => ({ ...project, name }))}
      />
    );
  }

  const update = (updater: (project: Project) => Project, captureUndo = false) => {
    if (activeProject.collaboration?.permission === "view") {
      setNotice("This invitation is view-only. Ask the owner for an edit link.");
      window.setTimeout(() => setNotice(""), 2600);
      return;
    }
    if (captureUndo) setUndoProject(structuredClone(activeProject));
    store.updateProject(activeProject.id, updater);
  };

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="header-left">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <button className="icon-button desktop-only" onClick={() => setActiveId(null)} aria-label="Back to dashboard"><ArrowLeft size={19} /></button>
          <a className="brand compact" onClick={() => setActiveId(null)}><span className="brand-mark"><Box size={17} /></span><span>roominate</span></a>
          <span className="header-divider" />
          <div>
            <strong className="project-title">{activeProject.name}</strong>
            {activeProject.collaboration?.permission === "view" ? <span className="save-state saved"><Users size={12} />view only</span> : <span className={`save-state ${store.saveState}`}>{store.saveState === "saved" ? <Check size={12} /> : null}{store.saveState}</span>}
          </div>
        </div>
        <div className="header-actions">
          {undoProject && <button className="secondary-button compact-button" onClick={() => { update(() => undoProject); setUndoProject(null); }}><RotateCcw size={15} /> Undo</button>}
          <button className="secondary-button compact-button" onClick={() => setInviteOpen(true)}><Share2 size={15} /><span className="desktop-only">Share</span></button>
          <div className="avatars" aria-label="Collaborators">
            {activeProject.people.map((person) => <span key={person.id} style={{ background: person.color }} title={person.name}>{person.name[0]}</span>)}
          </div>
        </div>
      </header>
      <div className="workspace-body">
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="mobile-sidebar-head"><strong>Navigate</strong><button className="icon-button" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
          <nav>
            {navItems.map((item) => {
              const Icon = item.icon;
              const count = item.id === "issues" ? issues.length : item.id === "products" ? activeProject.items.filter((candidate) => candidate.purchaseStatus === "in_cart").length : 0;
              return <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => { setScreen(item.id); setMobileNav(false); }}><Icon size={18} /><span>{item.label}</span>{count > 0 && <b>{count}</b>}</button>;
            })}
          </nav>
          <div className="sidebar-summary">
            <div><span>Group cart</span><strong>{cents(subtotal.amount)}</strong></div>
            <div className="budget-track"><span style={{ width: `${Math.min(100, (subtotal.amount / activeProject.budgetAmount) * 100)}%` }} /></div>
            <small className={subtotal.amount > activeProject.budgetAmount ? "warn-text" : ""}>{subtotal.amount > activeProject.budgetAmount ? `${cents(subtotal.amount - activeProject.budgetAmount)} over` : `${cents(activeProject.budgetAmount - subtotal.amount)} left`}</small>
          </div>
          <button className="dashboard-link" onClick={() => setActiveId(null)}><LayoutDashboard size={17} /> All rooms</button>
        </aside>
        <main className="workspace-main">
          {screen === "capture" && <CapturePanel project={activeProject} update={update} onContinue={() => setScreen("studio")} />}
          {screen === "studio" && <StudioPanel project={activeProject} issues={issues} update={update} onOpenProducts={() => setScreen("products")} onOpenIssues={() => setScreen("issues")} />}
          {screen === "products" && <ProductsPanel project={activeProject} issues={issues} update={update} />}
          {screen === "constraints" && <ConstraintsPanel project={activeProject} update={update} />}
          {screen === "issues" && <IssuesPanel project={activeProject} issues={issues} update={update} onSelectItem={() => setScreen("studio")} />}
          {screen === "better" && <BetterCartPanel project={activeProject} issues={issues} update={update} captureUndo={() => setUndoProject(structuredClone(activeProject))} />}
        </main>
      </div>
      <nav className="mobile-tabs" aria-label="Workspace sections">
        {navItems.slice(1).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}><Icon size={18} /><span>{item.label.replace("3D ", "")}</span>{item.id === "issues" && issues.length > 0 && <b>{issues.length}</b>}</button>;
        })}
      </nav>
      {inviteOpen && <InviteDialog project={activeProject} onClose={() => setInviteOpen(false)} onProjectChange={(project) => store.updateProject(activeProject.id, () => project)} />}
      {notice && <div className="toast"><AlertTriangle size={16} /> {notice}</div>}
    </div>
  );
}
