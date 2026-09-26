"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, Check, ExternalLink, Link2, LoaderCircle, PackagePlus, Search, Store } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { apiFetch } from "@/lib/api";
import { cents } from "@/lib/calculations";
import { evaluateCandidateFit } from "@/lib/discovery";
import { shortlistByCategory, shortlistCategories } from "@/lib/shortlist";
import type { Item, Product, Project } from "@/lib/types";
import { ColorChoicePicker } from "../ColorChoicePicker";
import { ProductPhoto } from "../ProductPhoto";

interface Listing {
  provider: "amazon";
  external_id: string;
  name: string;
  source_url: string;
  image_url: string | null;
  category: string;
  variant: string;
  width_m: number | null;
  depth_m: number | null;
  height_m: number | null;
  price_cents: number | null;
  currency: "USD";
  observed_at: string;
  fit_status: "dimensions_ready" | "fit_unverified";
  evidence: string[];
}

interface SearchResponse {
  provider: "amazon";
  available: boolean;
  message: string;
  browse_url?: string;
  listings: Listing[];
}

function productFromListing(listing: Listing): Product {
  return {
    id: `amazon-${listing.external_id}`,
    externalId: listing.external_id,
    retailer: "amazon",
    name: listing.name,
    store: "Amazon",
    sourceURL: listing.source_url,
    imageURL: listing.image_url ?? undefined,
    category: listing.category,
    variant: listing.variant,
    dimensions: { width: listing.width_m, depth: listing.depth_m, height: listing.height_m },
    price: listing.price_cents == null ? null : { amount: listing.price_cents, currency: "USD", observedAt: listing.observed_at, confirmed: false },
    fieldEvidence: {
      dimensions: { source: "retailer_api", confidence: listing.fit_status === "dimensions_ready" ? 0.95 : 0, confirmedByUser: false, note: listing.evidence.join("; ") },
      price: { source: "retailer_api", confidence: listing.price_cents == null ? 0 : 0.95, confirmedByUser: false, note: "Observed through Amazon Creators API" },
    },
    tags: [listing.category],
  };
}

type Placement = { position: { x: number; y: number }; rotationZ: number } | null;

type AddHandler = (product: Product, placement: Placement, colorSelection?: Item["colorSelection"]) => void;

function ListingCard({ project, product, source, onAdd }: { project: Project; product: Product; source: string; onAdd: AddHandler }) {
  const units = useUnitPreferences();
  const fit = evaluateCandidateFit(project, product);
  const [colorSelection, setColorSelection] = useState<Item["colorSelection"]>(undefined);
  return <article className="listing-card">
    <div className="listing-image"><ProductPhoto src={product.imageURL} alt={product.name} iconSize={30} /></div>
    <div className="listing-copy"><small>{source}</small><h3>{product.name}</h3><p>{units.formatDimensions(product.dimensions)}</p><div className={`candidate-fit ${fit.status.replaceAll("_", "-")}`}>{fit.status === "fits" ? <><Check size={13} /> Placement found</> : fit.status === "does_not_fit" ? <><AlertCircle size={13} /> No valid placement</> : <><AlertCircle size={13} /> Fit unverified</>}</div>
      <ColorChoicePicker product={product} selection={colorSelection} onChange={setColorSelection} compact />
      <footer><strong>{product.price ? cents(product.price.amount) : `Price on ${product.store}`}</strong><button className="secondary-button small" onClick={() => onAdd(product, fit.status === "fits" ? { position: fit.position, rotationZ: fit.rotationZ } : null, colorSelection)}><PackagePlus size={14} /> Add to Roominate</button></footer></div>
  </article>;
}

const typeLabel = (category: string) => category.replace(/\b\w/g, (letter) => letter.toUpperCase());

export function ShoppingDiscovery({ project, onAdd, onImport }: { project: Project; onAdd: AddHandler; onImport: () => void }) {
  // Shortlist items from every store, filtered only by item type.
  const [category, setCategory] = useState("all");
  const shortlist = useMemo(() => shortlistByCategory(category), [category]);
  // Optional live Amazon search through the Creators API (needs credentials).
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const products = useMemo(() => (response?.listings ?? []).map(productFromListing), [response]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      setResponse(await apiFetch<SearchResponse>("/api/v1/shopping/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project_id: project.id, provider: "amazon", query, max_price_cents: project.budgetAmount }) }));
    } catch (error) {
      setResponse({ provider: "amazon", available: false, message: error instanceof Error ? error.message : "Retailer search is unavailable.", listings: [] });
    } finally {
      setLoading(false);
    }
  };

  return <section className="panel-surface shopping-discovery">
    <div className="panel-heading"><div><p className="eyebrow">Retailer discovery</p><h2>Find products for this room</h2></div><span className="source-chip uncertain">retailer checkout</span></div>
    <div className="shop-filters">
      <div className="retailer-tabs type-filters" role="group" aria-label="Filter by item type">
        <button type="button" aria-pressed={category === "all"} className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>All</button>
        {shortlistCategories.map(({ category: type }) => <button type="button" key={type} aria-pressed={category === type} className={category === type ? "active" : ""} onClick={() => setCategory(type)}>{typeLabel(type)}</button>)}
      </div>
      <button type="button" className="secondary-button" onClick={onImport}><Link2 size={16} /> Import from URL</button>
    </div>
    <div className="listing-grid">{shortlist.map((product) => <ListingCard key={product.id} project={project} product={product} source={product.store} onAdd={onAdd} />)}</div>
    <details className="live-search">
      <summary><Store size={15} /> Search Amazon live</summary>
      <p>Uses the official Amazon Creators API when credentials are configured. Complete dimensions are tested against the current room before receiving “placement found.”</p>
      <form className="retailer-search" onSubmit={(event) => void search(event)}><div className="search-box"><Search size={17} /><input aria-label="Search Amazon products" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Compact desk, storage cart…" /></div><button className="primary-button" disabled={loading || query.trim().length < 2}>{loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Search Amazon</button></form>
      {response && <div className={`retailer-message ${response.available ? "available" : "unavailable"}`}><AlertCircle size={16} /><span>{response.message}</span>{!response.available && <a href={response.browse_url ?? "https://www.amazon.com/"} target="_blank" rel="noopener noreferrer sponsored">Open Amazon <ExternalLink size={13} /></a>}</div>}
      {products.length > 0 && <div className="listing-grid">{products.map((product) => <ListingCard key={product.id} project={project} product={product} source="Amazon · API observation" onAdd={onAdd} />)}</div>}
    </details>
    <p className="affiliate-disclosure">Roominate may use qualifying affiliate links. As an Amazon Associate, an approved deployment may earn from qualifying purchases. Retailer price and availability are confirmed at checkout.</p>
  </section>;
}
