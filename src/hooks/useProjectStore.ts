"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureProvidedBed, isRoomBedItem } from "@/lib/beds";
import { BETTER_CART_TEST_PROJECT_ID, createBetterCartTestProject, createBlankProject, createDemoProject, isBuiltInProject } from "@/lib/demo";
import { initialProductPlacement } from "@/lib/discovery";
import { mergeShortlistProducts } from "@/lib/shortlist";
import type { Project } from "@/lib/types";

const STORAGE_KEY = "roominate.projects.v1";

interface PersistedState {
  projects: Project[];
}

type LegacyPosition = { x: number; y?: number; z?: number };
type LegacyTransform = { position: LegacyPosition; rotationZ?: number; rotationY?: number };

function migrateProjectAxes(source: Project): Project {
  const project = structuredClone(source);
  project.products = mergeShortlistProducts(project.products);
  const position = (value: LegacyPosition) => ({ x: value.x, y: value.y ?? value.z ?? 0 });
  project.room.features = project.room.features.map((feature) => ({ ...feature, position: position(feature.position as LegacyPosition) }));
  project.room.clearanceZones = project.room.clearanceZones.map((zone) => ({ ...zone, position: position(zone.position as LegacyPosition) }));
  project.items = project.items.map((item) => {
    if (!item.transform) return item;
    const transform = item.transform as unknown as LegacyTransform;
    return {
      ...item,
      transform: {
        position: position(transform.position),
        rotationZ: transform.rotationZ ?? transform.rotationY ?? 0,
      },
    };
  });
  project.items = project.items.map((item) => {
    if (item.transform) return item;
    const product = project.products.find((candidate) => candidate.id === item.productId);
    return product?.tags.includes("shortlist") ? { ...item, transform: initialProductPlacement(project, product) } : item;
  });
  if (project.proposal) {
    project.proposal.changes = project.proposal.changes.map((change) => {
      const legacy = change as typeof change & { rotationY?: number };
      return {
        ...change,
        position: change.position ? position(change.position as LegacyPosition) : undefined,
        rotationZ: change.rotationZ ?? legacy.rotationY,
      };
    });
  }
  // Last, so the default bed is placed against the migrated positions. A saved demo gets the fixture's bed spot.
  const withBed = ensureProvidedBed(project);
  if (project.id !== "project-demo" || project.room.providedBed !== undefined) return withBed;
  const demoBed = createDemoProject().items.find(isRoomBedItem)!;
  return { ...withBed, items: withBed.items.map((item) => isRoomBedItem(item) ? { ...item, transform: demoBed.transform } : item) };
}

// Made-up products from the original demo fixture, since replaced by real shortlist products.
const LEGACY_DEMO_PRODUCT_IDS = new Set(["prod-desk-wide", "prod-desk-compact", "prod-chair", "prod-micro-jay", "prod-micro-maya", "prod-heater", "prod-shelf", "prod-dresser"]);

/** Swaps a saved copy of the old demo for the current one, and drops unused made-up products from other projects. */
function removeLegacyDemoProducts(project: Project): Project {
  if (!project.products.some((product) => LEGACY_DEMO_PRODUCT_IDS.has(product.id))) return project;
  if (project.id === "project-demo") return createDemoProject();
  const used = new Set(project.items.map((item) => item.productId));
  return { ...project, products: project.products.filter((product) => !LEGACY_DEMO_PRODUCT_IDS.has(product.id) || used.has(product.id)) };
}

/** The built-in rooms: the Maple Hall demo, then the room that exercises every Better Cart path. */
const builtInProjects = () => [createDemoProject(), createBetterCartTestProject()];

/** Adds the Better Cart test room to projects saved before it existed, right after the demo. */
function withBetterCartTestRoom(projects: Project[]): Project[] {
  if (projects.some((project) => project.id === BETTER_CART_TEST_PROJECT_ID)) return projects;
  const at = projects.findIndex((project) => project.id === "project-demo") + 1;
  return [...projects.slice(0, at), createBetterCartTestProject(), ...projects.slice(at)];
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return builtInProjects();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return builtInProjects();
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed.projects?.length ? withBetterCartTestRoom(parsed.projects.map((project) => migrateProjectAxes(removeLegacyDemoProducts(project)))) : builtInProjects();
  } catch {
    return builtInProjects();
  }
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>(builtInProjects);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setProjects(loadProjects());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects } satisfies PersistedState));
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 260);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [projects, hydrated]);

  const updateProject = useCallback((id: string, updater: (project: Project) => Project) => {
    setProjects((current) =>
      current.map((project) =>
        project.id === id ? { ...updater(project), updatedAt: new Date().toISOString() } : project,
      ),
    );
  }, []);

  const createProject = useCallback((name?: string) => {
    const project = createBlankProject(name);
    setProjects((current) => [...current, project]);
    return project.id;
  }, []);

  const duplicateProject = useCallback((id: string) => {
    const source = projects.find((project) => project.id === id);
    if (!source) return null;
    const copy: Project = {
      ...structuredClone(source),
      id: `project-${crypto.randomUUID()}`,
      name: `${source.name} copy`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjects((current) => [...current, copy]);
    return copy.id;
  }, [projects]);

  const deleteProject = useCallback((id: string) => {
    setProjects((current) => current.filter((project) => project.id !== id));
  }, []);

  const resetDemo = useCallback(() => {
    setProjects((current) => [...builtInProjects(), ...current.filter((project) => !isBuiltInProject(project.id))]);
  }, []);

  const importProject = useCallback((project: Project) => {
    const imported: Project = {
      ...migrateProjectAxes(project),
      id: `project-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjects((current) => [...current, imported]);
    return imported.id;
  }, []);

  return { projects, hydrated, saveState, updateProject, createProject, duplicateProject, deleteProject, resetDemo, importProject };
}
