"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, House, Menu, RotateCcw, Share2, Users, X } from "lucide-react";
import { useProjectStore } from "@/hooks/useProjectStore";
import { UnitPreferencesProvider, useUnitPreferences } from "@/hooks/useUnitPreferences";
import { calculateIssues, cents, purchaseSubtotal } from "@/lib/calculations";
import type { Project } from "@/lib/types";
import { CapturePanel } from "./screens/CapturePanel";
import { StudioPanel } from "./screens/StudioPanel";
import { ProductsPanel } from "./screens/ProductsPanel";
import { ConstraintsPanel } from "./screens/ConstraintsPanel";
import { IssuesPanel } from "./screens/IssuesPanel";
import { BetterCartPanel } from "./screens/BetterCartPanel";
import { InviteDialog, JoinInvite } from "./Collaboration";
import { Brand, BrandMark } from "./Brand";
import { HomePage } from "./HomePage";
import { personTone } from "./personTones";
import type { ProjectTarget } from "./HomeDiorama";
import { workspaceTabs, type Screen } from "./workspaceTabs";

const CURRENT_PROJECT_KEY = "roominate.currentProject";

/** The project the homepage model shows: the one last opened, else the most recently edited. */
function rememberedProjectId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

function rememberProjectId(id: string) {
  try {
    window.localStorage.setItem(CURRENT_PROJECT_KEY, id);
  } catch {
    // Remembering the model's project is a convenience; the homepage falls back to the latest project.
  }
}

export function RoominateApp() {
  return (
    <UnitPreferencesProvider>
      <RoominateWorkspace />
    </UnitPreferencesProvider>
  );
}

function RoominateWorkspace() {
  const store = useProjectStore();
  const units = useUnitPreferences();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("studio");
  const [mobileNav, setMobileNav] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoProject, setUndoProject] = useState<Project | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const activeProject = store.projects.find((project) => project.id === activeId) ?? null;
  const currentProject = store.projects.find((project) => project.id === currentId)
    ?? [...store.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const formatLength = units.formatLength;
  const issues = useMemo(() => (activeProject ? calculateIssues(activeProject, { formatLength }) : []), [activeProject, formatLength]);
  const subtotal = activeProject ? purchaseSubtotal(activeProject) : { amount: 0, complete: true };

  useEffect(() => {
    setInviteToken(new URL(window.location.href).searchParams.get("invite"));
  }, []);

  useEffect(() => {
    if (store.hydrated) setCurrentId(rememberedProjectId());
  }, [store.hydrated]);

  const chooseCurrent = (id: string) => {
    setCurrentId(id);
    rememberProjectId(id);
  };

  /** Opens a project on the tab its model object stands for; the door opens sharing over the 3D Studio. */
  const openProject = (id: string, target: ProjectTarget = "studio") => {
    chooseCurrent(id);
    setActiveId(id);
    setScreen(target === "share" ? "studio" : target);
    setInviteOpen(target === "share");
  };

  const createRoom = () => openProject(store.createProject(), "capture");

  const clearInviteUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setInviteToken(null);
  };

  if (!store.hydrated) return <div className="loading-screen"><BrandMark size={40} /><p>Opening your room…</p></div>;
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
      openProject(id);
    }} />;
  }
  if (!activeProject) {
    if (!currentProject) return <div className="loading-screen"><BrandMark size={40} /><button className="primary-button" onClick={createRoom}>Create a room</button></div>;
    return (
      <HomePage
        projects={store.projects}
        current={currentProject}
        onChooseCurrent={chooseCurrent}
        onOpen={openProject}
        onCreate={createRoom}
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
          <button className="icon-button desktop-only" onClick={() => setActiveId(null)} aria-label="Back to the room model"><ArrowLeft size={19} /></button>
          <button className="brand-button" onClick={() => setActiveId(null)} aria-label="Roominate home"><Brand compact /></button>
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
            {activeProject.people.map((person) => {
              const tone = personTone(activeProject, person.id);
              return <span key={person.id} style={{ background: tone.fill, color: tone.mark }} title={person.name}>{person.name[0]}</span>;
            })}
          </div>
        </div>
      </header>
      <div className="workspace-body">
        <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
          <div className="mobile-sidebar-head"><strong>Navigate</strong><button className="icon-button" onClick={() => setMobileNav(false)}><X size={18} /></button></div>
          <nav>
            {workspaceTabs.map((item) => {
              const Icon = item.icon;
              const count = item.id === "issues" ? issues.length : item.id === "products" ? activeProject.items.filter((candidate) => candidate.purchaseStatus === "in_cart").length : 0;
              return <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => { setScreen(item.id); setMobileNav(false); }}><i className="nav-index">{item.index}</i><Icon size={17} /><span>{item.label}</span>{count > 0 && <b>{count}</b>}</button>;
            })}
          </nav>
          <div className="sidebar-summary">
            <div><span>Group cart</span><strong>{cents(subtotal.amount)}</strong></div>
            <div className="budget-track"><span style={{ width: `${Math.min(100, (subtotal.amount / activeProject.budgetAmount) * 100)}%` }} /></div>
            <small className={subtotal.amount > activeProject.budgetAmount ? "warn-text" : ""}>{subtotal.amount > activeProject.budgetAmount ? `${cents(subtotal.amount - activeProject.budgetAmount)} over` : `${cents(activeProject.budgetAmount - subtotal.amount)} left`}</small>
          </div>
          <button className="dashboard-link" onClick={() => setActiveId(null)}><House size={17} /><span>Room model</span></button>
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
        {workspaceTabs.slice(1).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}><Icon size={18} /><span>{item.label.replace("3D ", "")}</span>{item.id === "issues" && issues.length > 0 && <b>{issues.length}</b>}</button>;
        })}
      </nav>
      {inviteOpen && <InviteDialog project={activeProject} onClose={() => setInviteOpen(false)} onProjectChange={(project) => store.updateProject(activeProject.id, () => project)} />}
      {notice && <div className="toast"><AlertTriangle size={16} /> {notice}</div>}
    </div>
  );
}
