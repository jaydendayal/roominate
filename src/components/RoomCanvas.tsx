"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { LengthInput } from "./LengthInput";
import { calculateIssues, collidingItemIds, featureWall, itemElevation, itemExceedsRoom, itemHasConflict, productFor, settledElevation, stackedElevation } from "@/lib/calculations";
import { snapItemPosition, stepPosition } from "@/lib/snap";
import type { Issue, Item, Project, RoomFeature, Vec2 } from "@/lib/types";
import { gridOptions } from "@/lib/units";
import { FurnitureModel } from "./FurnitureModel";

interface RoomCanvasProps {
  project: Project;
  issues: Issue[];
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
  onMoveItem?: (itemId: string, position: Vec2, elevation: number) => void;
  cutaway?: boolean;
  viewCommand?: { type: "reset" | "overhead"; nonce: number };
  compact?: boolean;
}

function CameraRig({ project, command, controlsRef }: { project: Project; command?: RoomCanvasProps["viewCommand"]; controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1);
    const center = new THREE.Vector3(project.room.width / 2, project.room.length / 2, 0.6);
    if (command?.type === "overhead") {
      camera.position.set(project.room.width / 2, project.room.length / 2 + 0.001, Math.max(5.5, project.room.length * 1.8));
    } else {
      camera.position.set(project.room.width * 1.45, project.room.length * 1.55, Math.max(3.4, project.room.height * 1.4));
    }
    camera.lookAt(center);
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, [camera, command, controlsRef, project.room.height, project.room.length, project.room.width]);
  return null;
}

const MAX_GRID_LINES_PER_AXIS = 400;

/** Floor grid with exact square size, anchored at the room origin corner so squares count out from the walls. */
function FloorGrid({ width, length, cell }: { width: number; length: number; cell: number }) {
  const geometry = useMemo(() => {
    const points: number[] = [];
    const columns = Math.floor(width / cell + 1e-6);
    const rows = Math.floor(length / cell + 1e-6);
    if (columns <= MAX_GRID_LINES_PER_AXIS && rows <= MAX_GRID_LINES_PER_AXIS) {
      for (let i = 1; i <= columns; i += 1) points.push(i * cell, 0, 0, i * cell, length, 0);
      for (let j = 1; j <= rows; j += 1) points.push(0, j * cell, 0, width, j * cell, 0);
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return buffer;
  }, [cell, length, width]);
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
          <label className="snap-toggle" title="When you let go of a dragged item (or rotate it), its edges line up with grid lines or walls">
            <input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.target.checked)} />
            <span>Snap to grid</span>
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

const OUT_OF_ROOM_RED = "#b8321f";
const HANDLE_COLOR = "#322e18";
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
  const color = active || hovered ? "#6f6bb8" : HANDLE_COLOR;
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
  const owner = project.people.find((person) => person.id === item.ownerId);
  if (!product || !position || dimensions?.width == null || dimensions.depth == null || dimensions.height == null) return null;
  const itemHeight = dimensions.height;

  const exceedsRoom = itemExceedsRoom(project, item);
  // Wall/floor/ceiling violations are shown by the red out-of-room part, so they don't tint the whole item.
  const tintConflict = exceedsRoom
    ? issues.some((issue) => issue.severity === "error" && issue.affectedItemIds.includes(item.id) && !issue.affectedGeometryIds.includes(project.room.id))
    : conflict;
  const color = selected ? "#b7b5e4" : tintConflict ? "#c46a58" : item.acquisitionStatus === "owned" ? "#aaa6b3" : owner?.color ?? "#847979";
  const modelProps = { category: product.category, name: product.name, dimensions: { width: dimensions.width, depth: dimensions.depth, height: dimensions.height }, profile: product.visualProfile };

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

  return (
    <group position={[position.x, position.y, elevation + itemHeight / 2]} rotation={[0, 0, item.transform?.rotationZ ?? 0]}>
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
      {(selected || conflict) && <Text
        position={[0, 0, dimensions.height / 2 + 0.12]}
        fontSize={0.09}
        color="#f4f3f7"
        outlineColor="#322e18"
        outlineWidth={0.008}
        anchorX="center"
        maxWidth={1.5}
      >{conflict ? `! ${product.name}` : product.name}</Text>}
      {selected && elevation > FLOOR_SNAP / 4 && (
        <group position={[0, 0, -itemHeight / 2 - elevation / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh><cylinderGeometry args={[0.006, 0.006, elevation, 8]} /><meshBasicMaterial color={HANDLE_COLOR} transparent opacity={0.7} /></mesh>
          <mesh position={[0, -elevation / 2 + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.035, 0.05, 24]} /><meshBasicMaterial color={HANDLE_COLOR} side={THREE.DoubleSide} /></mesh>
        </group>
      )}
      {selected && onLiftEnd && !item.locked && <ElevationHandle offsetZ={itemHeight / 2 + 0.42} active={liftingActive} onPointerDown={startLift} />}
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

interface DragPreview {
  itemId: string;
  position: Vec2;
  elevation: number;
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
    items: savedProject.items.map((item) => item.id === preview.itemId && item.transform ? { ...item, transform: { ...item.transform, position: preview.position, elevation: preview.elevation } } : item),
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
    return { itemId, position, elevation };
  };
  const drag = (itemId: string, position: Vec2) => setPreview(settle(itemId, stepped(itemId, position)));
  // On release: snap to the grid (if on) after stepping, then settle once more in case the snap moved it off or onto an edge.
  const endDrag = (itemId: string, position: Vec2 | null) => {
    setPreview(null);
    const final = position ? settle(itemId, snapToGrid ? snapItemPosition(savedProject, itemId, stepped(itemId, position), gridSize) : stepped(itemId, position)) : null;
    placed.current = null;
    if (final) onMoveItem?.(itemId, final.position, final.elevation);
  };
  const lift = (itemId: string, elevation: number) => {
    const position = savedItem(itemId)?.transform?.position;
    if (position) setPreview({ itemId, position, elevation });
  };
  const endLift = (itemId: string, elevation: number | null) => {
    setPreview(null);
    const position = savedItem(itemId)?.transform?.position;
    if (position && elevation != null) onMoveItem?.(itemId, position, elevation);
  };
  const wallColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("wall"))?.hex ?? "#dedbe4";
  const floorColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("floor"))?.hex ?? "#a89d9b";
  const center = useMemo(() => new THREE.Vector3(project.room.width / 2, project.room.length / 2, 0.55), [project.room.length, project.room.width]);
  const clipPlanes = useMemo(() => roomClipPlanes(project.room.width, project.room.length, project.room.height), [project.room.height, project.room.length, project.room.width]);

  return (
    <>
      <color attach="background" args={["#dcdae2"]} />
      <fog attach="fog" args={["#dcdae2", 8, 16]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[2, 5, 7]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <CameraRig project={project} command={viewCommand} controlsRef={controls} />
      <OrbitControls ref={controls} enabled={!dragging} makeDefault target={center} minDistance={2} maxDistance={12} maxPolarAngle={Math.PI / 2.02} />
      <mesh position={[project.room.width / 2, project.room.length / 2, -0.025]} receiveShadow onPointerDown={() => onSelectItem?.("")}>
        <boxGeometry args={[project.room.width, project.room.length, 0.05]} />
        <meshStandardMaterial color={floorColor} roughness={0.92} />
      </mesh>
      <FloorGrid width={project.room.width} length={project.room.length} cell={gridSize} />
      <mesh position={[-0.04, project.room.length / 2, project.room.height / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.08, project.room.length, project.room.height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      {!cutaway && <mesh position={[project.room.width / 2, -0.04, project.room.height / 2]} castShadow receiveShadow>
        <boxGeometry args={[project.room.width, 0.08, project.room.height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>}
      <mesh position={[project.room.width / 2, project.room.length + 0.04, project.room.height / 2]} castShadow receiveShadow>
        <boxGeometry args={[project.room.width, 0.08, project.room.height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      {!cutaway && <mesh position={[project.room.width + 0.04, project.room.length / 2, project.room.height / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.08, project.room.length, project.room.height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>}
      {project.room.features.map((feature) => <RoomFeatureModel key={feature.id} feature={feature} project={project} />)}
      {project.room.clearanceZones.map((zone) => (
        <group key={zone.id} position={[zone.position.x, zone.position.y, 0.012]}>
          <mesh>
            <planeGeometry args={[zone.width, zone.depth]} />
            <meshBasicMaterial color="#c46a58" transparent opacity={0.26} side={THREE.DoubleSide} />
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
