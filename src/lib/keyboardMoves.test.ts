import { describe, expect, it } from "vitest";
import { arrowAxis, isArrowKey, verticalKey } from "./keyboardMoves";

const SQRT1_2 = Math.SQRT1_2;

describe("3D Studio keyboard moves", () => {
  it("moves along the room axes when the view is square to the room", () => {
    const right = { x: 1, y: 0 };
    expect(arrowAxis("ArrowRight", right)).toEqual({ axis: "x", direction: 1 });
    expect(arrowAxis("ArrowLeft", right)).toEqual({ axis: "x", direction: -1 });
    expect(arrowAxis("ArrowUp", right)).toEqual({ axis: "y", direction: 1 });
    expect(arrowAxis("ArrowDown", right)).toEqual({ axis: "y", direction: -1 });
  });

  it("keeps left/right on X and up/down on Y in the diagonal default view", () => {
    // The default camera looks in over the south-east corner: screen-right runs north-east on the floor.
    const right = { x: SQRT1_2, y: SQRT1_2 };
    expect(arrowAxis("ArrowRight", right)).toEqual({ axis: "x", direction: 1 });
    expect(arrowAxis("ArrowLeft", right)).toEqual({ axis: "x", direction: -1 });
    expect(arrowAxis("ArrowUp", right)).toEqual({ axis: "y", direction: 1 });
    expect(arrowAxis("ArrowDown", right)).toEqual({ axis: "y", direction: -1 });
  });

  it("follows the camera when the room is seen turned around", () => {
    // Looking from the north, screen-right is west and screen-up is south.
    const right = { x: -1, y: 0 };
    expect(arrowAxis("ArrowRight", right)).toEqual({ axis: "x", direction: -1 });
    expect(arrowAxis("ArrowUp", right)).toEqual({ axis: "y", direction: -1 });
    // Looking from the east, screen-right is north, so left/right move along Y.
    const fromEast = { x: 0, y: 1 };
    expect(arrowAxis("ArrowRight", fromEast)).toEqual({ axis: "y", direction: 1 });
    expect(arrowAxis("ArrowUp", fromEast)).toEqual({ axis: "x", direction: -1 });
  });

  it("recognizes arrow and +/− keys", () => {
    expect(isArrowKey("ArrowUp")).toBe(true);
    expect(isArrowKey("w")).toBe(false);
    expect(["+", "=", "Add"].map(verticalKey)).toEqual([1, 1, 1]);
    expect(["-", "_", "Subtract"].map(verticalKey)).toEqual([-1, -1, -1]);
    expect(verticalKey("z")).toBeNull();
  });
});
