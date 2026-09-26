import type { Dimensions } from "./types";

// Geometry is always stored in meters; these helpers convert only at input/output.

export type UnitSystem = "metric" | "imperial";
export type LengthUnit = "m" | "cm" | "ft" | "in";
/** Room-scale lengths (walls, positions) vs. object-scale lengths (furniture dimensions). */
export type LengthScale = "room" | "object";

export const METERS_PER_INCH = 0.0254;
export const METERS_PER_FOOT = 0.3048;

const metersPerUnit: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  ft: METERS_PER_FOOT,
  in: METERS_PER_INCH,
};

/** Decimal places shown when a length is edited in a numeric field. */
const inputPrecision: Record<LengthUnit, number> = { m: 3, cm: 1, ft: 2, in: 1 };

export function lengthUnitFor(system: UnitSystem, scale: LengthScale): LengthUnit {
  if (system === "imperial") return scale === "room" ? "ft" : "in";
  return scale === "room" ? "m" : "cm";
}

export function toUnit(meters: number, unit: LengthUnit) {
  return meters / metersPerUnit[unit];
}

export function fromUnit(value: number, unit: LengthUnit) {
  return value * metersPerUnit[unit];
}

function trimmed(value: number, maxDecimals: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxDecimals, useGrouping: false }).format(value);
}

/** Editable numeric text for a stored meter value, e.g. 3.66 m -> "12.01" (ft). */
export function lengthInputValue(meters: number | null, unit: LengthUnit) {
  if (meters == null || !Number.isFinite(meters)) return "";
  return trimmed(toUnit(meters, unit), inputPrecision[unit]);
}

function feetAndInches(meters: number) {
  const totalInches = Math.round(Math.abs(meters) / METERS_PER_INCH);
  const sign = meters < 0 && totalInches > 0 ? "-" : "";
  return `${sign}${Math.floor(totalInches / 12)}′ ${totalInches % 12}″`;
}

export function formatLength(meters: number | null, system: UnitSystem, scale: LengthScale = "room") {
  if (meters == null || !Number.isFinite(meters)) return "unknown";
  const unit = lengthUnitFor(system, scale);
  if (unit === "ft") return feetAndInches(meters);
  if (unit === "in") return `${trimmed(toUnit(meters, "in"), 1)}″`;
  if (unit === "cm") return `${trimmed(toUnit(meters, "cm"), 1)} cm`;
  return `${meters.toFixed(2)} m`;
}

/** Width × depth × height of an object, e.g. "59.8 × 29.9 × 29.9 in". */
export function formatDimensions(dimensions: Dimensions, system: UnitSystem) {
  const values = [dimensions.width, dimensions.depth, dimensions.height];
  if (values.every((value) => value == null)) return "Dimensions unknown";
  const unit = lengthUnitFor(system, "object");
  const numbers = values.map((value) => (value == null ? "?" : trimmed(toUnit(value, unit), 1)));
  return `${numbers.join(" × ")} ${unit}`;
}

export interface GridOption {
  meters: number;
  label: string;
}

/** Grid square sizes offered per unit system; exact conversions so squares line up with real measurements. */
export const gridOptions: Record<UnitSystem, GridOption[]> = {
  metric: [
    { meters: 0.1, label: "10 cm" },
    { meters: 0.25, label: "25 cm" },
    { meters: 0.5, label: "50 cm" },
    { meters: 1, label: "1 m" },
  ],
  imperial: [
    { meters: 6 * METERS_PER_INCH, label: "6 in" },
    { meters: METERS_PER_FOOT, label: "1 ft" },
    { meters: 2 * METERS_PER_FOOT, label: "2 ft" },
    { meters: 3 * METERS_PER_FOOT, label: "3 ft" },
  ],
};

export const defaultGridSize: Record<UnitSystem, number> = {
  metric: 0.5,
  imperial: METERS_PER_FOOT,
};

export function isGridOption(system: UnitSystem, meters: unknown): meters is number {
  return typeof meters === "number" && gridOptions[system].some((option) => Math.abs(option.meters - meters) < 1e-9);
}

export function gridLabel(system: UnitSystem, meters: number) {
  return gridOptions[system].find((option) => Math.abs(option.meters - meters) < 1e-9)?.label ?? formatLength(meters, system, "object");
}
