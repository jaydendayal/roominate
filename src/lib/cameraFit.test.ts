import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW_DIRECTION, fitCameraTo, floorCorners, OVERHEAD_VIEW_DIRECTION, roomCorners, VIEW_SAFE_AREA } from "./cameraFit";

// The demo room, with the Studio's camera (42° vertical field of view).
const room = { width: 3.66, length: 3.05, height: 2.44 };

function frame(direction: THREE.Vector3, aspect: number) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.05, 100);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(room.width / 2, room.length / 2, 0.6);
  // The same points the Studio frames: the floor from overhead, the floor and wall tops otherwise.
  const corners = direction === OVERHEAD_VIEW_DIRECTION ? floorCorners(room.width, room.length) : roomCorners(room.width, room.length, room.height);
  fitCameraTo(camera, target, direction, corners);
  const projected = corners.map((corner) => corner.clone().project(camera));
  // How close the room comes to the safe area's nearest edge (0 = touching it).
  const slack = Math.min(...projected.flatMap((point) => [VIEW_SAFE_AREA.x - Math.abs(point.x), point.y - VIEW_SAFE_AREA.bottom, VIEW_SAFE_AREA.top - point.y]));
  return { camera, projected, slack };
}

describe("room view framing", () => {
  for (const [name, aspect] of [["a tall Studio viewport", 642 / 806], ["a wide viewport", 1.6]] as const) {
    it(`fits the whole room with a margin overhead, as close as it can, in ${name}`, () => {
      const { camera, projected, slack } = frame(OVERHEAD_VIEW_DIRECTION, aspect);
      // The floor plus its margin is on screen inside the safe area...
      for (const point of projected) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(VIEW_SAFE_AREA.x);
        expect(point.y).toBeGreaterThanOrEqual(VIEW_SAFE_AREA.bottom);
        expect(point.y).toBeLessThanOrEqual(VIEW_SAFE_AREA.top);
      }
      // ...and reaches the edge of it, so it isn't zoomed out further than needed.
      expect(slack).toBeGreaterThanOrEqual(0);
      expect(slack).toBeLessThan(0.01);
      // The room's own edges, where the walls stand, sit clearly inside the view rather than at its border.
      const floorSlack = Math.min(...roomCorners(room.width, room.length, 0).map((corner) => corner.project(camera)).flatMap((point) => [VIEW_SAFE_AREA.x - Math.abs(point.x), point.y - VIEW_SAFE_AREA.bottom, VIEW_SAFE_AREA.top - point.y]));
      expect(floorSlack).toBeGreaterThan(0.05);
      // Straight down, from above the walls.
      expect(camera.position.z).toBeGreaterThan(room.height);
      expect(Math.hypot(camera.position.x - room.width / 2, camera.position.y - room.length / 2)).toBeLessThan(0.01);
    });
  }

  it("keeps north at the top of the overhead view", () => {
    const { camera } = frame(OVERHEAD_VIEW_DIRECTION, 1.6);
    const north = new THREE.Vector3(room.width / 2, room.length, 0).project(camera);
    const south = new THREE.Vector3(room.width / 2, 0, 0).project(camera);
    const east = new THREE.Vector3(room.width, room.length / 2, 0).project(camera);
    const west = new THREE.Vector3(0, room.length / 2, 0).project(camera);
    expect(north.y).toBeGreaterThan(south.y);
    expect(east.x).toBeGreaterThan(west.x);
  });

  it("still fits the room in the default diagonal view", () => {
    const { slack } = frame(DEFAULT_VIEW_DIRECTION, 642 / 806);
    expect(slack).toBeGreaterThanOrEqual(0);
    expect(slack).toBeLessThan(0.01);
  });
});
