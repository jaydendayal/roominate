import type { Project } from "@/lib/types";

/** A roommate's colour: a fill from the drafting palette, and a mark (initial or icon) that stays legible on it. */
export interface PersonTone {
  fill: string;
  mark: string;
}

/**
 * Roommates are coloured by their place in the project's people list rather than by their stored `color`,
 * which older saves and the invite service still fill from the retired coral/sage set. Lavender is left out
 * because it marks the selected item in the 3D room.
 */
const PERSON_TONES: PersonTone[] = [
  { fill: "#847979", mark: "#f4f3f7" }, // Rosy Granite
  { fill: "#4f4b93", mark: "#f4f3f7" }, // Periwinkle, deepened (--accent-ink)
  { fill: "#a8998f", mark: "#322e18" }, // Cardboard, from the homepage model
  { fill: "#4a452c", mark: "#f4f3f7" }, // Dark Khaki, lifted (--ink-hover)
];
const UNASSIGNED_TONE: PersonTone = { fill: "#cfccd6", mark: "#322e18" }; // Pale Slate

export function personTone(project: Pick<Project, "people">, personId: string | null | undefined): PersonTone {
  const index = project.people.findIndex((person) => person.id === personId);
  return index < 0 ? UNASSIGNED_TONE : PERSON_TONES[index % PERSON_TONES.length];
}
