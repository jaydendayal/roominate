"use client";

import { FormEvent, useState } from "react";
import { BookOpenCheck, Box, Check, CircleDollarSign, Lock, Plus, ShieldCheck, Trash2, Unlock, UserPlus, Users } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { cents, productFor, purchaseSubtotal } from "@/lib/calculations";
import type { HousingRule, Product, Project } from "@/lib/types";
import { fromUnit } from "@/lib/units";

export function ConstraintsPanel({ project, update }: { project: Project; update: (updater: (project: Project) => Project) => void }) {
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [personName, setPersonName] = useState("");
  const subtotal = purchaseSubtotal(project);
  const units = useUnitPreferences();

  const mutate = (updater: (current: Project) => Project) => update((current) => {
    const next = updater(current);
    return { ...next, cartVersion: current.cartVersion + 1, proposal: current.proposal ? { ...current.proposal, stale: true } : null };
  });

  const addInventory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const productId = `product-${crypto.randomUUID()}`;
    const product: Product = {
      id: productId,
      name: String(form.get("name")),
      store: "Owned item",
      sourceURL: null,
      category: String(form.get("category") || "owned"),
      variant: "",
      dimensions: {
        width: fromUnit(Number(form.get("width")), units.objectUnit),
        depth: fromUnit(Number(form.get("depth")), units.objectUnit),
        height: fromUnit(Number(form.get("height")), units.objectUnit),
      },
      price: null,
      fieldEvidence: { dimensions: { source: "user_confirmed", confidence: 1, confirmedByUser: true } },
      tags: [],
    };
    mutate((current) => ({
      ...current,
      products: [...current.products, product],
      items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId, ownerId: String(form.get("owner")), acquisitionStatus: String(form.get("status")) as "owned" | "planned" | "tentative", purchaseStatus: form.get("status") === "owned" ? "not_purchasing" : "in_cart", quantity: 1, essentiality: "optional", needsServed: [product.category], transform: { position: { x: current.room.width / 2, z: current.room.length / 2 }, rotationY: 0 }, placementType: "floor" }],
    }));
    setInventoryOpen(false);
  };

  const addRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rule: HousingRule = {
      id: `rule-${crypto.randomUUID()}`,
      label: String(form.get("label")),
      text: String(form.get("text")),
      sourceURL: String(form.get("url") || "") || null,
      sourceType: String(form.get("url") || "") ? "official" : "user_note",
      verificationStatus: form.get("verified") ? "confirmed" : "needs_review",
      prohibitedCategories: String(form.get("categories") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      prohibitedTags: String(form.get("tags") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      dismissed: false,
    };
    mutate((current) => ({ ...current, rules: [...current.rules, rule] }));
    setRuleOpen(false);
  };

  return (
    <div className="flow-page constraints-page">
      <header className="flow-header compact-flow-header"><div><p className="eyebrow">Constraints & inventory</p><h1>Define what “works” means.</h1><p>Budget, shared belongings, priorities, and rules all shape the same plan.</p></div></header>
      <div className="constraint-grid">
        <section className="panel-surface constraint-card budget-constraint">
          <div className="constraint-icon amber"><CircleDollarSign size={20} /></div>
          <div className="constraint-head"><div><h2>Spending limit</h2><p>USD · shipping and tax entered separately</p></div><span className={subtotal.amount > project.budgetAmount ? "warn-text" : "good-text"}>{subtotal.amount > project.budgetAmount ? `${cents(subtotal.amount - project.budgetAmount)} over` : `${cents(project.budgetAmount - subtotal.amount)} left`}</span></div>
          <label className="large-money-input"><span>$</span><input aria-label="Budget amount" type="number" min="0" step="25" value={project.budgetAmount / 100} onChange={(event) => mutate((current) => ({ ...current, budgetAmount: Math.max(0, Math.round(Number(event.target.value) * 100)) }))} /><small>group maximum</small></label>
          <div className="budget-track large"><span style={{ width: `${Math.min(100, (subtotal.amount / project.budgetAmount) * 100)}%` }} /></div>
          <div className="constraint-metric"><span>Known cart subtotal</span><strong>{cents(subtotal.amount)}{!subtotal.complete && "+"}</strong></div>
        </section>

        <section className="panel-surface constraint-card">
          <div className="constraint-icon green"><Check size={20} /></div>
          <div className="constraint-head"><div><h2>Priorities & needs</h2><p>Used to rank Better Cart tradeoffs</p></div></div>
          <div className="tag-editor">
            {project.priorities.map((priority) => <span key={priority}>{priority}<button onClick={() => mutate((current) => ({ ...current, priorities: current.priorities.filter((candidate) => candidate !== priority) }))}>×</button></span>)}
            <button onClick={() => { const value = window.prompt("Add a priority"); if (value) mutate((current) => ({ ...current, priorities: [...current.priorities, value] })); }}><Plus size={14} /> Add priority</button>
          </div>
          <h3 className="form-subheading">Required functions</h3>
          <div className="tag-editor needs">
            {project.needs.map((need) => <span key={need}>{need}</span>)}
            <button onClick={() => { const value = window.prompt("Add a need (for example: two study seats)"); if (value) mutate((current) => ({ ...current, needs: [...current.needs, value] })); }}><Plus size={14} /> Add need</button>
          </div>
        </section>

        <section className="panel-surface constraint-card span-2">
          <div className="section-title-row small-row"><div className="constraint-title"><span className="constraint-icon sage"><Users size={20} /></span><div><h2>People & shared inventory</h2><p>Owned items affect fit, never the purchase subtotal.</p></div></div><button className="secondary-button" onClick={() => setInventoryOpen((value) => !value)}><Plus size={16} /> Add inventory</button></div>
          {inventoryOpen && <form className="inline-form" onSubmit={addInventory}>
            <label>Item name<input name="name" required placeholder="Mini fridge" /></label><label>Category<input name="category" required placeholder="appliance" /></label><label>Owner<select name="owner">{project.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label>Status<select name="status"><option value="owned">Owned</option><option value="planned">Planned</option><option value="tentative">Tentative</option></select></label><label>Width ({units.objectUnit})<input name="width" required type="number" min="0.1" step="0.1" /></label><label>Depth ({units.objectUnit})<input name="depth" required type="number" min="0.1" step="0.1" /></label><label>Height ({units.objectUnit})<input name="height" required type="number" min="0.1" step="0.1" /></label><button className="primary-button" type="submit">Add to room</button>
          </form>}
          <div className="people-row">
            {project.people.map((person) => <div className="person-chip" key={person.id}><i style={{ background: person.color }}>{person.name[0]}</i><span><strong>{person.name}</strong><small>{person.id === project.ownerId ? "Project owner" : "Can edit inventory"}</small></span></div>)}
            <form className="add-person" onSubmit={(event) => { event.preventDefault(); if (!personName.trim()) return; mutate((current) => ({ ...current, people: [...current.people, { id: `person-${crypto.randomUUID()}`, name: personName.trim(), color: "#7c7296" }] })); setPersonName(""); }}><UserPlus size={16} /><input aria-label="Roommate name" placeholder="Invite by name" value={personName} onChange={(event) => setPersonName(event.target.value)} /></form>
          </div>
          <div className="inventory-table">
            <div><span>Item</span><span>Owner</span><span>Status</span><span>Dimensions</span><span /></div>
            {project.items.filter((item) => item.acquisitionStatus === "owned" || item.acquisitionStatus === "planned" || item.acquisitionStatus === "tentative").map((item) => {
              const product = productFor(project, item);
              const owner = project.people.find((person) => person.id === item.ownerId);
              return <div key={item.id}><span className="inventory-name"><i><Box size={16} /></i><strong>{product?.name}</strong></span><span>{owner?.name}</span><span className="source-chip">{item.acquisitionStatus}</span><span>{product ? units.formatDimensions(product.dimensions) : "Dimensions unknown"}</span><button className="icon-button" title={item.locked ? "Unlock placement" : "Lock placement"} onClick={() => mutate((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, locked: !candidate.locked } : candidate) }))}>{item.locked ? <Lock size={15} /> : <Unlock size={15} />}</button></div>;
            })}
          </div>
        </section>

        <section className="panel-surface constraint-card span-2">
          <div className="section-title-row small-row"><div className="constraint-title"><span className="constraint-icon coral"><BookOpenCheck size={20} /></span><div><h2>Housing rules</h2><p>Matches are reviewable and always retain their source.</p></div></div><button className="secondary-button" onClick={() => setRuleOpen((value) => !value)}><Plus size={16} /> Add rule</button></div>
          {ruleOpen && <form className="inline-form rule-form" onSubmit={addRule}><label>Policy label<input name="label" required placeholder="Residence hall appliance policy" /></label><label className="wide">Rule text<input name="text" required placeholder="Open-coil appliances are not permitted…" /></label><label>Source URL<input name="url" type="url" placeholder="Optional" /></label><label>Blocked categories<input name="categories" placeholder="heater, candle" /></label><label>Blocked tags<input name="tags" placeholder="open-coil" /></label><label className="checkbox-label"><input type="checkbox" name="verified" /> Confirmed source</label><button className="primary-button" type="submit">Save rule</button></form>}
          <div className="rule-list">
            {project.rules.map((rule) => <article key={rule.id} className={rule.dismissed ? "dismissed" : ""}><span className="rule-shield"><ShieldCheck size={19} /></span><div><div><strong>{rule.label}</strong><span className={`source-chip ${rule.verificationStatus === "confirmed" ? "confirmed" : "uncertain"}`}>{rule.verificationStatus.replace("_", " ")}</span></div><p>{rule.text}</p><small>{rule.sourceURL ? "Linked policy source" : "User-entered note"} · matches {rule.prohibitedCategories.concat(rule.prohibitedTags).join(", ") || "nothing yet"}</small></div><button className="icon-button danger" onClick={() => mutate((current) => ({ ...current, rules: current.rules.filter((candidate) => candidate.id !== rule.id) }))}><Trash2 size={16} /></button></article>)}
            {!project.rules.length && <div className="empty-row">No housing rules added. Automated checks cannot claim an item is prohibited.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

