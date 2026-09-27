"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CreditCard, LoaderCircle, RefreshCw, Send, ShieldCheck, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cents, productFor } from "@/lib/calculations";
import type { Project } from "@/lib/types";

interface Transfer {
  id: string;
  debtor_id: string;
  debtor_name: string;
  creditor_id: string;
  creditor_name: string;
  amount_cents: number;
  description: string;
}

interface Preview {
  id: string;
  total_cents: number;
  transfers: Transfer[];
  calculation: "equal_split_exact_cents";
  visa: VisaStatus;
}

interface VisaStatus {
  provider: string;
  mode: "demo" | "sandbox";
  configured: boolean;
  message: string;
}

interface PaymentRequest {
  id: string;
  transfer_id: string;
  provider: "demo" | "sandbox";
  status: "pending" | "accepted" | "completed" | "rejected" | "cancelled";
  creditor_alias: string;
  debtor_alias: string;
  amount_cents?: number;
  debtor_name?: string;
  creditor_name?: string;
}

export function SettlementPanel({ project, onBack }: { project: Project; onBack: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [visa, setVisa] = useState<VisaStatus | null>(null);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [aliasType, setAliasType] = useState<"MOBL" | "EMAIL">("MOBL");
  const [requests, setRequests] = useState<Record<string, PaymentRequest>>({});
  const expenses = useMemo(() => project.items
    .filter((item) => item.purchaseStatus === "in_cart")
    .flatMap((item) => {
      const product = productFor(project, item);
      return product?.price ? [{ item_id: item.id, label: product.name, paid_by_person_id: item.ownerId, amount_cents: product.price.amount * item.quantity }] : [];
    }), [project]);
  const missingPriceCount = project.items.filter((item) => item.purchaseStatus === "in_cart" && !productFor(project, item)?.price).length;

  useEffect(() => {
    void apiFetch<VisaStatus>("/api/v1/visa/request-to-pay/status").then(setVisa).catch(() => setVisa(null));
  }, []);

  const calculate = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<Preview>("/api/v1/settlements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id, currency: "USD", people: project.people.map(({ id, name }) => ({ id, name })), expenses }),
      });
      setPreview(result);
      setVisa(result.visa);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The split could not be calculated.");
    } finally {
      setBusy(false);
    }
  };

  const requestPayment = async (transfer: Transfer) => {
    if (!preview) return;
    const creditorAlias = aliases[transfer.creditor_id]?.trim();
    const debtorAlias = aliases[transfer.debtor_id]?.trim();
    if (!creditorAlias || !debtorAlias) {
      setError("Enter a phone number or email for both roommates in this reimbursement.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<PaymentRequest>(`/api/v1/settlements/${preview.id}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transfer_id: transfer.id, creditor_alias: creditorAlias, debtor_alias: debtorAlias, alias_type: aliasType }),
      });
      setRequests((current) => ({ ...current, [transfer.id]: result }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payment request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (transferId: string) => {
    const current = requests[transferId];
    if (!current) return;
    const result = await apiFetch<PaymentRequest>(`/api/v1/payment-requests/${current.id}`);
    setRequests((all) => ({ ...all, [transferId]: result }));
  };

  const demoDecision = async (transferId: string, decision: "accept" | "reject") => {
    const current = requests[transferId];
    if (!current) return;
    const result = await apiFetch<PaymentRequest>(`/api/v1/payment-requests/${current.id}/demo-decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setRequests((all) => ({ ...all, [transferId]: result }));
  };

  return <section className="panel-surface settlement-panel">
    <button className="text-button checkout-back" onClick={onBack}><ArrowLeft size={15} /> Back to group cart</button>
    <div className="checkout-heading"><div><p className="eyebrow">Post-purchase settlement</p><h2>Settle shared room expenses.</h2><p>Roominate calculates the split in code. Visa Direct Request to Pay asks for reimbursement without making Roominate the furniture seller.</p></div><span><ShieldCheck size={20} /> No card numbers stored</span></div>

    <div className={`visa-mode-banner ${visa?.mode ?? "demo"}`}><CreditCard size={20} /><span><strong>{visa?.mode === "sandbox" && visa.configured ? "Visa sandbox connected" : "Visa-shaped demo mode"}</strong><small>{visa?.message ?? "Checking the server integration…"}</small></span></div>

    <div className="settlement-summary">
      <div><span>Priced purchases</span><strong>{expenses.length}</strong></div>
      <div><span>Confirmed subtotal</span><strong>{cents(expenses.reduce((sum, expense) => sum + expense.amount_cents, 0))}</strong></div>
      <div><span>Roommates</span><strong>{project.people.length}</strong></div>
    </div>
    {missingPriceCount > 0 && <div className="warning-note"><AlertCircle size={16} /> {missingPriceCount} cart item{missingPriceCount === 1 ? " has" : "s have"} no price and will not be included.</div>}
    <label className="settlement-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => { setConfirmed(event.target.checked); setPreview(null); }} /><span><strong>These purchases and payers are confirmed</strong><small>The buyer assigned in the group cart is treated as the person who paid. Current prices are split equally among all roommates.</small></span></label>
    <button className="primary-button" disabled={!confirmed || !expenses.length || project.people.length < 2 || busy} onClick={() => void calculate()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />} Calculate reimbursements</button>
    {error && <div className="analysis-message error"><AlertCircle size={16} /> {error}</div>}

    {preview && <div className="settlement-results">
      <header><div><p className="eyebrow">Exact-cent equal split</p><h3>{preview.transfers.length ? `${preview.transfers.length} reimbursement${preview.transfers.length === 1 ? "" : "s"}` : "Everyone is settled"}</h3></div><strong>{cents(preview.total_cents)} shared</strong></header>
      {preview.transfers.map((transfer) => {
        const payment = requests[transfer.id];
        return <article className="settlement-transfer" key={transfer.id}>
          <div className="settlement-flow"><span>{transfer.debtor_name}</span><Send size={16} /><strong>{cents(transfer.amount_cents)}</strong><Send size={16} /><span>{transfer.creditor_name}</span></div>
          <p>{transfer.description}. The amount came from confirmed product prices; AI cannot change it.</p>
          {!payment ? <>
            <div className="settlement-aliases">
              <label>Contact type<select value={aliasType} onChange={(event) => setAliasType(event.target.value as "MOBL" | "EMAIL")}><option value="MOBL">Mobile number</option><option value="EMAIL">Email</option></select></label>
              {[transfer.debtor_id, transfer.creditor_id].map((personId) => {
                const person = project.people.find((candidate) => candidate.id === personId)!;
                return <label key={personId}>{person.name}<input value={aliases[personId] ?? ""} onChange={(event) => setAliases((current) => ({ ...current, [personId]: event.target.value }))} placeholder={aliasType === "MOBL" ? "+15551234567" : "name@example.com"} /></label>;
              })}
            </div>
            <button className="primary-button small" disabled={busy} onClick={() => void requestPayment(transfer)}><CreditCard size={15} /> Request with Visa</button>
          </> : <div className={`payment-request-state ${payment.status}`}><span>{payment.status === "completed" ? <Check size={17} /> : <RefreshCw size={17} />}</span><div><strong>{payment.status.replaceAll("_", " ")}</strong><small>{payment.provider === "demo" ? "Local demonstration—no money moved" : `Visa sandbox reference ${payment.id}`}</small></div><button className="secondary-button small" onClick={() => void refresh(transfer.id)}>Refresh</button>{payment.provider === "demo" && payment.status === "pending" && <><button className="secondary-button small" onClick={() => void demoDecision(transfer.id, "accept")}>Simulate accept</button><button className="text-button" onClick={() => void demoDecision(transfer.id, "reject")}>Reject</button></>}</div>}
        </article>;
      })}
    </div>}
    <p className="affiliate-disclosure">Request to Pay is a payment-request message, not the furniture purchase or a guarantee of funds. Production access requires Visa onboarding, certification, and an underlying payment rail.</p>
  </section>;
}
