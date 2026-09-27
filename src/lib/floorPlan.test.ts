import { describe, expect, it } from "vitest";
import { assignOverallDimensions, planOpeningFeatures, planRoomShape, planScale, planWalls, wallLabel, wallMeters } from "./floorPlan";
import { roomArea } from "./roomShape";

// A traced L in image pixels (y down): 200 × 160 with the bottom-right 100 × 80 missing.
const lOutline = [{ x: 20, y: 10 }, { x: 220, y: 10 }, { x: 220, y: 90 }, { x: 120, y: 90 }, { x: 120, y: 170 }, { x: 20, y: 170 }];
const noMeasurements = { walls: {}, overall: {} };

describe("plan walls", () => {
  it("letters walls clockwise from the top-left corner", () => {
    const walls = planWalls([...lOutline].reverse());
    expect(walls.map((wall) => wall.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(walls[0]).toMatchObject({ start: { x: 20, y: 10 }, end: { x: 220, y: 10 }, lengthPx: 200, axis: "x" });
    expect(walls[1].axis).toBe("y");
    expect(wallLabel(27)).toBe("AB");
  });
});

describe("plan scale", () => {
  it("scales the whole plan from one measured wall", () => {
    const scale = planScale(lOutline, { walls: { 0: 5 }, overall: {} }, 10);
    expect(scale).toMatchObject({ x: 0.025, y: 0.025, measured: true, disagreement: 0 });
    const walls = planWalls(lOutline);
    expect(wallMeters(walls[5], scale)).toBeCloseTo(4, 9);
  });

  it("scales each axis from measurements on both", () => {
    const scale = planScale(lOutline, { walls: { 0: 5, 5: 4.8 }, overall: {} }, 10);
    expect(scale.x).toBeCloseTo(0.025, 9);
    expect(scale.y).toBeCloseTo(0.03, 9);
  });

  it("reports measurements that disagree along one axis", () => {
    const scale = planScale(lOutline, { walls: { 0: 5, 2: 2.75 }, overall: {} }, 10);
    expect(scale.disagreement).toBeCloseTo(0.0952, 3);
  });

  it("uses overall dimensions read from the plan", () => {
    const scale = planScale(lOutline, { walls: {}, overall: { x: 6, y: 4 } }, 10);
    expect(scale.x).toBeCloseTo(0.03, 9);
    expect(scale.y).toBeCloseTo(0.025, 9);
  });

  it("keeps the proportions at an estimated size when nothing is measured", () => {
    const scale = planScale(lOutline, noMeasurements, 12);
    expect(scale.measured).toBe(false);
    expect(roomArea(planRoomShape(lOutline, scale))).toBeCloseTo(12, 2);
  });

  it("assigns a pair of overall dimensions to the axes they fit", () => {
    expect(assignOverallDimensions(4, 5, lOutline)).toEqual({ x: 5, y: 4 });
    expect(assignOverallDimensions(5, 4, lOutline)).toEqual({ x: 5, y: 4 });
  });
});

describe("plan to room", () => {
  it("puts the top of the plan to the north", () => {
    const shape = planRoomShape(lOutline, planScale(lOutline, { walls: { 0: 5 }, overall: {} }, 10));
    expect(shape.width).toBe(5);
    expect(shape.length).toBe(4);
    // The missing corner is at the bottom right of the image, so south-east in the room.
    expect(shape.outline).toContainEqual({ x: 1, y: 0.5 });
    expect(shape.outline).toContainEqual({ x: 0.5, y: 0.5 });
    expect(shape.outline).toContainEqual({ x: 0.5, y: 0 });
    expect(roomArea(shape)).toBeCloseTo(15, 6);
  });

  it("places a door read from the plan on its wall as an unconfirmed feature", () => {
    const scale = planScale(lOutline, { walls: { 0: 5 }, overall: {} }, 10);
    const room = planRoomShape(lOutline, scale);
    const trace = { outline: lOutline, angle: 0, center: { x: 120, y: 90 } };
    // Image is 240 × 180; the door is drawn on the right wall of the upper arm, spanning a third of it.
    const [door] = planOpeningFeatures([{ kind: "door", label: "Entry door", wallLabel: null, position: { x: 218 / 240, y: 50 / 180 }, widthRatio: 1 / 3, confidence: 0.8, evidence: "Door swing on right wall" }], trace, { width: 240, height: 180 }, scale, room);
    expect(door).toMatchObject({ kind: "door", wall: "east", source: "imported_plan", confirmed: false });
    expect(door.position.x).toBeCloseTo(5 - 0.04, 6);
    expect(door.position.y).toBeCloseTo(3, 6);
    expect(door.width).toBeCloseTo(2 / 3, 6);
  });
});
