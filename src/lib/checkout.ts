import type { Item, Product, Project } from "./types";

export type RetailerId = "amazon" | "ikea" | "other";

export interface CheckoutGroup {
  id: RetailerId;
  name: string;
  homeURL: string;
  items: { item: Item; product: Product }[];
  subtotal: number;
  complete: boolean;
}

const retailers: Record<RetailerId, Omit<CheckoutGroup, "items" | "subtotal" | "complete">> = {
  amazon: { id: "amazon", name: "Amazon", homeURL: "https://www.amazon.com/" },
  ikea: { id: "ikea", name: "IKEA", homeURL: "https://www.ikea.com/us/en/" },
  other: { id: "other", name: "Other stores", homeURL: "" },
};

export function retailerForProduct(product: Product): RetailerId {
  if (product.retailer) return product.retailer;
  const store = product.store.toLowerCase();
  try {
    const hostname = product.sourceURL ? new URL(product.sourceURL).hostname.toLowerCase() : "";
    if (hostname === "amazon.com" || hostname.endsWith(".amazon.com")) return "amazon";
    if (hostname === "ikea.com" || hostname.endsWith(".ikea.com")) return "ikea";
  } catch {
    // Store-name classification still provides a safe fallback for malformed legacy URLs.
  }
  if (store.includes("amazon")) return "amazon";
  if (store.includes("ikea")) return "ikea";
  return "other";
}

export function checkoutGroups(project: Project): CheckoutGroup[] {
  const groups = new Map<RetailerId, CheckoutGroup>();
  for (const item of project.items.filter((candidate) => candidate.purchaseStatus === "in_cart")) {
    const product = project.products.find((candidate) => candidate.id === item.productId);
    if (!product) continue;
    const id = retailerForProduct(product);
    const group = groups.get(id) ?? { ...retailers[id], items: [], subtotal: 0, complete: true };
    group.items.push({ item, product });
    if (product.price) group.subtotal += product.price.amount * item.quantity;
    else group.complete = false;
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function safeCheckoutURL(product: Product) {
  if (!product.sourceURL) return null;
  try {
    const url = new URL(product.sourceURL);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

