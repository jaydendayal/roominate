import { apiFetch } from "./api";
import { productFor } from "./calculations";
import { generateLayoutCandidates, type LayoutResult } from "./layoutOptimizer";
import type { Project } from "./types";

const labels = {
  balanced: "Balanced perimeter layout",
  open_center: "Open-center layout",
  functional_pairs: "Functional-pair layout",
} as const;

export interface RecommendedLayout {
  result: LayoutResult;
  rationale: string;
}

/** AI ranks whole-room candidates; every coordinate was generated and collision-tested locally first. */
export async function recommendLayout(project: Project): Promise<RecommendedLayout | null> {
  // Let React paint the loading state before the CPU-bound geometry pass begins.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const candidates = generateLayoutCandidates(project);
  if (!candidates.length) return null;
  let selected = candidates[0];
  let rationale = "Used the balanced collision-tested layout.";
  try {
    const recommendation = await apiFetch<{ status: string; candidate_id: string; rationale: string }>("/api/v1/recommend-layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: project.id,
        room_type: project.roomType,
        room_width_m: project.room.width,
        room_length_m: project.room.length,
        priorities: project.priorities,
        candidates: candidates.map((candidate) => ({
          candidate_id: candidate.profile,
          label: labels[candidate.profile],
          placed_count: candidate.placedItemIds.length,
          unplaced_count: candidate.unplacedItemIds.length,
          positions: candidate.project.items.filter((item) => item.transform && candidate.placedItemIds.includes(item.id)).map((item) => ({
            item_id: item.id,
            name: productFor(candidate.project, item)?.name ?? "Unknown item",
            category: productFor(candidate.project, item)?.category ?? "other",
            x_m: item.transform!.position.x,
            y_m: item.transform!.position.y,
            rotation_degrees: Math.round((((item.transform!.rotationZ * 180) / Math.PI) % 360 + 360) % 360),
          })),
        })),
      }),
    });
    selected = candidates.find((candidate) => candidate.profile === recommendation.candidate_id) ?? candidates[0];
    rationale = recommendation.rationale;
  } catch {
    rationale = "AI ranking was unavailable, so Roominate used the balanced collision-tested layout.";
  }
  return { result: selected, rationale };
}

export function layoutResultMessage({ result, rationale }: RecommendedLayout) {
  return result.unplacedItemIds.length
    ? `${rationale} Placed ${result.placedItemIds.length} items; ${result.unplacedItemIds.length} could not fit or need complete dimensions.`
    : `${rationale} ${result.placedItemIds.length} movable items were placed; locked items stayed fixed.`;
}
