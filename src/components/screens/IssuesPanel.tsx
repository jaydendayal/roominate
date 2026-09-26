"use client";

import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Box, Check, ChevronRight, CircleDollarSign, CopyCheck, DoorOpen, Eye, FileQuestion, Scale, Users } from "lucide-react";
import { cents, duplicateKey, productFor } from "@/lib/calculations";
import type { Issue, IssueType, Project } from "@/lib/types";

const groups: { type: IssueType; label: string; icon: typeof AlertTriangle }[] = [
  { type: "fit", label: "Physical fit", icon: Box },
  { type: "clearance", label: "Access & clearance", icon: DoorOpen },
  { type: "budget", label: "Budget", icon: CircleDollarSign },
  { type: "duplicate", label: "Group duplicates", icon: CopyCheck },
  { type: "rule", label: "Housing rules", icon: Scale },
  { type: "missing_data", label: "Missing information", icon: FileQuestion },
  { type: "unmet_need", label: "Unmet needs", icon: AlertCircle },
];

export function IssuesPanel({ project, issues, update, onSelectItem }: { project: Project; issues: Issue[]; update: (updater: (project: Project) => Project) => void; onSelectItem: (id: string) => void }) {
  const [filter, setFilter] = useState<IssueType | "all">("all");
  const shown = useMemo(() => filter === "all" ? issues : issues.filter((issue) => issue.type === filter), [filter, issues]);
  const countErrors = issues.filter((issue) => issue.severity === "error").length;

  const resolveDuplicate = (issue: Issue, action: "intentional" | "coordinate" | "keep", keepItemId?: string) => {
    const a = project.items.find((item) => item.id === issue.affectedItemIds[0]);
    const b = project.items.find((item) => item.id === issue.affectedItemIds[1]);
    if (!a || !b) return;
    const key = duplicateKey(a, b);
    update((current) => ({
      ...current,
      duplicateResolutions: {
        ...current.duplicateResolutions,
        [key]: action === "intentional" ? { action, note: "Collaborators confirmed both are needed." } : action === "coordinate" ? { action, buyerId: current.ownerId } : { action, keepItemId: keepItemId! },
      },
      items: action === "keep" ? current.items.map((item) => issue.affectedItemIds.includes(item.id) && item.id !== keepItemId ? { ...item, purchaseStatus: "deferred" as const, transform: null } : item) : current.items,
      cartVersion: current.cartVersion + 1,
      proposal: current.proposal ? { ...current.proposal, stale: true } : null,
    }));
  };

  return (
    <div className="flow-page issues-page">
      <header className="flow-header compact-flow-header"><div><p className="eyebrow">Live plan checks</p><h1>{issues.length ? `${issues.length} things deserve attention.` : "Everything checks out."}</h1><p>Every warning comes from current room, cart, inventory, and rule data.</p></div><div className="issue-summary"><span className="error"><AlertTriangle size={17} /> {countErrors} must fix</span><span><AlertCircle size={17} /> {issues.length - countErrors} review</span></div></header>
      <div className="issue-filter-row"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{issues.length}</span></button>{groups.map((group) => { const count = issues.filter((issue) => issue.type === group.type).length; return count ? <button key={group.type} className={filter === group.type ? "active" : ""} onClick={() => setFilter(group.type)}>{group.label} <span>{count}</span></button> : null; })}</div>
      <div className="issues-content">
        {groups.map((group) => {
          const groupIssues = shown.filter((issue) => issue.type === group.type);
          if (!groupIssues.length) return null;
          const Icon = group.icon;
          return <section className="issue-group" key={group.type}><div className="issue-group-title"><span><Icon size={18} /></span><h2>{group.label}</h2><b>{groupIssues.length}</b></div><div className="issue-card-list">{groupIssues.map((issue) => <article className={`issue-card ${issue.severity}`} key={issue.id}>
            <span className="severity-icon">{issue.severity === "error" ? <AlertTriangle size={19} /> : <AlertCircle size={19} />}</span>
            <div className="issue-copy"><div className="issue-title-line"><h3>{issue.message}</h3><span className={`source-chip ${issue.confidence === "confirmed" ? "confirmed" : "uncertain"}`}>{issue.confidence}</span></div><p>{issue.detail}</p>
              {issue.affectedItemIds.length > 0 && <div className="affected-items">{issue.affectedItemIds.map((id) => { const item = project.items.find((candidate) => candidate.id === id); const product = item ? productFor(project, item) : null; const owner = project.people.find((person) => person.id === item?.ownerId); return <button key={id} onClick={() => onSelectItem(id)}><Box size={14} /><span>{product?.name}<small>{owner?.name}{product?.price ? ` · ${cents(product.price.amount)}` : ""}</small></span><Eye size={14} /></button>; })}</div>}
              {issue.type === "duplicate" ? <div className="resolution-box"><strong><Users size={16} /> Resolve together</strong><div><button className="secondary-button small" onClick={() => resolveDuplicate(issue, "intentional")}>Both are intentional</button>{issue.affectedItemIds.map((id) => { const item = project.items.find((candidate) => candidate.id === id); const owner = project.people.find((person) => person.id === item?.ownerId); return <button className="secondary-button small" key={id} onClick={() => resolveDuplicate(issue, "keep", id)}>Keep {owner?.name}’s</button>; })}<button className="secondary-button small" onClick={() => resolveDuplicate(issue, "coordinate")}>Coordinate buyer</button></div></div> : <div className="suggestion-row">{issue.suggestedActions.map((action) => <span key={action}>{action}</span>)}</div>}
            </div><button className="icon-button" onClick={() => issue.affectedItemIds[0] && onSelectItem(issue.affectedItemIds[0])}><ChevronRight size={18} /></button>
          </article>)}</div></section>;
        })}
        {!shown.length && <div className="panel-surface empty-state success-empty"><span><Check size={26} /></span><h2>No open issues in this view</h2><p>Checks will recalculate whenever the room, placement, cart, or constraints change.</p></div>}
      </div>
    </div>
  );
}
