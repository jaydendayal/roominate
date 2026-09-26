"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { Billboard, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useUnitPreferences } from "@/hooks/useUnitPreferences";
import { LengthInput } from "./LengthInput";
import { calculateIssues, itemHasConflict, productFor } from "@/lib/calculations";
import { snapItemPosition, stepPosition } from "@/lib/snap";
import type { Issue, Item, Project, RoomFeature, Vec2 } from "@/lib/types";
import { gridOptions } from "@/lib/units";
import { FurnitureModel } from "./FurnitureModel";

interface RoomCanvasProps {
  project: Project;
  issues: Issue[];
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
  onMoveItem?: (itemId: string, position: Vec2) => void;
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
      <lineBasicMaterial color="#6f5642" transparent opacity={0.45} />
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

function FurnitureItem({
  project,
  item,
  issues,
  selected,
  onSelect,
  onDrag,
  onDragEnd,
  setDragging,
}: {
  project: Project;
  item: Item;
  issues: Issue[];
  selected: boolean;
  onSelect?: (id: string) => void;
  /** Live preview while the pointer moves; not persisted. */
  onDrag?: (id: string, position: Vec2) => void;
  /** Called once on release with the final position, or null if the drag was cancelled or never moved. */
  onDragEnd?: (id: string, position: Vec2 | null) => void;
  setDragging: (dragging: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const product = productFor(project, item);
  const conflict = itemHasConflict(issues, item.id);
  const position = item.transform?.position;
  const dimensions = product?.dimensions;
  const activePointer = useRef<number | null>(null);
  const owner = project.people.find((person) => person.id === item.ownerId);
  if (!product || !position || dimensions?.width == null || dimensions.depth == null || dimensions.height == null) return null;

  const color = selected ? "#f2b544" : conflict ? "#df654f" : item.acquisitionStatus === "owned" ? "#7d9688" : owner?.color ?? "#c99169";

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(item.id);
    if (!onDragEnd || item.locked) return;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const point = new THREE.Vector3();
    const floorPoint = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
      return raycaster.ray.intersectPlane(plane, point) ? { x: point.x, y: point.y } : null;
    };
    // Move by how far the pointer travels, keeping the spot where the item was grabbed under the pointer.
    const grab = floorPoint(event.nativeEvent.clientX, event.nativeEvent.clientY);
    if (!grab) return;
    const start = { ...position };
    activePointer.current = event.pointerId;
    setDragging(true);
    let last: Vec2 | null = null;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      const current = floorPoint(pointerEvent.clientX, pointerEvent.clientY);
      if (!current) return;
      last = {
        x: Math.max(-0.5, Math.min(project.room.width + 0.5, start.x + current.x - grab.x)),
        y: Math.max(-0.5, Math.min(project.room.length + 0.5, start.y + current.y - grab.y)),
      };
      onDrag?.(item.id, last);
    };
    const finish = (pointerEvent: PointerEvent, commit: boolean) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      activePointer.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      // Persist once per drag instead of on every pointer move.
      onDragEnd(item.id, commit ? last : null);
    };
    const release = (pointerEvent: PointerEvent) => finish(pointerEvent, true);
    const cancel = (pointerEvent: PointerEvent) => finish(pointerEvent, false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <group position={[position.x, position.y, dimensions.height / 2]} rotation={[0, 0, item.transform?.rotationZ ?? 0]}>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <group onPointerDown={startDrag}>
          <FurnitureModel category={product.category} name={product.name} dimensions={{ width: dimensions.width, depth: dimensions.depth, height: dimensions.height }} color={color} opacity={conflict ? 0.82 : 1} profile={product.visualProfile} emphasized={selected || conflict} />
        </group>
        {(selected || conflict) && (
          <lineSegments>
            <edgesGeometry args={[new THREE.BoxGeometry(dimensions.width + 0.025, dimensions.height + 0.025, dimensions.depth + 0.025)]} />
            <lineBasicMaterial color={selected ? "#fff3bf" : "#7e1e15"} />
          </lineSegments>
        )}
      </group>
      {(selected || conflict) && <Text
        position={[0, 0, dimensions.height / 2 + 0.12]}
        fontSize={0.09}
        color="#fffdf8"
        outlineColor="#21332d"
        outlineWidth={0.008}
        anchorX="center"
        maxWidth={1.5}
      >{conflict ? `! ${product.name}` : product.name}</Text>}
    </group>
  );
}

function featureWall(feature: RoomFeature, project: Project): NonNullable<RoomFeature["wall"]> {
  if (feature.wall && feature.wall !== "unknown") return feature.wall;
  const distances = [
    ["west", feature.position.x],
    ["east", project.room.width - feature.position.x],
    ["south", feature.position.y],
    ["north", project.room.length - feature.position.y],
  ] as const;
  return [...distances].sort((a, b) => a[1] - b[1])[0][0];
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
    door: "#8d623f",
    window: "#8fc4d3",
    closet: "#9a8067",
    radiator: "#d7d7cf",
    obstacle: "#c78362",
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
      <lineBasicMaterial color={feature.confirmed ? "#30483d" : "#d96a47"} transparent opacity={0.88} />
    </lineSegments>
    {feature.kind === "door" && <mesh position={turns ? [0, feature.width * 0.34, 0] : [feature.width * 0.34, 0, 0]}>
      <sphereGeometry args={[0.045, 12, 8]} />
      <meshStandardMaterial color="#d8ad55" metalness={0.6} roughness={0.28} />
    </mesh>}
    <Billboard position={[0, 0, feature.height / 2 + 0.13]}>
      <Text fontSize={0.1} color={feature.confirmed ? "#263c32" : "#a3422e"} outlineColor="#fffdf8" outlineWidth={0.009} anchorX="center">
        {feature.confirmed ? feature.name : `? ${feature.name}`}
      </Text>
    </Billboard>
  </group>;
}

function Scene({ project: savedProject, issues: savedIssues, selectedItemId, onSelectItem, onMoveItem, cutaway, viewCommand, gridSize, snapToGrid, moveStep }: RoomCanvasProps & { gridSize: number; snapToGrid: boolean; moveStep: number | null }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const [dragging, setDragging] = useState(false);
  // While dragging, render a local preview (with live conflict colors) and save only on release.
  const [preview, setPreview] = useState<{ itemId: string; position: Vec2 } | null>(null);
  const project = useMemo(() => preview ? {
    ...savedProject,
    items: savedProject.items.map((item) => item.id === preview.itemId && item.transform ? { ...item, transform: { ...item.transform, position: preview.position } } : item),
  } : savedProject, [preview, savedProject]);
  const issues = useMemo(() => (preview ? calculateIssues(project) : savedIssues), [preview, project, savedIssues]);
  // While dragging: whole steps only (if on). The saved position doesn't change mid-drag, so it is the step origin.
  const stepped = (itemId: string, position: Vec2) => {
    const start = savedProject.items.find((item) => item.id === itemId)?.transform?.position;
    return moveStep && start ? stepPosition(start, position, moveStep) : position;
  };
  // On release: snap to the grid (if on) after stepping.
  const endDrag = (itemId: string, position: Vec2 | null) => {
    setPreview(null);
    if (!position) return;
    const moved = stepped(itemId, position);
    onMoveItem?.(itemId, snapToGrid ? snapItemPosition(savedProject, itemId, moved, gridSize) : moved);
  };
  const wallColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("wall"))?.hex ?? "#e7dfd0";
  const floorColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("floor"))?.hex ?? "#a77f59";
  const center = useMemo(() => new THREE.Vector3(project.room.width / 2, project.room.length / 2, 0.55), [project.room.length, project.room.width]);

  return (
    <>
      <color attach="background" args={["#d6ddd9"]} />
      <fog attach="fog" args={["#d6ddd9", 8, 16]} />
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
            <meshBasicMaterial color="#e97055" transparent opacity={0.26} side={THREE.DoubleSide} />
          </mesh>
          <Text position={[0, 0, 0.02]} fontSize={0.12} color="#762b20" anchorX="center">KEEP CLEAR</Text>
        </group>
      ))}
      {project.items.filter((item) => item.purchaseStatus !== "deferred").map((item) => (
        <FurnitureItem
          key={item.id}
          project={project}
          item={item}
          issues={issues}
          selected={selectedItemId === item.id}
          onSelect={onSelectItem}
          onDrag={onMoveItem ? (itemId, position) => setPreview({ itemId, position: stepped(itemId, position) }) : undefined}
          onDragEnd={onMoveItem ? endDrag : undefined}
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
      <Canvas shadows dpr={[1, 1.6]} camera={{ fov: 42, near: 0.05, far: 100, up: [0, 0, 1] }} gl={{ antialias: true }}>
        <Scene {...props} gridSize={gridSize} snapToGrid={snapToGrid} moveStep={stepMoves ? moveStep : null} />
      </Canvas>
      <GridScaleLegend showMovement={Boolean(props.onMoveItem)} />
    </div>
  );
}
