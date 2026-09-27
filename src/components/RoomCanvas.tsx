"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { LengthInput } from "./LengthInput";
import { calculateIssues, collidingItemIds, featureWall, itemElevation, itemExceedsRoom, itemExceedsRoomBox, itemHasConflict, productFor, settledElevation, stackedElevation } from "@/lib/calculations";
import { visualProfileFor } from "@/lib/productModels";
import { floorGridSegments, roomPolygon, wallSegments } from "@/lib/roomShape";
import { normalizeRotation, snapItemPosition, snapRotation, stepPosition } from "@/lib/snap";
import type { Issue, Item, Project, Room, RoomFeature, Vec2 } from "@/lib/types";
import { gridOptions } from "@/lib/units";
import { FurnitureModel } from "./FurnitureModel";
import { personTone } from "./personTones";

interface RoomCanvasProps {
  project: Project;
  issues: Issue[];
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
  onMoveItem?: (itemId: string, position: Vec2, elevation: number, rotationZ: number) => void;
  cutaway?: boolean;
  viewCommand?: { type: "reset" | "overhead"; nonce: number };
  compact?: boolean;
}

const MIN_VIEW_DISTANCE = 2;
const MAX_VIEW_DISTANCE = 12;
const VIEW_ELEVATION = THREE.MathUtils.degToRad(30);
// +X is east and -Y is south, so the default view looks in diagonally over the south-east corner, the one the cutaway opens.
const DEFAULT_VIEW_DIRECTION = new THREE.Vector3(Math.SQRT1_2 * Math.cos(VIEW_ELEVATION), -Math.SQRT1_2 * Math.cos(VIEW_ELEVATION), Math.sin(VIEW_ELEVATION));
// Screen-space bounds the room must fit inside, in normalized device coordinates, clear of the toolbar above and the legends below.
const VIEW_SAFE_AREA = { x: 0.88, bottom: -0.74, top: 0.82 };

/** Backs the camera out from `target` along `direction` until every point is on screen inside the safe area. */
function fitCameraTo(camera: THREE.PerspectiveCamera, target: THREE.Vector3, direction: THREE.Vector3, points: THREE.Vector3[]) {
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

function CameraRig({ project, command, cutaway, controlsRef }: { project: Project; command?: RoomCanvasProps["viewCommand"]; cutaway?: boolean; controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((state) => state.camera);
  // Read when a view is applied, but toggling the cutaway or resizing shouldn't move a camera the user has placed.
  const cutawayNow = useRef(cutaway);
  useEffect(() => {
    cutawayNow.current = cutaway;
  }, [cutaway]);
  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) {
      // One undamped update spends the momentum left from the last drag, which would otherwise carry the camera off the new view.
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = damping;
    }
    camera.up.set(0, 0, 1);
    const { width, length, height } = project.room;
    const center = new THREE.Vector3(width / 2, length / 2, 0.6);
    if (command?.type === "overhead") {
      camera.position.set(width / 2, length / 2 + 0.001, Math.max(5.5, length * 1.8));
      camera.lookAt(center);
    } else if (camera instanceof THREE.PerspectiveCamera) {
      // Frame the floor and the top of every wall that's drawn; the cutaway leaves the near top corner empty.
      const corners = [[0, 0], [width, 0], [0, length], [width, length]].flatMap(([x, y]) => [new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, height)]);
      fitCameraTo(camera, center, DEFAULT_VIEW_DIRECTION, cutawayNow.current ? corners.filter((corner) => !(corner.x === width && corner.y === 0 && corner.z === height)) : corners);
    }
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
  }, [camera, command, controlsRef, project.room.height, project.room.length, project.room.width]);
  return null;
}

const MAX_GRID_LINES_PER_AXIS = 400;

/** Floor grid with exact square size, anchored at the room origin corner so squares count out from the walls, clipped to the floor. */
function FloorGrid({ room, cell }: { room: Pick<Room, "width" | "length" | "outline">; cell: number }) {
  const { width, length, outline } = room;
  const geometry = useMemo(() => {
    const segments = floorGridSegments({ width, length, outline }, cell, MAX_GRID_LINES_PER_AXIS) ?? [];
    const points: number[] = [];
    for (let index = 0; index < segments.length; index += 4) points.push(segments[index], segments[index + 1], 0, segments[index + 2], segments[index + 3], 0);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return buffer;
  }, [cell, length, outline, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} position={[0, 0, 0.004]}>
      <lineBasicMaterial color="#322e18" transparent opacity={0.32} />
    </lineSegments>
  );
}

function GridScaleLegend({ showMovement }: { showMovement: boolean }) {
  const { unitSystem, setUnitSystem, gridSize, setGridSize, snapToGrid, setSnapToGrid, stepMoves, setStepMoves, moveStep, setMoveStep, objectUnit } = useUnitPreferences();
  return (
    <div className="grid-scale" role="group" aria-label="Grid scale, units, and movement">
      <div className="grid-scale-row">
        <span className="grid-scale-swatch" aria-hidden="true" />
        <label>
          <span>1 square =</span>
          <select aria-label="Grid square size" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))}>
            {gridOptions[unitSystem].map((option) => <option key={option.label} value={option.meters}>{option.label}</option>)}
          </select>
        </label>
        <div className="unit-toggle" role="group" aria-label="Distance units">
          <button type="button" aria-pressed={unitSystem === "imperial"} aria-label="Imperial (feet and inches)" title="Imperial (feet and inches)" onClick={() => setUnitSystem("imperial")}>ft</button>
          <button type="button" aria-pressed={unitSystem === "metric"} aria-label="Metric (meters and centimeters)" title="Metric (meters and centimeters)" onClick={() => setUnitSystem("metric")}>m</button>
        </div>
      </div>
      {showMovement && (
        <div className="grid-scale-row">
          <label className="snap-toggle" title="Movement aligns to grid lines and rotation uses 15-degree increments">
            <input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} />
            <span>Snap grid + 15°</span>
          </label>
          <div className="step-toggle" title="While dragging, items move one step of this distance at a time from where they started">
            <label>
              <input type="checkbox" checked={stepMoves} onChange={(event) => setStepMoves(event.target.checked)} />
              <span>Move in steps of</span>
            </label>
            <LengthInput aria-label={`Movement step (${objectUnit})`} min={0} step={1} unit={objectUnit} meters={moveStep} onChange={(meters) => { if (meters != null) setMoveStep(meters); }} />
            <span>{objectUnit}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface RoomClipPlanes {
  inside: THREE.Plane[];
  outside: THREE.Plane[];
}

// Keeps faces lying exactly on a wall or the floor (e.g. an item's base at z = 0) from flickering into the red highlight.
const CLIP_MARGIN = 0.003;

// World-space planes for the room interior. `inside` (union clipping) keeps only what is within the room;
// the negated `outside` set (intersection clipping) keeps only what pokes through a wall, floor, or ceiling.
function roomClipPlanes(width: number, length: number, height: number): RoomClipPlanes {
  const inside = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), width + CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), length + CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), height + CLIP_MARGIN),
  ];
  return { inside, outside: inside.map((plane) => plane.clone().negate()) };
}

// Issue colours match the homepage model: the blocking sticky notes on its mirror, and the palette's danger red.
const CONFLICT_TINT = "#d49a8c";
const OUT_OF_ROOM_RED = "#a3402f";
// The room shell is drawn in the homepage model's card tones; the captured palette only tints it.
const WALL_TONE = "#dedbe4";
const FLOOR_TONE = "#c6c0c6";
const CAPTURED_TINT = 0.3;

/** A shell tone shifted a little toward the colour captured for that surface, so the room stays in the drafting palette. */
function tintedTone(base: string, captured: string | undefined) {
  return captured ? `#${new THREE.Color(base).lerp(new THREE.Color(captured), CAPTURED_TINT).getHexString()}` : base;
}
const HANDLE_BLUE = "#2f7de1";
const HANDLE_PURPLE = "#7652c8";
const FLOOR_SNAP = 0.04;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundMm = (value: number) => Math.round(value * 1000) / 1000;

/** Faint x-ray of the collision box's out-of-room part, so it stays visible behind walls and under the floor. */
function OutOfRoomGhost({ width, height, depth, planes }: { width: number; height: number; depth: number; planes: THREE.Plane[] }) {
  const box = useMemo(() => new THREE.BoxGeometry(width, height, depth), [width, height, depth]);
  const edges = useMemo(() => new THREE.EdgesGeometry(box), [box]);
  useEffect(() => () => {
    box.dispose();
    edges.dispose();
  }, [box, edges]);
  return (
    <>
      <mesh geometry={box} renderOrder={10}>
        <meshBasicMaterial color={OUT_OF_ROOM_RED} transparent opacity={0.22} depthTest={false} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={planes} clipIntersection />
      </mesh>
      <lineSegments geometry={edges} renderOrder={11}>
        <lineBasicMaterial color={OUT_OF_ROOM_RED} transparent depthTest={false} clippingPlanes={planes} clipIntersection />
      </lineSegments>
    </>
  );
}

function ElevationHandle({ offsetZ, active, onPointerDown }: { offsetZ: number; active: boolean; onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const color = active || hovered ? "#79adff" : HANDLE_BLUE;
  // Transparent + no depth test draws the handle after the scene so walls and furniture never hide it.
  const material = <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />;
  useEffect(() => () => {
    gl.domElement.style.cursor = "";
  }, [gl]);
  return (
    <group position={[0, 0, offsetZ]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh
        onPointerDown={onPointerDown}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          gl.domElement.style.cursor = "ns-resize";
        }}
        onPointerOut={() => {
          setHovered(false);
          gl.domElement.style.cursor = "";
        }}
      >
        <cylinderGeometry args={[0.08, 0.08, 0.52, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh renderOrder={20}><cylinderGeometry args={[0.013, 0.013, 0.3, 10]} />{material}</mesh>
      <mesh renderOrder={20} position={[0, 0.19, 0]}><coneGeometry args={[0.048, 0.1, 18]} />{material}</mesh>
      <mesh renderOrder={20} position={[0, -0.19, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.048, 0.1, 18]} />{material}</mesh>
    </group>
  );
}

function RotationHandle({ radius, offsetZ, rotationZ, active, onPointerDown }: { radius: number; offsetZ: number; rotationZ: number; active: boolean; onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const color = active || hovered ? "#a98bea" : HANDLE_PURPLE;
  const degrees = Math.round(normalizeRotation(rotationZ) * 180 / Math.PI);
  useEffect(() => {
    if (active) gl.domElement.style.cursor = "grabbing";
    return () => {
      gl.domElement.style.cursor = "";
    };
  }, [active, gl]);
  return (
    <group position={[0, 0, offsetZ]}>
      <mesh
        onPointerDown={onPointerDown}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          gl.domElement.style.cursor = "grab";
        }}
        onPointerOut={() => {
          setHovered(false);
          if (!active) gl.domElement.style.cursor = "";
        }}
      >
        <ringGeometry args={[Math.max(0.04, radius - 0.1), radius + 0.1, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh renderOrder={20}>
        <ringGeometry args={[Math.max(0.04, radius - 0.012), radius + 0.012, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[radius, 0, 0.015]} renderOrder={21}>
        <sphereGeometry args={[0.055, 18, 12]} />
        <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
      </mesh>
      <Billboard position={[0, -radius - 0.11, 0.03]}>
        <Text fontSize={0.08} color="#fffdf8" outlineColor="#38245f" outlineWidth={0.009} anchorX="center">{degrees}°</Text>
      </Billboard>
    </group>
  );
}

function FurnitureItem({
  project,
  item,
  issues,
  selected,
  clipPlanes,
  onSelect,
  onDrag,
  onDragEnd,
  onLift,
  onLiftEnd,
  onRotate,
  onRotateEnd,
  setDragging,
}: {
  project: Project;
  item: Item;
  issues: Issue[];
  selected: boolean;
  clipPlanes: RoomClipPlanes;
  onSelect?: (id: string) => void;
  /** Live preview while the pointer moves; not persisted. */
  onDrag?: (id: string, position: Vec2) => void;
  /** Called once on release with the final position, or null if the drag was cancelled or never moved. */
  onDragEnd?: (id: string, position: Vec2 | null) => void;
  /** Live preview of the height while the lift arrow is dragged; not persisted. */
  onLift?: (id: string, elevation: number) => void;
  /** Called once on release with the final height, or null if the lift was cancelled or never moved. */
  onLiftEnd?: (id: string, elevation: number | null) => void;
  /** Live preview while the rotation ring is dragged; not persisted. */
  onRotate?: (id: string, rotationZ: number) => void;
  /** Called once on release with the final rotation, or null if cancelled or never moved. */
  onRotateEnd?: (id: string, rotationZ: number | null) => void;
  setDragging: (dragging: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const product = productFor(project, item);
  const conflict = itemHasConflict(issues, item.id);
  const position = item.transform?.position;
  const elevation = itemElevation(item);
  const dimensions = product?.dimensions;
  const activePointer = useRef<number | null>(null);
  const [liftingActive, setLiftingActive] = useState(false);
  const [rotatingActive, setRotatingActive] = useState(false);
  if (!product || !position || dimensions?.width == null || dimensions.depth == null || dimensions.height == null) return null;
  const itemHeight = dimensions.height;
  const rotationZ = item.transform?.rotationZ ?? 0;
  const rotationRadius = Math.hypot(dimensions.width, dimensions.depth) / 2 + 0.16;

  // Clip planes can only cut along the room's bounding box, the floor, and the ceiling. That splits out the
  // part through a rectangular room's walls; an item crossing a traced outline's inner corner is tinted whole instead.
  const exceedsRoom = itemExceedsRoomBox(project, item);
  // Wall/floor/ceiling violations are shown by the red out-of-room part, so they don't tint the whole item.
  const tintConflict = exceedsRoom
    ? issues.some((issue) => issue.severity === "error" && issue.affectedItemIds.includes(item.id) && !issue.affectedGeometryIds.includes(project.room.id))
    : conflict || itemExceedsRoom(project, item);
  const color = selected ? "#b7b5e4" : tintConflict ? CONFLICT_TINT : item.acquisitionStatus === "owned" ? "#aaa6b3" : personTone(project, item.ownerId).fill;
  // Shortlist products use their own model in the item's chosen finish; others use their imported profile.
  const modelProps = { category: product.category, name: product.name, dimensions: { width: dimensions.width, depth: dimensions.depth, height: dimensions.height }, profile: visualProfileFor(product, item.colorSelection) };

  // Follows one pointer until release (commit) or cancel, then reports back once.
  const trackPointer = (pointerId: number, move: (pointerEvent: PointerEvent) => void, finish: (commit: boolean) => void) => {
    activePointer.current = pointerId;
    setDragging(true);
    const handleMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === activePointer.current) move(pointerEvent);
    };
    const end = (pointerEvent: PointerEvent, commit: boolean) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      activePointer.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      finish(commit);
    };
    const release = (pointerEvent: PointerEvent) => end(pointerEvent, true);
    const cancel = (pointerEvent: PointerEvent) => end(pointerEvent, false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
  };

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(item.id);
    if (!onDragEnd || item.locked) return;
    const raycaster = new THREE.Raycaster();
    // A horizontal plane at the grabbed point's height, so raised items track the pointer as well as floor items.
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -event.point.z);
    const point = new THREE.Vector3();
    const planePoint = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.ray.intersectPlane(plane, point) ? { x: point.x, y: point.y } : null;
    };
    // Move by how far the pointer travels, keeping the spot where the item was grabbed under the pointer.
    const grab = planePoint(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!grab) return;
    const start = { ...position };
    let last: Vec2 | null = null;
    trackPointer(event.pointerId, (pointerEvent) => {
      const current = planePoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!current) return;
      last = {
        x: roundMm(clamp(start.x + current.x - grab.x, -0.5, project.room.width + 0.5)),
        y: roundMm(clamp(start.y + current.y - grab.y, -0.5, project.room.length + 0.5)),
      };
      onDrag?.(item.id, last);
    }, (commit) => onDragEnd(item.id, commit ? last : null));
  };

  const startLift = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!onLiftEnd || item.locked) return;
    // Items already intersecting at grab time are ignored, so an existing collision can't trap the item.
    const ignored = new Set(collidingItemIds(project, item));
    let desired = elevation;
    let last: number | null = null;
    let pointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
    const toScreen = (z: number, rect: DOMRect) => {
      const projected = new THREE.Vector3(position.x, position.y, z).project(camera);
      return new THREE.Vector2(((projected.x + 1) / 2) * rect.width, ((1 - projected.y) / 2) * rect.height);
    };
    setLiftingActive(true);
    trackPointer(event.pointerId, (pointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      // Screen-space pixels per meter of upward travel at the current height; near-overhead views fall back to plain vertical mouse travel.
      let axis = toScreen(desired + 1, rect).sub(toScreen(desired, rect));
      if (axis.lengthSq() < 64) axis = new THREE.Vector2(0, -rect.height / 4);
      const dx = pointerEvent.clientX - pointer.x;
      const dy = pointerEvent.clientY - pointer.y;
      pointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      desired = clamp(desired + (dx * axis.x + dy * axis.y) / axis.lengthSq(), -(itemHeight - 0.05), project.room.height - 0.05);
      // Moving down into another item stops on top of it; near the floor, snap onto it.
      let next = stackedElevation(project, item, desired, ignored);
      if (Math.abs(next) < FLOOR_SNAP) next = 0;
      last = roundMm(next);
      onLift?.(item.id, last);
    }, (commit) => {
      setLiftingActive(false);
      onLiftEnd(item.id, commit ? last : null);
    });
  };

  const startRotate = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(item.id);
    if (!onRotateEnd || item.locked) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -event.point.z);
    const point = new THREE.Vector3();
    const planePoint = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.ray.intersectPlane(plane, point) ? point : null;
    };
    const grab = planePoint(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!grab) return;
    let previousAngle = Math.atan2(grab.y - position.y, grab.x - position.x);
    let nextRotation = rotationZ;
    let last: number | null = null;
    setRotatingActive(true);
    trackPointer(event.pointerId, (pointerEvent) => {
      const current = planePoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!current) return;
      const angle = Math.atan2(current.y - position.y, current.x - position.x);
      const delta = Math.atan2(Math.sin(angle - previousAngle), Math.cos(angle - previousAngle));
      previousAngle = angle;
      nextRotation += delta;
      last = nextRotation;
      onRotate?.(item.id, nextRotation);
    }, (commit) => {
      setRotatingActive(false);
      onRotateEnd(item.id, commit ? last : null);
    });
  };

  return (
    <group position={[position.x, position.y, elevation + itemHeight / 2]} rotation={[0, 0, rotationZ]}>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <group onPointerDown={startDrag}>
          <FurnitureModel {...modelProps} color={color} opacity={tintConflict ? 0.82 : 1} emphasized={selected || tintConflict} clipping={exceedsRoom ? { planes: clipPlanes.inside } : undefined} />
        </group>
        {exceedsRoom && (
          <>
            <FurnitureModel {...modelProps} color={OUT_OF_ROOM_RED} emphasized clipping={{ planes: clipPlanes.outside, intersection: true }} />
            <OutOfRoomGhost width={dimensions.width} height={dimensions.height} depth={dimensions.depth} planes={clipPlanes.outside} />
          </>
        )}
        {(selected || conflict) && (
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(dimensions.width + 0.025, dimensions.height + 0.025, dimensions.depth + 0.025)]} />
            <lineBasicMaterial color={selected ? "#322e18" : "#7d2e21"} />
          </lineSegments>
        )}
      </group>
      {/* Billboard keeps the label facing the camera at any orbit angle, even when the item itself is rotated. */}
      {(selected || conflict) && <Billboard position={[0, 0, dimensions.height / 2 + 0.12]}>
        <Text
          fontSize={0.09}
          color="#f4f3f7"
          outlineColor="#322e18"
          outlineWidth={0.008}
          anchorX="center"
          anchorY="bottom"
          maxWidth={1.5}
          textAlign="center"
        >{`${conflict ? "⚠ " : ""}${item.locked ? "🔒 " : ""}${product.name}`}</Text>
      </Billboard>}
      {selected && elevation > FLOOR_SNAP / 4 && (
        <group position={[0, 0, -itemHeight / 2 - elevation / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><cylinderGeometry args={[0.006, 0.006, elevation, 8]} /><meshBasicMaterial color={HANDLE_BLUE} transparent opacity={0.7} /></mesh>
          <mesh position={[0, -elevation / 2 + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.035, 0.05, 24]} /><meshBasicMaterial color={HANDLE_BLUE} side={THREE.DoubleSide} /></mesh>
        </group>
      )}
      {selected && onLiftEnd && !item.locked && <ElevationHandle offsetZ={itemHeight / 2 + 0.42} active={liftingActive} onPointerDown={startLift} />}
      {selected && onRotateEnd && !item.locked && <RotationHandle radius={rotationRadius} offsetZ={itemHeight / 2 + 0.08} rotationZ={rotationZ} active={rotatingActive} onPointerDown={startRotate} />}
    </group>
  );
}

function RoomFeatureModel({ feature, project }: { feature: RoomFeature; project: Project }) {
  const wall = featureWall(feature, project);
  const turns = wall === "east" || wall === "west";
  const size: [number, number, number] = turns
    ? [feature.depth, feature.width, feature.height]
    : [feature.width, feature.depth, feature.height];
  const elevation = feature.elevation ?? (feature.kind === "window" ? 0.9 : 0);
  const opacity = feature.confirmed ? 0.92 : 0.58;
  const colors: Record<RoomFeature["kind"], string> = {
    door: "#847979",
    window: "#bbc2e2",
    closet: "#9b9199",
    radiator: "#dcdae2",
    obstacle: "#a58f86",
  };
  const color = colors[feature.kind];

  return <group position={[feature.position.x, feature.position.y, elevation + feature.height / 2]}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={size} />
      {feature.kind === "window"
        ? <meshPhysicalMaterial color={color} transparent opacity={opacity * 0.7} roughness={0.12} metalness={0.18} />
        : <meshStandardMaterial color={color} transparent={!feature.confirmed} opacity={opacity} roughness={0.72} />}
    </mesh>
    <lineSegments>
      <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
      <lineBasicMaterial color={feature.confirmed ? "#322e18" : "#a3402f"} transparent opacity={0.88} />
    </lineSegments>
    {feature.kind === "door" && <mesh position={turns ? [0, feature.width * 0.34, 0] : [feature.width * 0.34, 0, 0]}>
      <sphereGeometry args={[0.045, 12, 8]} />
      <meshStandardMaterial color="#322e18" metalness={0.4} roughness={0.35} />
    </mesh>}
    <Billboard position={[0, 0, feature.height / 2 + 0.13]}>
      <Text fontSize={0.1} color={feature.confirmed ? "#322e18" : "#a3402f"} outlineColor="#f4f3f7" outlineWidth={0.009} anchorX="center">
        {feature.confirmed ? feature.name : `? ${feature.name}`}
      </Text>
    </Billboard>
  </group>;
}

const WALL_THICKNESS = 0.08;
// Walls whose outside faces the default view (from the south-east) are left out of the cutaway.
const CUTAWAY_VIEW = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };

/** The room's floor slab and walls, following a traced outline when the room has one. */
function RoomShell({ room, cutaway, floorColor, wallColor, onFloorPointerDown }: { room: Room; cutaway?: boolean; floorColor: string; wallColor: string; onFloorPointerDown: () => void }) {
  const { width, length, height, outline } = room;
  const polygon = useMemo(() => roomPolygon({ width, length, outline }), [length, outline, width]);
  const floor = useMemo(() => new THREE.ExtrudeGeometry(new THREE.Shape(polygon.map((point) => new THREE.Vector2(point.x, point.y))), { depth: 0.05, bevelEnabled: false }), [polygon]);
  useEffect(() => () => floor.dispose(), [floor]);
  const walls = useMemo(() => {
    const segments = wallSegments(polygon);
    return segments.map((segment, index) => {
      // Extend past outside corners so neighbouring walls meet; at inside corners the walls already overlap.
      const convex = (from: typeof segment, to: typeof segment) => (from.end.x - from.start.x) * (to.end.y - to.start.y) - (from.end.y - from.start.y) * (to.end.x - to.start.x) > 0;
      const before = convex(segments[(index + segments.length - 1) % segments.length], segment) ? WALL_THICKNESS : 0;
      const after = convex(segment, segments[(index + 1) % segments.length]) ? WALL_THICKNESS : 0;
      const direction = { x: (segment.end.x - segment.start.x) / segment.length, y: (segment.end.y - segment.start.y) / segment.length };
      const shift = (after - before) / 2;
      return {
        key: `${index}-${segment.start.x}-${segment.start.y}`,
        position: [
          (segment.start.x + segment.end.x) / 2 + direction.x * shift + segment.normal.x * WALL_THICKNESS / 2,
          (segment.start.y + segment.end.y) / 2 + direction.y * shift + segment.normal.y * WALL_THICKNESS / 2,
          height / 2,
        ] as [number, number, number],
        rotation: Math.atan2(direction.y, direction.x),
        length: segment.length + before + after,
        cut: segment.normal.x * CUTAWAY_VIEW.x + segment.normal.y * CUTAWAY_VIEW.y > 0.2,
      };
    });
  }, [height, polygon]);
  return (
    <>
      <mesh geometry={floor} position={[0, 0, -0.05]} receiveShadow onPointerDown={onFloorPointerDown}>
        <meshStandardMaterial color={floorColor} roughness={0.92} />
      </mesh>
      {walls.filter((wall) => !(cutaway && wall.cut)).map((wall) => (
        <mesh key={wall.key} position={wall.position} rotation={[0, 0, wall.rotation]} castShadow receiveShadow>
          <boxGeometry args={[wall.length, WALL_THICKNESS, height]} />
          <meshStandardMaterial color={wallColor} />
        </mesh>
      ))}
    </>
  );
}

interface DragPreview {
  itemId: string;
  position: Vec2;
  elevation: number;
  rotationZ: number;
}

function Scene({ project: savedProject, issues: savedIssues, selectedItemId, onSelectItem, onMoveItem, cutaway, viewCommand, gridSize, snapToGrid, moveStep }: RoomCanvasProps & { gridSize: number; snapToGrid: boolean; moveStep: number | null }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const [dragging, setDragging] = useState(false);
  // While dragging, render a local preview (with live conflict colors) and save only on release.
  const [preview, setPreview] = useState<DragPreview | null>(null);
  // The dragged item as last previewed. Drags settle step by step from it, so moving onto or off another item registers as it happens.
  const placed = useRef<Item | null>(null);
  const project = useMemo(() => preview ? {
    ...savedProject,
    items: savedProject.items.map((item) => item.id === preview.itemId && item.transform ? { ...item, transform: { ...item.transform, position: preview.position, elevation: preview.elevation, rotationZ: preview.rotationZ } } : item),
  } : savedProject, [preview, savedProject]);
  const issues = useMemo(() => (preview ? calculateIssues(project) : savedIssues), [preview, project, savedIssues]);
  const savedItem = (itemId: string) => savedProject.items.find((item) => item.id === itemId);
  // While dragging: whole steps only (if on). The saved position doesn't change mid-drag, so it is the step origin.
  const stepped = (itemId: string, position: Vec2) => {
    const start = savedItem(itemId)?.transform?.position;
    return moveStep && start ? stepPosition(start, position, moveStep) : position;
  };
  // Height after moving to `position`: surface-following items drop off edges and land on top of what they move into.
  const settle = (itemId: string, position: Vec2): DragPreview | null => {
    const saved = savedItem(itemId);
    if (!saved?.transform) return null;
    const from = placed.current?.id === itemId ? placed.current : saved;
    const elevation = roundMm(settledElevation(savedProject, from, position));
    placed.current = { ...saved, transform: { ...saved.transform, position, elevation } };
    return { itemId, position, elevation, rotationZ: from.transform?.rotationZ ?? saved.transform.rotationZ };
  };
  const drag = (itemId: string, position: Vec2) => setPreview(settle(itemId, stepped(itemId, position)));
  // On release: snap to the grid (if on) after stepping, then settle once more in case the snap moved it off or onto an edge.
  const endDrag = (itemId: string, position: Vec2 | null) => {
    setPreview(null);
    const final = position ? settle(itemId, snapToGrid ? snapItemPosition(savedProject, itemId, stepped(itemId, position), gridSize) : stepped(itemId, position)) : null;
    placed.current = null;
    if (final) onMoveItem?.(itemId, final.position, final.elevation, final.rotationZ);
  };
  const lift = (itemId: string, elevation: number) => {
    const transform = savedItem(itemId)?.transform;
    if (transform) setPreview({ itemId, position: transform.position, elevation, rotationZ: transform.rotationZ });
  };
  const endLift = (itemId: string, elevation: number | null) => {
    setPreview(null);
    const transform = savedItem(itemId)?.transform;
    if (transform && elevation != null) onMoveItem?.(itemId, transform.position, elevation, transform.rotationZ);
  };
  const rotate = (itemId: string, rotationZ: number) => {
    const transform = savedItem(itemId)?.transform;
    if (!transform) return;
    setPreview({
      itemId,
      position: transform.position,
      elevation: transform.elevation ?? 0,
      rotationZ: snapToGrid ? snapRotation(rotationZ) : normalizeRotation(rotationZ),
    });
  };
  const endRotate = (itemId: string, rotationZ: number | null) => {
    setPreview(null);
    const transform = savedItem(itemId)?.transform;
    if (!transform || rotationZ == null) return;
    const finalRotation = snapToGrid ? snapRotation(rotationZ) : normalizeRotation(rotationZ);
    const position = snapToGrid ? snapItemPosition(savedProject, itemId, transform.position, gridSize, finalRotation) : transform.position;
    onMoveItem?.(itemId, position, transform.elevation ?? 0, finalRotation);
  };
  const wallColor = tintedTone(WALL_TONE, project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("wall"))?.hex);
  const floorColor = tintedTone(FLOOR_TONE, project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("floor"))?.hex);
  const center = useMemo(() => new THREE.Vector3(project.room.width / 2, project.room.length / 2, 0.55), [project.room.length, project.room.width]);
  const clipPlanes = useMemo(() => roomClipPlanes(project.room.width, project.room.length, project.room.height), [project.room.height, project.room.length, project.room.width]);

  return (
    <>
      <color attach="background" args={["#dcdae2"]} />
      <fog attach="fog" args={["#dcdae2", 8, 16]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[2, 5, 7]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <CameraRig project={project} command={viewCommand} cutaway={cutaway} controlsRef={controls} />
      <OrbitControls ref={controls} enabled={!dragging} makeDefault target={center} minDistance={MIN_VIEW_DISTANCE} maxDistance={MAX_VIEW_DISTANCE} maxPolarAngle={Math.PI / 2.02} />
      <RoomShell room={project.room} cutaway={cutaway} floorColor={floorColor} wallColor={wallColor} onFloorPointerDown={() => onSelectItem?.("")} />
      <FloorGrid room={project.room} cell={gridSize} />
      {project.room.features.map((feature) => <RoomFeatureModel key={feature.id} feature={feature} project={project} />)}
      {project.room.clearanceZones.map((zone) => (
        <group key={zone.id} position={[zone.position.x, zone.position.y, 0.012]}>
          <mesh>
            <planeGeometry args={[zone.width, zone.depth]} />
            <meshBasicMaterial color={CONFLICT_TINT} transparent opacity={0.34} side={THREE.DoubleSide} />
          </mesh>
          <Text position={[0, 0, 0.02]} fontSize={0.12} color="#7d2e21" anchorX="center">KEEP CLEAR</Text>
        </group>
      ))}
      {project.items.filter((item) => item.purchaseStatus !== "deferred").map((item) => (
        <FurnitureItem
          key={item.id}
          project={project}
          item={item}
          issues={issues}
          selected={selectedItemId === item.id}
          clipPlanes={clipPlanes}
          onSelect={onSelectItem}
          onDrag={onMoveItem ? drag : undefined}
          onDragEnd={onMoveItem ? endDrag : undefined}
          onLift={onMoveItem ? lift : undefined}
          onLiftEnd={onMoveItem ? endLift : undefined}
          onRotate={onMoveItem ? rotate : undefined}
          onRotateEnd={onMoveItem ? endRotate : undefined}
          setDragging={setDragging}
        />
      ))}
    </>
  );
}

export function RoomCanvas(props: RoomCanvasProps) {
  const { gridSize, snapToGrid, stepMoves, moveStep } = useUnitPreferences();
  return (
    <div className="room-canvas">
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ fov: 42, near: 0.05, far: 100, up: [0, 0, 1] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          // Per-material clipping splits out-of-room parts of furniture into the red highlight.
          gl.localClippingEnabled = true;
        }}
      >
        <Scene {...props} gridSize={gridSize} snapToGrid={snapToGrid} moveStep={stepMoves ? moveStep : null} />
      </Canvas>
      <GridScaleLegend showMovement={Boolean(props.onMoveItem)} />
    </div>
  );
}
