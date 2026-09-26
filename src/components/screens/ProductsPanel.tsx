"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, Box, Check, Download, ImagePlus, Link2, LoaderCircle, PackagePlus, Plus, Search, ShoppingCart, Sparkles, Store, Trash2, Upload } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { apiFetch, normalizeImageUpload } from "@/lib/api";
import { cents, productFor } from "@/lib/calculations";
import { downloadShoppingList } from "@/lib/shoppingList";
import type { Evidence, FurnitureVisualProfile, Issue, Product, Project } from "@/lib/types";
import { LengthInput } from "../LengthInput";
import { ShoppingDiscovery } from "./ShoppingDiscovery";
import { RetailerCheckout } from "./RetailerCheckout";
import { ProductModelPreview } from "../ProductModelPreview";
import { evaluateCandidateFit } from "@/lib/discovery";

interface ProductDraft {
  name: string;
  store: string;
  sourceURL: string;
  category: string;
  variant: string;
  /** Meters; null means unknown. */
  width: number | null;
  depth: number | null;
  height: number | null;
  price: string;
  source: "url" | "screenshot";
  screenshotDataUrl?: string;
  message?: string;
  visualProfile?: FurnitureVisualProfile;
}

interface APIVisualProfile {
  archetype: FurnitureVisualProfile["archetype"];
  style: FurnitureVisualProfile["style"];
  material: FurnitureVisualProfile["material"];
  silhouette: FurnitureVisualProfile["silhouette"];
  has_arms: boolean;
  has_back: boolean;
  leg_style: FurnitureVisualProfile["legStyle"];
  color_hex: string | null;
  confidence: number;
  evidence: string;
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
    visual_profile: APIVisualProfile;
  };
}

interface VisualProfileResponse {
  status: "complete" | "partial" | "manual_fallback" | "cached";
  message: string;
  visual_profile: APIVisualProfile;
}

function visualProfile(profile: APIVisualProfile): FurnitureVisualProfile {
  return { archetype: profile.archetype, style: profile.style, material: profile.material, silhouette: profile.silhouette, hasArms: profile.has_arms, hasBack: profile.has_back, legStyle: profile.leg_style, colorHex: profile.color_hex, confidence: profile.confidence, evidence: profile.evidence };
}

const blankDraft = (source: "url" | "screenshot", sourceURL = ""): ProductDraft => ({ name: "", store: "", sourceURL, category: "", variant: "", width: null, depth: null, height: null, price: "", source });

function extractedDraft(result: ProductExtractionResponse, source: "url" | "screenshot", fallbackUrl = "", screenshotDataUrl?: string): ProductDraft {
  return {
    name: result.product.name ?? "",
    store: result.product.store ?? "",
    sourceURL: result.product.source_url ?? fallbackUrl,
    category: result.product.category ?? "",
    variant: result.product.variant ?? "",
    width: result.product.dimensions.width_m,
    depth: result.product.dimensions.depth_m,
    height: result.product.dimensions.height_m,
    price: result.product.price ? (result.product.price.amount_cents / 100).toFixed(2) : "",
    source,
    screenshotDataUrl,
    visualProfile: visualProfile(result.product.visual_profile),
    message: result.message,
  };
}

export function ProductsPanel({ project, issues, update }: { project: Project; issues: Issue[]; update: (updater: (project: Project) => Project) => void }) {
  const [tab, setTab] = useState<"catalog" | "shop" | "import" | "cart" | "checkout">("catalog");
  const [importType, setImportType] = useState<"url" | "screenshot">("url");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const units = useUnitPreferences();
  const [visualLoading, setVisualLoading] = useState(false);
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
    try {
      const normalizedFile = await normalizeImageUpload(file);
      const screenshotDataUrl = normalizedFile.size < 3_000_000 ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(normalizedFile);
      }) : undefined;
      const form = new FormData();
      form.set("project_id", project.id);
      form.set("file", normalizedFile);
      const result = await apiFetch<ProductExtractionResponse>("/api/v1/extract-product/screenshot", { method: "POST", body: form });
      setDraft(extractedDraft(result, "screenshot", "", screenshotDataUrl));
      setStatus("idle");
    } catch (caught) {
      setDraft({ ...blankDraft("screenshot"), message: "Automated extraction is unavailable. Add the visible fields manually." });
      setError(caught instanceof Error ? caught.message : "Extraction unavailable");
      setStatus("error");
    }
  };

  const generateVisual = async () => {
    if (!draft?.name.trim()) return;
    setVisualLoading(true);
    setError("");
    try {
      const result = await apiFetch<VisualProfileResponse>("/api/v1/product-visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: project.id, name: draft.name.trim(), category: draft.category.trim() || null, variant: draft.variant.trim() || null }),
      });
      setDraft((current) => current ? { ...current, visualProfile: visualProfile(result.visual_profile), message: result.message } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "3D styling unavailable");
    } finally {
      setVisualLoading(false);
    }
  };

  const addDraft = () => {
    if (!draft?.name.trim()) return;
    const id = `product-${crypto.randomUUID()}`;
    const confidence = (present: boolean): Evidence => ({ source: draft.source, confidence: present ? 0.7 : 0, confirmedByUser: present });
    const positive = (meters: number | null) => (meters != null && Number.isFinite(meters) && meters > 0 ? meters : null);
    const dimensions = { width: positive(draft.width), depth: positive(draft.depth), height: positive(draft.height) };
    const parsedPrice = draft.price ? Math.round(Number(draft.price) * 100) : null;
    const product: Product = {
      id,
      name: draft.name.trim(),
      store: draft.store.trim() || "Unknown store",
      sourceURL: draft.sourceURL.trim() || null,
      screenshotDataUrl: draft.screenshotDataUrl,
      visualProfile: draft.visualProfile,
      category: draft.category.trim().toLowerCase() || "uncategorized",
      variant: draft.variant.trim(),
      dimensions,
      price: parsedPrice != null && Number.isFinite(parsedPrice) ? { amount: parsedPrice, currency: "USD", observedAt: new Date().toISOString(), confirmed: true } : null,
      fieldEvidence: { name: confidence(Boolean(draft.name)), dimensions: confidence(Object.values(dimensions).every((value) => value != null)), price: confidence(Boolean(draft.price)) },
      tags: [],
    };
    const fit = evaluateCandidateFit(project, product);
    const transform = fit.status === "fits" ? { position: fit.position, rotationZ: fit.rotationZ } : null;
    changeProject((current) => ({ ...current, products: [...current.products, product], items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId: id, ownerId: current.ownerId, acquisitionStatus: "buying", purchaseStatus: "in_cart", quantity: 1, essentiality: "optional", needsServed: product.category === "uncategorized" ? [] : [product.category], transform, placementType: "floor" }] }));
    setDraft(null);
    setUrl("");
    setTab("cart");
  };

  const addProduct = (product: Product) => changeProject((current) => ({ ...current, items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId: product.id, ownerId: current.ownerId, acquisitionStatus: "buying", purchaseStatus: "in_cart", quantity: 1, essentiality: "optional", needsServed: product.tags.slice(0, 1), transform: null, placementType: "floor" }] }));

  const addDiscoveredProduct = (product: Product, placement: { position: { x: number; y: number }; rotationZ: number } | null) => changeProject((current) => ({
    ...current,
    products: current.products.some((candidate) => candidate.id === product.id) ? current.products.map((candidate) => candidate.id === product.id ? product : candidate) : [...current.products, product],
    items: [...current.items, { id: `item-${crypto.randomUUID()}`, productId: product.id, ownerId: current.ownerId, acquisitionStatus: "buying", purchaseStatus: "in_cart", quantity: 1, essentiality: "optional", needsServed: product.tags.slice(0, 1), transform: placement, placementType: "floor" }],
  }));

  const cartItems = project.items.filter((item) => item.purchaseStatus === "in_cart");
  return (
    <div className="flow-page products-page">
      <header className="flow-header compact-flow-header">
        <div><p className="eyebrow">Product library</p><h1>Bring every store into one room.</h1><p>Imported details remain editable, sourced, and honest about what is missing.</p></div>
        <button className="primary-button" onClick={() => { setTab("import"); setDraft(null); }}><Plus size={17} /> Import product</button>
      </header>
      <div className="segment-tabs">
        <button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}><Box size={16} /> Library <span>{project.products.length}</span></button>
        <button className={tab === "shop" ? "active" : ""} onClick={() => setTab("shop")}><Store size={16} /> Shop</button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><Upload size={16} /> Import</button>
        <button className={tab === "cart" || tab === "checkout" ? "active" : ""} onClick={() => setTab("cart")}><ShoppingCart size={16} /> Group cart <span>{cartItems.length}</span></button>
      </div>

      {tab === "shop" && <ShoppingDiscovery project={project} onAdd={(product, placement) => { addDiscoveredProduct(product, placement); setTab("cart"); }} onImport={() => setTab("import")} />}

      {tab === "catalog" && <section className="panel-surface catalog-panel">
        <div className="catalog-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, categories, stores…" /></div><span>{shownProducts.length} products</span></div>
        <div className="product-grid">
          {shownProducts.map((product) => {
            const existing = project.items.filter((item) => item.productId === product.id && item.purchaseStatus !== "deferred").length;
            return <article className="product-card" key={product.id}>
              <div className="product-art"><Box size={35} /><span>{product.category}</span></div>
              <div className="product-card-copy"><small>{product.store}</small><h3>{product.name}</h3><p>{units.formatDimensions(product.dimensions)}</p><div><strong>{product.price ? cents(product.price.amount) : "Price unknown"}</strong><button className="secondary-button small" onClick={() => addProduct(product)}><PackagePlus size={14} /> Add {existing ? "another" : ""}</button></div></div>
            </article>;
          })}
          {!shownProducts.length && <div className="empty-state"><Box size={28} /><h3>No products yet</h3><p>Import a URL or screenshot, then confirm the extracted details.</p></div>}
        </div>
      </section>}

      {tab === "import" && <div className="import-grid">
        <section className="panel-surface import-source">
          <div className="import-type-tabs"><button className={importType === "url" ? "active" : ""} onClick={() => { setImportType("url"); setDraft(null); }}><Link2 size={17} /> Product URL</button><button className={importType === "screenshot" ? "active" : ""} onClick={() => { setImportType("screenshot"); setDraft(null); }}><ImagePlus size={17} /> Screenshot</button></div>
          {importType === "url" ? <form onSubmit={(event) => void analyzeUrl(event)} className="source-form"><div className="source-icon"><Link2 size={23} /></div><h2>Paste a product link</h2><p>We’ll read available page evidence. Blocked or missing fields stay blank for you to confirm.</p><label>Product URL<input required type="url" placeholder="https://store.com/product" value={url} onChange={(event) => setUrl(event.target.value)} /></label><button className="primary-button full" disabled={status === "loading"}>{status === "loading" ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Extract product details</button></form> : <div className="source-form"><div className="source-icon"><ImagePlus size={23} /></div><h2>Create a 3D model from a picture</h2><p>Roominate analyzes the visible product, builds a safe procedural model, and leaves extracted facts editable.</p><label className="screenshot-dropzone"><input aria-label="Product picture" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" onChange={(event) => void analyzeScreenshot(event.target.files?.[0] ?? null)} /><Upload size={23} /><strong>Choose product photo or screenshot</strong><small>HEIC, HEIF, PNG, JPEG, or WebP</small></label>{status === "loading" && <div className="loading-row"><LoaderCircle className="spin" size={17} /> Analyzing picture and building model…</div>}</div>}
          {error && <div className="analysis-message error"><AlertCircle size={16} />{error}. Manual entry is still available.</div>}
        </section>

        <section className="panel-surface draft-panel">
          {!draft ? <div className="empty-draft"><PackagePlus size={29} /><h2>Extracted details appear here</h2><p>Every critical field can be corrected before the item joins the shared cart.</p></div> : <>
            <div className="panel-heading"><div><p className="eyebrow">Review required</p><h2>Confirm product</h2></div><span className="source-chip uncertain">{draft.source}</span></div>
            {draft.screenshotDataUrl && <img className="draft-screenshot" src={draft.screenshotDataUrl} alt="Uploaded product evidence" />}
            {draft.message && <div className="info-note">{draft.message}</div>}
            {draft.visualProfile && <ProductModelPreview
              name={draft.name}
              category={draft.category}
              profile={draft.visualProfile}
              dimensions={{ width: Number(draft.width) || null, depth: Number(draft.depth) || null, height: Number(draft.height) || null }}
            />}
            <div className="form-grid">
              <label className="span-2">Name *<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value, visualProfile: undefined })} placeholder="Product name" /></label>
              <label>Store<input value={draft.store} onChange={(event) => setDraft({ ...draft, store: event.target.value })} placeholder="Unknown" /></label>
              <label>Category<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value, visualProfile: undefined })} placeholder="e.g. desk" /></label>
              <label className="span-2">Variant<input value={draft.variant} onChange={(event) => setDraft({ ...draft, variant: event.target.value, visualProfile: undefined })} placeholder="Size / color" /></label>
            </div>
            <div className="visual-profile-box"><span><Sparkles size={16} /><span><strong>{draft.visualProfile ? `${draft.visualProfile.style} ${draft.visualProfile.archetype.replaceAll("_", " ")}` : "Choose its 3D appearance"}</strong><small>{draft.visualProfile ? `${draft.visualProfile.material} · ${draft.visualProfile.silhouette} · ${Math.round(draft.visualProfile.confidence * 100)}% confidence` : "OpenAI selects from safe procedural model options using the name."}</small></span></span><button className="secondary-button small" disabled={!draft.name.trim() || visualLoading} onClick={() => void generateVisual()}>{visualLoading ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} {draft.visualProfile ? "Rebuild from details" : "Generate 3D model"}</button></div>
            <h3 className="form-subheading">Dimensions <small>{units.objectUnit === "in" ? "inches" : "centimeters"}</small></h3>
            <div className="form-grid three">{(["width", "depth", "height"] as const).map((key) => <label key={key}>{key[0].toUpperCase() + key.slice(1)}<LengthInput step={0.1} min={0} unit={units.objectUnit} meters={draft[key]} onChange={(meters) => setDraft((current) => current && { ...current, [key]: meters })} placeholder="Unknown" /></label>)}</div>
            <div className="form-grid"><label>Observed price (USD)<input type="number" step="0.01" min="0" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="Unknown" /></label><label>Source URL<input type="url" value={draft.sourceURL} onChange={(event) => setDraft({ ...draft, sourceURL: event.target.value })} placeholder="Optional" /></label></div>
            {(draft.width == null || draft.depth == null || draft.height == null) &&<div className="warning-note"><AlertCircle size={16} /><span>Missing dimensions are allowed, but fit will remain unverified.</span></div>}
            <button className="primary-button full" disabled={!draft.name.trim()} onClick={addDraft}><Check size={17} /> Confirm & add to cart</button>
          </>}
        </section>
      </div>}

      {tab === "cart" && <section className="panel-surface cart-panel">
        <div className="panel-heading"><div><p className="eyebrow">Shared group cart</p><h2>Who’s bringing what</h2></div><div className="panel-heading-actions"><span className="source-chip confirmed">{project.people.length} collaborators</span><button className="secondary-button small" disabled={!cartItems.length} onClick={() => downloadShoppingList(project)}><Download size={14} /> Export shopping list</button><button className="primary-button small" disabled={!cartItems.length} onClick={() => setTab("checkout")}><ShoppingCart size={14} /> Checkout by store</button></div></div>
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
      {tab === "checkout" && <RetailerCheckout project={project} issues={issues} onBack={() => setTab("cart")} />}
    </div>
  );
}
