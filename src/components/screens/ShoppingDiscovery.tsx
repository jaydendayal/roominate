"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, Box, Check, ExternalLink, LoaderCircle, PackagePlus, Search, Store } from "lucide-react";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { apiFetch } from "@/lib/api";
import { cents } from "@/lib/calculations";
import { evaluateCandidateFit } from "@/lib/discovery";
import type { Product, Project } from "@/lib/types";

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

export function ShoppingDiscovery({ project, onAdd, onImport }: { project: Project; onAdd: (product: Product, placement: { position: { x: number; z: number }; rotationY: number } | null) => void; onImport: () => void }) {
  const [provider, setProvider] = useState<"amazon" | "ikea">("amazon");
  const [query, setQuery] = useState("compact desk");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const units = useUnitPreferences();
  const products = useMemo(() => (response?.listings ?? []).map(productFromListing).map((product) => ({ product, fit: evaluateCandidateFit(project, product) })), [project, response]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (provider !== "amazon") return;
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
    <div className="retailer-tabs"><button className={provider === "amazon" ? "active" : ""} onClick={() => { setProvider("amazon"); setResponse(null); }}>Amazon</button><button className={provider === "ikea" ? "active" : ""} onClick={() => { setProvider("ikea"); setResponse(null); }}>IKEA</button></div>
    {provider === "amazon" ? <>
      <form className="retailer-search" onSubmit={(event) => void search(event)}><div className="search-box"><Search size={17} /><input aria-label="Search Amazon products" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Compact desk, storage cart…" /></div><button className="primary-button" disabled={loading || query.trim().length < 2}>{loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Search Amazon</button></form>
      {response && <div className={`retailer-message ${response.available ? "available" : "unavailable"}`}><AlertCircle size={16} /><span>{response.message}</span>{!response.available && <a href={response.browse_url ?? "https://www.amazon.com/"} target="_blank" rel="noopener noreferrer sponsored">Open Amazon <ExternalLink size={13} /></a>}</div>}
      <div className="listing-grid">{products.map(({ product, fit }) => <article key={product.id} className="listing-card">
        <div className="listing-image">{product.imageURL ? <img src={product.imageURL} alt="" /> : <Box size={30} />}</div>
        <div className="listing-copy"><small>Amazon · API observation</small><h3>{product.name}</h3><p>{units.formatDimensions(product.dimensions)}</p><div className={`candidate-fit ${fit.status.replaceAll("_", "-")}`}>{fit.status === "fits" ? <><Check size={13} /> Placement found</> : fit.status === "does_not_fit" ? <><AlertCircle size={13} /> No valid placement</> : <><AlertCircle size={13} /> Fit unverified</>}</div><footer><strong>{product.price ? cents(product.price.amount) : "Price on Amazon"}</strong><button className="secondary-button small" onClick={() => onAdd(product, fit.status === "fits" ? { position: fit.position, rotationY: fit.rotationY } : null)}><PackagePlus size={14} /> Add to Roominate</button></footer></div>
      </article>)}</div>
      {!response && <div className="retailer-empty"><Store size={28} /><h3>Search approved Amazon listings</h3><p>Results use the official Creators API when credentials are configured. Complete dimensions are tested against the current room before receiving “placement found.”</p></div>}
    </> : <div className="retailer-empty policy"><Store size={28} /><h3>IKEA requires a permission-based catalog</h3><p>IKEA’s current U.S. terms prohibit automated scraping and deep-linking without written permission. Browse IKEA directly, then paste a product URL or screenshot into Roominate for review.</p><div><a className="secondary-button" href="https://www.ikea.com/us/en/" target="_blank" rel="noopener noreferrer">Open IKEA <ExternalLink size={15} /></a><button className="primary-button" onClick={onImport}>Import an IKEA item</button></div></div>}
    <p className="affiliate-disclosure">Roominate may use qualifying affiliate links. As an Amazon Associate, an approved deployment may earn from qualifying purchases. Retailer price and availability are confirmed at checkout.</p>
  </section>;
}
