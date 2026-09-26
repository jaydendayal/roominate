"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBlankProject, createDemoProject } from "@/lib/demo";
import type { Project } from "@/lib/types";

const STORAGE_KEY = "roominate.projects.v1";

interface PersistedState {
  projects: Project[];
}

function loadProjects(): Project[] {
  if (typeof window === "undefined") return [createDemoProject()];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [createDemoProject()];
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed.projects?.length ? parsed.projects : [createDemoProject()];
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
      ...structuredClone(project),
      id: `project-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProjects((current) => [...current, imported]);
    return imported.id;
  }, []);

  return { projects, hydrated, saveState, updateProject, createProject, duplicateProject, deleteProject, resetDemo, importProject };
}
