"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Box, Check, Download, LoaderCircle, RefreshCw, RotateCcw, Sparkles, WandSparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { calculateIssues, cents, productFor } from "@/lib/calculations";
import { applyAcceptedProposal, generateProposal } from "@/lib/proposals";
import { downloadShoppingList } from "@/lib/shoppingList";
import type { Issue, Project, Proposal } from "@/lib/types";
import { RoomCanvas } from "../RoomCanvas";

interface ExplanationResponse {
  status: string;
  explanations: { change_id: string; explanation: string }[];
}

function previewWithProposal(project: Project, proposal: Proposal): Project {
  return applyAcceptedProposal({ ...project, proposal: { ...proposal, changes: proposal.changes.map((change) => ({ ...change, accepted: true })) } });
}

export function BetterCartPanel({ project, issues, update, captureUndo }: { project: Project; issues: Issue[]; update: (updater: (project: Project) => Project, captureUndo?: boolean) => void; captureUndo: () => void }) {
  const [generating, setGenerating] = useState(false);
  const [explanationStatus, setExplanationStatus] = useState("");
  const proposal = project.proposal;
  const previewProject = useMemo(() => proposal ? previewWithProposal(project, proposal) : null, [project, proposal]);
  const previewIssues = previewProject ? calculateIssues(previewProject) : [];

  const generate = async () => {
    setGenerating(true);
    setExplanationStatus("");
    const next = generateProposal(project);
    update((current) => ({ ...current, proposal: next }));
    setGenerating(false);
    try {
      const result = await apiFetch<ExplanationResponse>("/api/v1/explain-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id, priorities: project.priorities, changes: next.changes.map((change) => ({ change_id: change.id, deterministic_reason: change.reason, deterministic_impact: change.impact })), before_subtotal_cents: next.beforeSubtotal, after_subtotal_cents: next.afterSubtotal }),
      });
      if (result.status === "manual_fallback" || !result.explanations.length) {
        setExplanationStatus("Deterministic explanations used.");
      } else {
        // Keep the code-generated reason; the model's wording is stored separately and shown alongside it.
        update((current) => current.proposal?.id === next.id ? { ...current, proposal: { ...current.proposal, changes: current.proposal.changes.map((change) => ({ ...change, explanation: result.explanations.find((entry) => entry.change_id === change.id)?.explanation ?? change.explanation })) } } : current);
        setExplanationStatus("AI summaries added beside the code-generated reasons.");
      }
    } catch {
      setExplanationStatus("Deterministic explanations used; AI explanation service was unavailable.");
    }
  };

  const toggle = (id: string, accepted: boolean) => update((current) => current.proposal ? ({ ...current, proposal: { ...current.proposal, changes: current.proposal.changes.map((change) => change.id === id ? { ...change, accepted } : change) } }) : current);
  const apply = () => {
    if (!proposal || proposal.stale || !proposal.changes.some((change) => change.accepted)) return;
    captureUndo();
    update((current) => applyAcceptedProposal(current));
  };

  if (!proposal) {
    return <div className="better-empty-page"><div className="better-orb"><Sparkles size={34} /></div><p className="eyebrow">Better Cart</p><h1>A calmer room starts with<br /><em>a smarter cart.</em></h1><p>Roominate will test smaller alternatives, duplicate coordination, rule-safe removals, and real placements—then explain every tradeoff.</p><div className="better-inputs"><span><Box size={17} /> {project.items.filter((item) => item.purchaseStatus === "in_cart").length} cart items</span><span><AlertTriangle size={17} /> {issues.length} current issues</span><span>{cents(project.budgetAmount)} limit</span></div><div className="header-button-row"><button className="primary-button generate-button" disabled={generating} onClick={() => void generate()}>{generating ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />} Generate Better Cart</button><button className="secondary-button generate-button" onClick={() => downloadShoppingList(project)}><Download size={17} /> Export current list</button></div><small>Optimization and validation run in code. AI is used only for concise explanations when configured.</small></div>;
  }

  return (
    <div className="flow-page better-page">
      <header className="flow-header compact-flow-header"><div><p className="eyebrow">Better Cart proposal</p><h1>Your plan, with fewer compromises.</h1><p>Accept or reject each change. Nothing is applied silently.</p></div><div className="header-button-row"><button className="secondary-button" onClick={() => downloadShoppingList(project)}><Download size={16} /> Export current list</button><button className="secondary-button" onClick={() => void generate()}><RefreshCw size={16} /> Regenerate</button></div></header>
      {proposal.stale && <div className="stale-banner"><AlertTriangle size={18} /><span><strong>This proposal is stale.</strong> The room or cart changed after it was generated. Regenerate before applying.</span></div>}
      <div className="proposal-summary panel-surface">
        <div><span>Before</span><strong>{cents(proposal.beforeSubtotal)}</strong><small>{issues.length} issues</small></div><ArrowRight size={22} /><div className="after"><span>Proposed</span><strong>{cents(proposal.afterSubtotal)}</strong><small>{proposal.remainingIssueIds.length} remain</small></div><div className="savings"><span>You save</span><strong>{cents(Math.max(0, proposal.beforeSubtotal - proposal.afterSubtotal))}</strong><small>{proposal.resolvedIssueIds.length} checks resolved</small></div>
      </div>
      {explanationStatus && <div className="explanation-status"><Sparkles size={14} /> {explanationStatus}</div>}
      <div className="proposal-grid">
        <section className="panel-surface change-list-panel">
          <div className="panel-heading"><div><p className="eyebrow">Suggested changes</p><h2>Choose what to apply</h2></div><span>{proposal.changes.filter((change) => change.accepted).length} accepted</span></div>
          <div className="proposal-changes">
            {proposal.changes.map((change, index) => {
              const item = project.items.find((candidate) => candidate.id === change.itemId);
              const original = item ? productFor(project, item) : null;
              const replacement = project.products.find((product) => product.id === change.replacementProductId);
              return <article className={`${change.accepted === true ? "accepted" : ""} ${change.accepted === false ? "rejected" : ""}`} key={change.id}><div className="change-index">{index + 1}</div><div className="change-copy"><span className="change-type">{change.type}</span><h3>{replacement ? `${original?.name} → ${replacement.name}` : original?.name}</h3><p>{change.reason}</p>{change.explanation && <p className="ai-explanation"><Sparkles size={12} aria-hidden="true" /><span><b>AI summary:</b> {change.explanation}</span></p>}<small>{change.impact} · {change.confidence} evidence</small><div className="change-actions"><button className={change.accepted === true ? "accept active" : "accept"} onClick={() => toggle(change.id, true)}><Check size={15} /> Accept</button><button className={change.accepted === false ? "reject active" : "reject"} onClick={() => toggle(change.id, false)}><X size={15} /> Reject</button></div></div></article>;
            })}
            {!proposal.changes.length && <div className="empty-state"><Check size={27} /><h3>No safe automatic changes found</h3><p>Review remaining constraints or confirm missing measurements before regenerating.</p></div>}
          </div>
          {(proposal.blockers?.length ?? 0) > 0 && <div className="proposal-blockers" role="note"><strong><AlertTriangle size={15} /> Needs a decision from the group</strong><ul>{proposal.blockers!.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
          <div className="apply-bar"><span>{proposal.changes.filter((change) => change.accepted === null).length} decisions left</span><button className="primary-button" disabled={proposal.stale || !proposal.changes.some((change) => change.accepted)} onClick={apply}><Check size={17} /> Apply accepted changes</button></div>
        </section>
        <section className="proposal-preview viewport-card"><div className="preview-heading"><div><p className="eyebrow">Validated preview</p><h2>Proposed arrangement</h2></div><span className="source-chip confirmed"><Check size={13} /> recalculated</span></div><div className="proposal-canvas">{previewProject && <RoomCanvas project={previewProject} issues={previewIssues} cutaway viewCommand={{ type: "reset", nonce: proposal.createdAt.length }} />}</div><div className="preview-footer"><span><Check size={16} /> Prices and collisions recalculated in code</span>{previewIssues.length > 0 && <span className="warn-text"><AlertTriangle size={16} /> {previewIssues.length} remaining checks</span>}</div></section>
      </div>
      <button className="start-over-link" onClick={() => update((current) => ({ ...current, proposal: null }))}><RotateCcw size={15} /> Close proposal and start over</button>
    </div>
  );
}
