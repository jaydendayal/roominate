"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultGridSize, formatDimensions, formatLength, isGridOption, lengthUnitFor, type LengthScale, type UnitSystem } from "@/lib/units";
import type { Dimensions } from "@/lib/types";

const STORAGE_KEY = "roominate.preferences.v1";

interface StoredPreferences {
  unitSystem: UnitSystem;
  gridSize: Record<UnitSystem, number>;
}

function localeDefaultSystem(): UnitSystem {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region === "US" || region === "LR" || region === "MM" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

function loadPreferences(): StoredPreferences {
  const fallback: StoredPreferences = { unitSystem: localeDefaultSystem(), gridSize: { ...defaultGridSize } };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    const grid = (system: UnitSystem) => {
      const stored = parsed.gridSize?.[system];
      return isGridOption(system, stored) ? stored : defaultGridSize[system];
    };
    return {
      unitSystem: parsed.unitSystem === "imperial" || parsed.unitSystem === "metric" ? parsed.unitSystem : fallback.unitSystem,
      gridSize: { metric: grid("metric"), imperial: grid("imperial") },
    };
  } catch {
    return fallback;
  }
}

interface UnitPreferences {
  unitSystem: UnitSystem;
  setUnitSystem: (system: UnitSystem) => void;
  /** Grid square size in meters for the active unit system. */
  gridSize: number;
  setGridSize: (meters: number) => void;
  formatLength: (meters: number | null, scale?: LengthScale) => string;
  formatDimensions: (dimensions: Dimensions) => string;
  roomUnit: ReturnType<typeof lengthUnitFor>;
  objectUnit: ReturnType<typeof lengthUnitFor>;
}

const UnitPreferencesContext = createContext<UnitPreferences | null>(null);

export function UnitPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<StoredPreferences>({ unitSystem: "metric", gridSize: { ...defaultGridSize } });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPreferences(loadPreferences());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are a convenience; the app works with in-memory values.
    }
  }, [preferences, hydrated]);

  const setUnitSystem = useCallback((unitSystem: UnitSystem) => setPreferences((current) => ({ ...current, unitSystem })), []);
  const setGridSize = useCallback((meters: number) => setPreferences((current) =>
    isGridOption(current.unitSystem, meters) ? { ...current, gridSize: { ...current.gridSize, [current.unitSystem]: meters } } : current,
  ), []);

  const value = useMemo<UnitPreferences>(() => {
    const system = preferences.unitSystem;
    return {
      unitSystem: system,
      setUnitSystem,
      gridSize: preferences.gridSize[system],
      setGridSize,
      formatLength: (meters, scale = "room") => formatLength(meters, system, scale),
      formatDimensions: (dimensions) => formatDimensions(dimensions, system),
      roomUnit: lengthUnitFor(system, "room"),
      objectUnit: lengthUnitFor(system, "object"),
    };
  }, [preferences, setGridSize, setUnitSystem]);

  return <UnitPreferencesContext.Provider value={value}>{children}</UnitPreferencesContext.Provider>;
}

export function useUnitPreferences() {
  const context = useContext(UnitPreferencesContext);
  if (!context) throw new Error("useUnitPreferences must be used inside UnitPreferencesProvider");
  return context;
}
