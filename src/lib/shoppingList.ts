import { calculateIssues, productFor, purchaseSubtotal } from "./calculations";
import { describeColor } from "./productColors";
import type { Issue, Item, Product, Project } from "./types";

/** Prices observed longer ago than this are labeled stale in the export. */
export const PRICE_STALE_AFTER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const HEADER = [
  "Product",
  "Store",
  "Source URL",
  "Unit price (USD)",
  "Quantity",
  "Line total (USD)",
  "Price observed at",
  "Price status",
  "Buyer",
  "Acquisition status",
  "Priority",
  "Fit status",
  "Color",
];

export function priceStatus(product: Product | undefined, now: Date) {
  if (!product?.price) return "unknown";
  const ageDays = Math.floor((now.getTime() - new Date(product.price.observedAt).getTime()) / DAY_MS);
  if (Number.isFinite(ageDays) && ageDays > PRICE_STALE_AFTER_DAYS) return `stale (observed ${ageDays} days ago)`;
  return product.price.confirmed ? "confirmed" : "unconfirmed estimate";
}

function fitStatus(item: Item, product: Product | undefined, issues: Issue[]) {
  const dimensionsKnown = product != null && Object.values(product.dimensions).every((value) => value != null && value > 0);
  if (!item.transform || !dimensionsKnown) return "unverified";
  const conflict = issues.some((issue) => (issue.type === "fit" || issue.type === "clearance") && issue.affectedItemIds.includes(item.id));
  return conflict ? "conflict" : "fits";
}

const money = (cents: number) => (cents / 100).toFixed(2);

/** Neutralizes spreadsheet formula injection from imported product text. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Rows for every item currently selected for purchase, plus a subtotal row that states whether it is complete. */
export function shoppingListRows(project: Project, now = new Date()): string[][] {
  const issues = calculateIssues(project);
  const rows = [HEADER];
  for (const item of project.items.filter((candidate) => candidate.purchaseStatus === "in_cart")) {
    const product = productFor(project, item);
    const owner = project.people.find((person) => person.id === item.ownerId);
    rows.push([
      product?.name ?? "Unknown product",
      product?.store ?? "",
      product?.sourceURL ?? "",
      product?.price ? money(product.price.amount) : "unknown",
      String(item.quantity),
      product?.price ? money(product.price.amount * item.quantity) : "unknown",
      product?.price?.observedAt ?? "",
      priceStatus(product, now),
      owner?.name ?? "Unknown",
      item.acquisitionStatus,
      item.essentiality,
      fitStatus(item, product, issues),
      product ? describeColor(product, item.colorSelection) : "",
    ]);
  }
  const subtotal = purchaseSubtotal(project);
  const unpriced = rows.slice(1).filter((row) => row[3] === "unknown").length;
  rows.push([]);
  rows.push([
    "Known subtotal",
    "",
    "",
    "",
    "",
    money(subtotal.amount),
    "",
    subtotal.complete ? "complete" : `incomplete: ${unpriced} item${unpriced === 1 ? "" : "s"} without a price`,
    "",
    "",
    "",
    "Shipping and tax not included",
    "",
  ]);
  return rows;
}

export function shoppingListCsv(project: Project, now = new Date()) {
  return shoppingListRows(project, now).map((row) => row.map(cell).join(",")).join("\r\n");
}

export function shoppingListFilename(project: Project) {
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "roominate"}-shopping-list.csv`;
}

/** Browser-only: downloads the current cart as CSV (BOM so spreadsheet apps read UTF-8 names correctly). */
export function downloadShoppingList(project: Project) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["﻿", shoppingListCsv(project)], { type: "text/csv;charset=utf-8" }));
  link.download = shoppingListFilename(project);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
