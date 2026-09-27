import * as THREE from "three";

// Framing for the 3D room views: the camera is backed out along a view direction until the whole room
// fits on screen, clear of the toolbar above and the legend and settings below.

export const MIN_VIEW_DISTANCE = 2;
export const MAX_VIEW_DISTANCE = 12;
const VIEW_ELEVATION = THREE.MathUtils.degToRad(30);
// +X is east and -Y is south, so the default view looks in diagonally over the south-east corner, the one the cutaway opens.
export const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(Math.SQRT1_2 * Math.cos(VIEW_ELEVATION), -Math.SQRT1_2 * Math.cos(VIEW_ELEVATION), Math.sin(VIEW_ELEVATION));
// Straight down, from a hair to the south so the view has an orientation: north at the top, like a floor plan.
export const OVERHEAD_VIEW_DIRECTION = new THREE.Vector3(0, -0.0002, 1).normalize();
// Screen-space bounds the room must fit inside, in normalized device coordinates, clear of the toolbar above and the legends below.
export const VIEW_SAFE_AREA = { x: 0.88, bottom: -0.74, top: 0.82 };

/** The room's floor corners and the top of each wall corner. */
export function roomCorners(width: number, length: number, height: number) {
  return [[0, 0], [width, 0], [0, length], [width, length]].flatMap(([x, y]) => [new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, height)]);
}

/**
 * What the overhead view frames: the floor plus a margin all round (6% of the room's longer side, at
 * least 25 cm), so the walls around the edge are in view. Seen straight down, the tops of the walls
 * spread out past the floor, and fitting all of them would push the camera far enough to leave the room small.
 */
export function floorCorners(width: number, length: number) {
  const margin = Math.max(0.25, Math.max(width, length) * 0.06);
  return [[-margin, -margin], [width + margin, -margin], [-margin, length + margin], [width + margin, length + margin]].map(([x, y]) => new THREE.Vector3(x, y, 0));
}

/** Backs the camera out from `target` along `direction` until every point is on screen inside the safe area. */
export function fitCameraTo(camera: THREE.PerspectiveCamera, target: THREE.Vector3, direction: THREE.Vector3, points: THREE.Vector3[]) {
  const projected = new THREE.Vector3();
  const fits = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return points.every((point) => {
      projected.copy(point).project(camera);
      // z beyond 1 means the point is behind the camera, where x and y are meaningless.
      return projected.z < 1 && Math.abs(projected.x) <= VIEW_SAFE_AREA.x && projected.y >= VIEW_SAFE_AREA.bottom && projected.y <= VIEW_SAFE_AREA.top;
    });
  };
  let near = MIN_VIEW_DISTANCE;
  let far = MAX_VIEW_DISTANCE;
  for (let step = 0; step < 20; step += 1) {
    const middle = (near + far) / 2;
    if (fits(middle)) far = middle;
    else near = middle;
  }
  fits(far);
}
