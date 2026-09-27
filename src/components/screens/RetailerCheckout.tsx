"use client";

import { AlertCircle, ArrowLeft, Check, ExternalLink, ShieldCheck, Store } from "lucide-react";
import { checkoutGroups, safeCheckoutURL } from "@/lib/checkout";
import { cents } from "@/lib/calculations";
import type { Issue, Project } from "@/lib/types";

export function RetailerCheckout({ project, issues, onBack }: { project: Project; issues: Issue[]; onBack: () => void }) {
  const groups = checkoutGroups(project);
  return <section className="panel-surface retailer-checkout">
    <button className="text-button checkout-back" onClick={onBack}><ArrowLeft size={15} /> Back to group cart</button>
    <div className="checkout-heading"><div><p className="eyebrow">Retailer checkout</p><h2>Finish each order at its store.</h2><p>Roominate coordinates the plan. Retailers handle accounts, availability, delivery, tax, payment, and the final order.</p></div><span><ShieldCheck size={20} /> No payment details collected</span></div>
    <div className="checkout-groups">{groups.map((group) => <article key={group.id} className={`checkout-store ${group.id}`}>
      <header><span className="checkout-store-mark"><Store size={19} /></span><div><h3>{group.name}</h3><p>{group.items.length} {group.items.length === 1 ? "item" : "items"} · {group.complete ? cents(group.subtotal) : `${cents(group.subtotal)} + unknown prices`}</p></div>{group.homeURL && <a className="secondary-button small" href={group.homeURL} target="_blank" rel="noopener noreferrer sponsored">Visit store <ExternalLink size={13} /></a>}</header>
      <div className="checkout-items">{group.items.map(({ item, product }) => {
        const url = safeCheckoutURL(product);
        const hasIssue = issues.some((issue) => issue.affectedItemIds.includes(item.id) && issue.severity === "error");
        return <div key={item.id}><span className="checkout-item-state">{hasIssue ? <AlertCircle size={15} /> : <Check size={15} />}</span><span><strong>{item.quantity}× {product.name}</strong><small>{hasIssue ? "Has an unresolved Roominate issue" : item.transform ? "Placement checked" : "Fit unverified"}</small></span><b>{product.price ? cents(product.price.amount * item.quantity) : "Unknown"}</b>{url ? <a href={url} target="_blank" rel="noopener noreferrer sponsored">View product <ExternalLink size={13} /></a> : <span className="checkout-copy-note">No product link available</span>}</div>;
      })}</div>
      <footer>Open each product listing, confirm its variant and availability, then complete checkout on {group.name}. The store button above opens the retailer&rsquo;s main site.</footer>
    </article>)}</div>
    {!groups.length && <div className="retailer-empty"><Store size={28} /><h3>No items to check out</h3><p>Add products to the group cart first.</p></div>}
    <div className="checkout-notice"><AlertCircle size={16} /><span><strong>Before purchasing:</strong> retailer prices, stock, delivery fees, taxes, and product variants may have changed. Roominate never places an external order automatically.</span></div>
  </section>;
}
