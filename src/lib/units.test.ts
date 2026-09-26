import { describe, expect, it } from "vitest";
import { formatDimensions, formatLength, fromUnit, gridLabel, gridOptions, isGridOption, lengthInputValue, lengthUnitFor, METERS_PER_FOOT, toUnit } from "./units";

describe("length units", () => {
  it("round-trips every display unit through meters", () => {
    for (const unit of ["m", "cm", "ft", "in"] as const) {
      expect(fromUnit(toUnit(2.37, unit), unit)).toBeCloseTo(2.37, 10);
    }
    expect(fromUnit(12, "ft")).toBeCloseTo(3.6576, 10);
    expect(fromUnit(43, "in")).toBeCloseTo(1.0922, 10);
  });

  it("uses room-scale and object-scale units per system", () => {
    expect(lengthUnitFor("imperial", "room")).toBe("ft");
    expect(lengthUnitFor("imperial", "object")).toBe("in");
    expect(lengthUnitFor("metric", "room")).toBe("m");
    expect(lengthUnitFor("metric", "object")).toBe("cm");
  });

  it("formats room lengths as feet and inches without 12-inch remainders", () => {
    expect(formatLength(3.66, "imperial")).toBe("12′ 0″");
    expect(formatLength(3.05, "imperial")).toBe("10′ 0″");
    expect(formatLength(12 * METERS_PER_FOOT - 0.001, "imperial")).toBe("12′ 0″");
    expect(formatLength(3.66, "metric")).toBe("3.66 m");
    expect(formatLength(null, "metric")).toBe("unknown");
  });

  it("formats object dimensions and keeps unknown values visible", () => {
    expect(formatDimensions({ width: 1.52, depth: 0.76, height: 0.76 }, "imperial")).toBe("59.8 × 29.9 × 29.9 in");
    expect(formatDimensions({ width: 1.52, depth: 0.76, height: null }, "metric")).toBe("152 × 76 × ? cm");
    expect(formatDimensions({ width: null, depth: null, height: null }, "metric")).toBe("Dimensions unknown");
  });

  it("produces stable input text for stored meters", () => {
    expect(lengthInputValue(fromUnit(12.5, "ft"), "ft")).toBe("12.5");
    expect(lengthInputValue(null, "cm")).toBe("");
  });
});

describe("grid scale options", () => {
  it("offers exact real-world square sizes", () => {
    expect(gridOptions.imperial.map((option) => option.meters)).toEqual([0.1524, 0.3048, 0.6096, 0.9144].map((value) => expect.closeTo(value, 10)));
    expect(gridLabel("imperial", METERS_PER_FOOT)).toBe("1 ft");
    expect(gridLabel("metric", 0.5)).toBe("50 cm");
  });

  it("rejects sizes from the other unit system", () => {
    expect(isGridOption("metric", 0.5)).toBe(true);
    expect(isGridOption("metric", METERS_PER_FOOT)).toBe(false);
    expect(isGridOption("imperial", "0.3048")).toBe(false);
  });
});
