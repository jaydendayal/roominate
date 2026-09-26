"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, Box, Check, ExternalLink, ImagePlus, Link2, LoaderCircle, PackagePlus, Plus, Search, ShoppingCart, Trash2, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cents, productFor } from "@/lib/calculations";
import type { Evidence, Issue, Product, Project } from "@/lib/types";

interface ProductDraft {
  name: string;
  store: string;
  sourceURL: string;
  category: string;
  variant: string;
  width: string;
  depth: string;
  height: string;
  price: string;
  source: "url" | "screenshot";
  screenshotDataUrl?: string;
  message?: string;
}

interface ProductExtractionResponse {
  status: "complete" | "partial" | "manual_fallback" | "cached";
  message?: string;
  product: {
    name: string | null;
    store: string | null;
    source_url: string | null;
    category: string | null;
    variant: string | null;
    dimensions: { width_m: number | null; depth_m: number | null; height_m: number | null };
    price: { amount_cents: number; currency: "USD" } | null;
  };
}

const blankDraft = (source: "url" | "screenshot", sourceURL = ""): ProductDraft => ({ name: "", store: "", sourceURL, category: "", variant: "", width: "", depth: "", height: "", price: "", source });

function extractedDraft(result: ProductExtractionResponse, source: "url" | "screenshot", fallbackUrl = "", screenshotDataUrl?: string): ProductDraft {
  return {
    name: result.product.name ?? "",
    store: result.product.store ?? "",
    sourceURL: result.product.source_url ?? fallbackUrl,
    category: result.product.category ?? "",
    variant: result.product.variant ?? "",
    width: result.product.dimensions.width_m?.toString() ?? "",
    depth: result.product.dimensions.depth_m?.toString() ?? "",
    height: result.product.dimensions.height_m?.toString() ?? "",
    price: result.product.price ? (result.product.price.amount_cents / 100).toFixed(2) : "",
    source,
    screenshotDataUrl,
    message: result.message,
  };
}

export function ProductsPanel({ project, issues, update }: { project: Project; issues: Issue[]; update: (updater: (project: Project) => Project) => void }) {
  const [tab, setTab] = useState<"catalog" | "import" | "cart">("catalog");
  const [importType, setImportType] = useState<"url" | "screenshot">("url");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const shownProducts = useMemo(() => project.products.filter((product) => `${product.name} ${product.category} ${product.store}`.toLowerCase().includes(search.toLowerCase())), [project.products, search]);

  const changeProject = (updater: (current: Project) => Project) => update((current) => {
    const next = updater(current);
    return { ...next, cartVersion: current.cartVersion + 1, proposal: current.proposal ? { ...current.proposal, stale: true } : null };
  });

  const analyzeUrl = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const result = await apiFetch<ProductExtractionResponse>("/api/v1/extract-product/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id, url }),
      });
      setDraft(extractedDraft(result, "url", url));
      setStatus("idle");
    } catch (caught) {
      setDraft({ ...blankDraft("url", url), message: "The source could not be read. The URL is retained—fill only the facts you can confirm." });
      setError(caught instanceof Error ? caught.message : "Import unavailable");
      setStatus("error");
    }
  };

  const analyzeScreenshot = async (file: File | null) => {
    if (!file) return;
    setStatus("loading");
    setError("");
    const screenshotDataUrl = file.size < 3_000_000 ? await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }) : undefined;
    try {
      const form = new FormData();
      form.set("project_id", project.id);
      form.set("file", file);
      const result = await apiFetch<ProductExtractionResponse>("/api/v1/extract-product/screenshot", { method: "POST", body: form });
      setDraft(extractedDraft(result, "screenshot", "", screenshotDataUrl));
      setStatus("idle");
    } catch (caught) {
      setDraft({ ...blankDraft("screenshot"), screenshotDataUrl, message: "Automated extraction is unavailable. The screenshot is retained beside this editable form." });
      setError(caught instanceof Error ? caught.message : "Extraction unavailable");
      setStatus("error");
    }
  };

  const addDraft = () => {
    if (!draft?.name.trim()) return;
    const id = `product-${crypto.randomUUID()}`;
    const confidence = (value: string): Evidence => ({ source: draft.source, confidence: value ? 0.7 : 0, confirmedByUser: Boolean(value) });
    const parsedPrice = draft.price ? Math.round(Number(draft.price) * 100) : null;
    const product: Product = {
      id,
      name: draft.name.trim(),
      store: draft.store.trim() || "Unknown store",
      sourceURL: draft.sourceURL.trim() || null,
      screenshotDataUrl: draft.screenshotDataUrl,
      category: draft.category.trim().toLowerCase() || "uncategorized",
      variant: draft.variant.trim(),
      dimensions: { width: draft.width ? Number(draft.width) : null, depth: draft.depth ? Number(draft.depth) : null, height: draft.height ? Number(draft.height) : null },
      price: parsedPrice != null && Number.isFinite(parsedPrice) ? { amount: parsedPrice, currency: "USD", observedAt: new Date().toISOString(), confirmed: true } : null,
      fieldEvidence: { name: confidence(draft.name), dimensions: confidence(draft.width && draft.depth && draft.height), price: confidence(draft.price) },
      tags: [],
    };
    changeProject((current) => ({ ...current, products: [...current.products, product], items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId: id, ownerId: current.ownerId, acquisitionStatus: "buying", purchaseStatus: "in_cart", quantity: 1, essentiality: "optional", needsServed: product.category === "uncategorized" ? [] : [product.category], transform: null, placementType: "floor" }] }));
    setDraft(null);
    setUrl("");
    setTab("cart");
  };

  const addProduct = (product: Product) => changeProject((current) => ({ ...current, items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId: product.id, ownerId: current.ownerId, acquisitionStatus: "buying", purchaseStatus: "in_cart", quantity: 1, essentiality: "optional", needsServed: product.tags.slice(0, 1), transform: null, placementType: "floor" }] }));

  const cartItems = project.items.filter((item) => item.purchaseStatus === "in_cart");
  return (
    <div className="flow-page products-page">
      <header className="flow-header compact-flow-header">
        <div><p className="eyebrow">Product library</p><h1>Bring every store into one room.</h1><p>Imported details remain editable, sourced, and honest about what is missing.</p></div>
        <button className="primary-button" onClick={() => { setTab("import"); setDraft(null); }}><Plus size={17} /> Import product</button>
      </header>
      <div className="segment-tabs">
        <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><Box size={16} /> Library <span>{project.products.length}</span></button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><Upload size={16} /> Import</button>
        <button className={tab === "cart" ? "active" : ""} onClick={() => setTab("cart")}><ShoppingCart size={16} /> Group cart <span>{cartItems.length}</span></button>
      </div>

      {tab === "catalog" && <section className="panel-surface catalog-panel">
        <div className="catalog-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, categories, stores…" /></div><span>{shownProducts.length} products</span></div>
        <div className="product-grid">
          {shownProducts.map((product) => {
            const existing = project.items.filter((item) => item.productId === product.id && item.purchaseStatus !== "deferred").length;
            return <article className="product-card" key={product.id}>
              <div className="product-art"><Box size={35} /><span>{product.category}</span></div>
              <div className="product-card-copy"><small>{product.store}</small><h3>{product.name}</h3><p>{product.dimensions.width != null ? `${product.dimensions.width.toFixed(2)} × ${product.dimensions.depth?.toFixed(2)} × ${product.dimensions.height?.toFixed(2)} m` : "Dimensions unknown"}</p><div><strong>{product.price ? cents(product.price.amount) : "Price unknown"}</strong><button className="secondary-button small" onClick={() => addProduct(product)}><PackagePlus size={14} /> Add {existing ? "another" : ""}</button></div></div>
            </article>;
          })}
          {!shownProducts.length && <div className="empty-state"><Box size={28} /><h3>No products yet</h3><p>Import a URL or screenshot, then confirm the extracted details.</p></div>}
        </div>
      </section>}

      {tab === "import" && <div className="import-grid">
        <section className="panel-surface import-source">
          <div className="import-type-tabs"><button className={importType === "url" ? "active" : ""} onClick={() => { setImportType("url"); setDraft(null); }}><Link2 size={17} /> Product URL</button><button className={importType === "screenshot" ? "active" : ""} onClick={() => { setImportType("screenshot"); setDraft(null); }}><ImagePlus size={17} /> Screenshot</button></div>
          {importType === "url" ? <form onSubmit={(event) => void analyzeUrl(event)} className="source-form"><div className="source-icon"><Link2 size={23} /></div><h2>Paste a product link</h2><p>We’ll read available page evidence. Blocked or missing fields stay blank for you to confirm.</p><label>Product URL<input required type="url" placeholder="https://store.com/product" value={url} onChange={(event) => setUrl(event.target.value)} /></label><button className="primary-button full" disabled={status === "loading"}>{status === "loading" ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Extract product details</button></form> : <div className="source-form"><div className="source-icon"><ImagePlus size={23} /></div><h2>Upload a screenshot</h2><p>Visible fields become an editable draft. A screenshot never implies a live price.</p><label className="screenshot-dropzone"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void analyzeScreenshot(event.target.files?.[0] ?? null)} /><Upload size={23} /><strong>Choose product screenshot</strong><small>PNG, JPEG, or WebP</small></label>{status === "loading" && <div className="loading-row"><LoaderCircle className="spin" size={17} /> Reading visible details…</div>}</div>}
          {error && <div className="analysis-message error"><AlertCircle size={16} />{error}. Manual entry is still available.</div>}
        </section>

        <section className="panel-surface draft-panel">
          {!draft ? <div className="empty-draft"><PackagePlus size={29} /><h2>Extracted details appear here</h2><p>Every critical field can be corrected before the item joins the shared cart.</p></div> : <>
            <div className="panel-heading"><div><p className="eyebrow">Review required</p><h2>Confirm product</h2></div><span className="source-chip uncertain">{draft.source}</span></div>
            {draft.screenshotDataUrl && <img className="draft-screenshot" src={draft.screenshotDataUrl} alt="Uploaded product evidence" />}
            {draft.message && <div className="info-note">{draft.message}</div>}
            <div className="form-grid">
              <label className="span-2">Name *<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Product name" /></label>
              <label>Store<input value={draft.store} onChange={(event) => setDraft({ ...draft, store: event.target.value })} placeholder="Unknown" /></label>
              <label>Category<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="e.g. desk" /></label>
              <label className="span-2">Variant<input value={draft.variant} onChange={(event) => setDraft({ ...draft, variant: event.target.value })} placeholder="Size / color" /></label>
            </div>
            <h3 className="form-subheading">Dimensions <small>meters</small></h3>
            <div className="form-grid three"><label>Width<input type="number" step="0.01" min="0" value={draft.width} onChange={(event) => setDraft({ ...draft, width: event.target.value })} placeholder="Unknown" /></label><label>Depth<input type="number" step="0.01" min="0" value={draft.depth} onChange={(event) => setDraft({ ...draft, depth: event.target.value })} placeholder="Unknown" /></label><label>Height<input type="number" step="0.01" min="0" value={draft.height} onChange={(event) => setDraft({ ...draft, height: event.target.value })} placeholder="Unknown" /></label></div>
            <div className="form-grid"><label>Observed price (USD)<input type="number" step="0.01" min="0" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="Unknown" /></label><label>Source URL<input type="url" value={draft.sourceURL} onChange={(event) => setDraft({ ...draft, sourceURL: event.target.value })} placeholder="Optional" /></label></div>
            {(!draft.width || !draft.depth || !draft.height) && <div className="warning-note"><AlertCircle size={16} /><span>Missing dimensions are allowed, but fit will remain unverified.</span></div>}
            <button className="primary-button full" disabled={!draft.name.trim()} onClick={addDraft}><Check size={17} /> Confirm & add to cart</button>
          </>}
        </section>
      </div>}

      {tab === "cart" && <section className="panel-surface cart-panel">
        <div className="panel-heading"><div><p className="eyebrow">Shared group cart</p><h2>Who’s bringing what</h2></div><span className="source-chip confirmed">{project.people.length} collaborators</span></div>
        <div className="cart-table">
          <div className="cart-table-head"><span>Item</span><span>Buyer</span><span>Fit</span><span>Price</span><span /></div>
          {cartItems.map((item) => {
            const product = productFor(project, item);
            const itemIssues = issues.filter((issue) => issue.affectedItemIds.includes(item.id));
            const fit = !item.transform || Object.values(product?.dimensions ?? {}).some((value) => value == null) ? "Unverified" : itemIssues.some((issue) => issue.type === "fit" || issue.type === "clearance") ? "Conflict" : "Fits";
            return <div className="cart-table-row" key={item.id}><span className="cart-product"><i><Box size={17} /></i><span><strong>{product?.name}</strong><small>{product?.store} · {item.essentiality}</small></span></span><label><span className="mobile-field-label">Buyer</span><select value={item.ownerId} onChange={(event) => changeProject((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, ownerId: event.target.value } : candidate) }))}>{project.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><span className={`fit-status ${fit.toLowerCase()}`}>{fit}</span><strong>{product?.price ? cents(product.price.amount * item.quantity) : "Unknown"}</strong><button className="icon-button danger" aria-label={`Remove ${product?.name}`} onClick={() => changeProject((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, purchaseStatus: "deferred", transform: null } : candidate) }))}><Trash2 size={16} /></button></div>;
          })}
        </div>
        {!cartItems.length && <div className="empty-state"><ShoppingCart size={28} /><h3>The group cart is empty</h3><button className="secondary-button" onClick={() => setTab("catalog")}>Browse library</button></div>}
      </section>}
    </div>
  );
}
