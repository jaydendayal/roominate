"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBlankProject, createDemoProject } from "@/lib/demo";
import type { Project } from "@/lib/types";

const STORAGE_KEY = "roominate.projects.v1";

interface PersistedState {
  projects: Project[];
}

type LegacyPosition = { x: number; y?: number; z?: number };
type LegacyTransform = { position: LegacyPosition; rotationZ?: number; rotationY?: number };

function migrateProjectAxes(source: Project): Project {
  const project = structuredClone(source);
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
  return project;
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return [createDemoProject()];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createDemoProject()];
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed.projects?.length ? parsed.projects.map(migrateProjectAxes) : [createDemoProject()];
  } catch {
    return [createDemoProject()];
  }
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>([createDemoProject()]);
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
    setProjects((current) => {
      const rest = current.filter((project) => project.id !== "project-demo");
      return [createDemoProject(), ...rest];
    });
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
