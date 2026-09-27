"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { defaultGridSize, formatDimensions, formatLength, isGridOption, lengthUnitFor, METERS_PER_INCH, type LengthScale, type UnitSystem } from "@/lib/units";
import type { Dimensions } from "@/lib/types";

const STORAGE_KEY = "roominate.preferences.v1";

interface StoredPreferences {
  unitSystem: UnitSystem;
  gridSize: Record<UnitSystem, number>;
  snapToGrid: boolean;
  snapToFurniture: boolean;
  /** When on, drags move only in whole multiples of moveStep (meters). Combines with snapToGrid (applied on release). */
  stepMoves: boolean;
  moveStep: number;
}

const DEFAULT_MOVE_STEP: Record<UnitSystem, number> = { imperial: 6 * METERS_PER_INCH, metric: 0.1 };
const MAX_MOVE_STEP = 5;
const validStep = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_MOVE_STEP;

function localeDefaultSystem(): UnitSystem {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region === "US" || region === "LR" || region === "MM" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

function loadPreferences(): StoredPreferences {
  const system = localeDefaultSystem();
  const fallback: StoredPreferences = { unitSystem: system, gridSize: { ...defaultGridSize }, snapToGrid: false, snapToFurniture: false, stepMoves: false, moveStep: DEFAULT_MOVE_STEP[system] };
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
      snapToGrid: parsed.snapToGrid === true,
      snapToFurniture: parsed.snapToFurniture === true,
      stepMoves: parsed.stepMoves === true,
      moveStep: validStep(parsed.moveStep) ? parsed.moveStep : fallback.moveStep,
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
  /** When on, items align their edges to grid lines or walls when a drag ends or an item is rotated. */
  snapToGrid: boolean;
  setSnapToGrid: (snap: boolean) => void;
  /** When on, a nearby furniture edge overrides the grid and attaches flush to the neighboring item. */
  snapToFurniture: boolean;
  setSnapToFurniture: (snap: boolean) => void;
  /** When on, dragged items move only in whole multiples of moveStep from where they started. */
  stepMoves: boolean;
  setStepMoves: (enabled: boolean) => void;
  /** Step distance in meters, also used by the nudge buttons. */
  moveStep: number;
  setMoveStep: (meters: number) => void;
  formatLength: (meters: number | null, scale?: LengthScale) => string;
  formatDimensions: (dimensions: Dimensions) => string;
  roomUnit: ReturnType<typeof lengthUnitFor>;
  objectUnit: ReturnType<typeof lengthUnitFor>;
}

const UnitPreferencesContext = createContext<UnitPreferences | null>(null);

export function UnitPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<StoredPreferences>({ unitSystem: "metric", gridSize: { ...defaultGridSize }, snapToGrid: false, snapToFurniture: false, stepMoves: false, moveStep: DEFAULT_MOVE_STEP.metric });
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
  // Independent: steps apply while dragging, grid snap applies on release, so they combine.
  const setSnapToGrid = useCallback((snapToGrid: boolean) => setPreferences((current) => ({ ...current, snapToGrid })), []);
  const setSnapToFurniture = useCallback((snapToFurniture: boolean) => setPreferences((current) => ({ ...current, snapToFurniture })), []);
  const setStepMoves = useCallback((stepMoves: boolean) => setPreferences((current) => ({ ...current, stepMoves })), []);
  const setMoveStep = useCallback((moveStep: number) => setPreferences((current) => (validStep(moveStep) ? { ...current, moveStep } : current)), []);

  const value = useMemo<UnitPreferences>(() => {
    const system = preferences.unitSystem;
    return {
      unitSystem: system,
      setUnitSystem,
      gridSize: preferences.gridSize[system],
      setGridSize,
      snapToGrid: preferences.snapToGrid,
      setSnapToGrid,
      snapToFurniture: preferences.snapToFurniture,
      setSnapToFurniture,
      stepMoves: preferences.stepMoves,
      setStepMoves,
      moveStep: preferences.moveStep,
      setMoveStep,
      formatLength: (meters, scale = "room") => formatLength(meters, system, scale),
      formatDimensions: (dimensions) => formatDimensions(dimensions, system),
      roomUnit: lengthUnitFor(system, "room"),
      objectUnit: lengthUnitFor(system, "object"),
    };
  }, [preferences, setGridSize, setMoveStep, setSnapToFurniture, setSnapToGrid, setStepMoves, setUnitSystem]);

  return <UnitPreferencesContext.Provider value={value}>{children}</UnitPreferencesContext.Provider>;
}

export function useUnitPreferences() {
  const context = useContext(UnitPreferencesContext);
  if (!context) throw new Error("useUnitPreferences must be used inside UnitPreferencesProvider");
  return context;
}
