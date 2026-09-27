import type { Vec2 } from "./types";

// 3D Studio keyboard moves: arrow keys step the selected item along the room's X or Y axis, picking
// whichever axis best matches the key's direction on screen, so "up" moves the item up in the current
// view (the default diagonal view, overhead, or wherever the user has orbited). + and − step it up
// and down the Z axis.

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export const isArrowKey = (key: string): key is ArrowKey => key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";

/** Within about 10° of a diagonal, left/right keep to X and up/down keep to Y, so the diagonal default view stays predictable. */
const DIAGONAL_MARGIN = 0.17;

/**
 * The room axis and direction an arrow key moves along. `screenRight` is the unit floor direction that
 * points right on screen; screen-up on the floor is that turned a quarter counter-clockwise.
 */
export function arrowAxis(key: ArrowKey, screenRight: Vec2): { axis: keyof Vec2; direction: 1 | -1 } {
  const up = { x: -screenRight.y, y: screenRight.x };
  const want = key === "ArrowRight" ? screenRight
    : key === "ArrowLeft" ? { x: -screenRight.x, y: -screenRight.y }
      : key === "ArrowUp" ? up
        : { x: -up.x, y: -up.y };
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const across = Math.abs(want.x);
  const along = Math.abs(want.y);
  const useX = horizontal ? across >= along - DIAGONAL_MARGIN : across > along + DIAGONAL_MARGIN;
  return useX ? { axis: "x", direction: want.x >= 0 ? 1 : -1 } : { axis: "y", direction: want.y >= 0 ? 1 : -1 };
}

/** +1 for the keys that raise an item (+, =, numpad +), -1 for those that lower it (-, _, numpad -), else null. */
export function verticalKey(key: string): 1 | -1 | null {
  if (key === "+" || key === "=" || key === "Add") return 1;
  if (key === "-" || key === "_" || key === "Subtract") return -1;
  return null;
}
