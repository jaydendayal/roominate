"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { collidingItemIds, itemElevation, itemExceedsRoom, itemHasConflict, productFor, settledElevation, stackedElevation } from "@/lib/calculations";
import type { Issue, Item, Project, Vec2 } from "@/lib/types";

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
    const center = new THREE.Vector3(project.room.width / 2, 0.6, project.room.length / 2);
    if (command?.type === "overhead") {
      camera.position.set(project.room.width / 2, Math.max(5.5, project.room.length * 1.8), project.room.length / 2 + 0.001);
    } else {
      camera.position.set(project.room.width * 1.45, Math.max(3.4, project.room.height * 1.4), project.room.length * 1.55);
    }
    camera.lookAt(center);
    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, [camera, command, controlsRef, project.room.height, project.room.length, project.room.width]);
  return null;
}

interface RoomClipPlanes {
  inside: THREE.Plane[];
  outside: THREE.Plane[];
}

// Keeps faces lying exactly on a wall or the floor (e.g. an item's base at y = 0) from flickering into the red highlight.
const CLIP_MARGIN = 0.003;

// World-space planes for the room interior. `inside` (union clipping) keeps only what is within the room;
// the negated `outside` set (intersection clipping) keeps only what pokes through a wall, floor, or ceiling.
function roomClipPlanes(width: number, length: number, height: number): RoomClipPlanes {
  const inside = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), width + CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), height + CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), CLIP_MARGIN),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), length + CLIP_MARGIN),
  ];
  return { inside, outside: inside.map((plane) => plane.clone().negate()) };
}

const OUT_OF_ROOM_RED = "#e3261c";
const HANDLE_BLUE = "#2f7de1";
const FLOOR_SNAP = 0.04;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundMm = (value: number) => Math.round(value * 1000) / 1000;

function OutOfRoomVolume({ width, height, depth, planes }: { width: number; height: number; depth: number; planes: THREE.Plane[] }) {
  const box = useMemo(() => new THREE.BoxGeometry(width, height, depth), [width, height, depth]);
  const edges = useMemo(() => new THREE.EdgesGeometry(box), [box]);
  useEffect(() => () => {
    box.dispose();
    edges.dispose();
  }, [box, edges]);
  return (
    <>
      <mesh geometry={box}>
        <meshStandardMaterial color={OUT_OF_ROOM_RED} emissive="#8f0f08" emissiveIntensity={0.55} roughness={0.5} side={THREE.DoubleSide} clippingPlanes={planes} clipIntersection />
      </mesh>
      {/* X-ray pass so the invalid part stays visible behind walls and under the floor. */}
      <mesh geometry={box} renderOrder={10}>
        <meshBasicMaterial color={OUT_OF_ROOM_RED} transparent opacity={0.22} depthTest={false} depthWrite={false} side={THREE.DoubleSide} clippingPlanes={planes} clipIntersection />
      </mesh>
      <lineSegments geometry={edges} renderOrder={11}>
        <lineBasicMaterial color={OUT_OF_ROOM_RED} transparent depthTest={false} clippingPlanes={planes} clipIntersection />
      </lineSegments>
    </>
  );
}

function ElevationHandle({ offsetY, active, onPointerDown }: { offsetY: number; active: boolean; onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  const { gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const color = active || hovered ? "#79adff" : HANDLE_BLUE;
  // Transparent + no depth test draws the handle after the scene so walls and furniture never hide it.
  const material = <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />;
  useEffect(() => () => {
    gl.domElement.style.cursor = "";
  }, [gl]);
  return (
    <group position={[0, offsetY, 0]}>
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
  onMove,
  setDragging,
}: {
  project: Project;
  item: Item;
  issues: Issue[];
  selected: boolean;
  clipPlanes: RoomClipPlanes;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: Vec2, elevation: number) => void;
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
  // Wall/floor/ceiling violations are shown by the red out-of-room volume, so they don't tint the whole item.
  const tintConflict = exceedsRoom
    ? issues.some((issue) => issue.severity === "error" && issue.affectedItemIds.includes(item.id) && !issue.affectedGeometryIds.includes(project.room.id))
    : conflict;
  const color = selected ? "#f2b544" : tintConflict ? "#df654f" : item.acquisitionStatus === "owned" ? "#7d9688" : owner?.color ?? "#c99169";
  const canMove = Boolean(onMove) && !item.locked;

  const trackPointer = (pointerId: number, move: (pointerEvent: PointerEvent) => void, onStop?: () => void) => {
    activePointer.current = pointerId;
    setDragging(true);
    const handleMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === activePointer.current) move(pointerEvent);
    };
    const stop = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      activePointer.current = null;
      setDragging(false);
      onStop?.();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
  };

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect?.(item.id);
    if (!onMove || item.locked || !item.transform) return;
    const transform = item.transform;
    const raycaster = new THREE.Raycaster();
    // Drag across a horizontal plane at the grabbed point's height so the item stays under the cursor.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -event.point.y);
    const grabOffset = { x: event.point.x - position.x, z: event.point.z - position.z };
    const point = new THREE.Vector3();
    let placed = item;
    trackPointer(event.pointerId, (pointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((pointerEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((pointerEvent.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      const next = {
        x: roundMm(clamp(point.x - grabOffset.x, -0.5, project.room.width + 0.5)),
        z: roundMm(clamp(point.z - grabOffset.z, -0.5, project.room.length + 0.5)),
      };
      // Settle step by step from the last placed state so surface changes (onto, off of) are seen as they happen.
      const nextElevation = roundMm(settledElevation(project, placed, next));
      placed = { ...item, transform: { ...transform, position: next, elevation: nextElevation } };
      onMove(item.id, next, nextElevation);
    });
  };

  const startLift = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!onMove || item.locked) return;
    const ignored = new Set(collidingItemIds(project, item));
    let desired = elevation;
    let last = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
    const toScreen = (y: number, rect: DOMRect) => {
      const projected = new THREE.Vector3(position.x, y, position.z).project(camera);
      return new THREE.Vector2(((projected.x + 1) / 2) * rect.width, ((1 - projected.y) / 2) * rect.height);
    };
    setLiftingActive(true);
    trackPointer(event.pointerId, (pointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      // Screen-space pixels per meter of upward travel at the current height; near-overhead views fall back to plain vertical mouse travel.
      let axis = toScreen(desired + 1, rect).sub(toScreen(desired, rect));
      if (axis.lengthSq() < 64) axis = new THREE.Vector2(0, -rect.height / 4);
      const dx = pointerEvent.clientX - last.x;
      const dy = pointerEvent.clientY - last.y;
      last = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      desired = clamp(desired + (dx * axis.x + dy * axis.y) / axis.lengthSq(), -(itemHeight - 0.05), project.room.height - 0.05);
      let next = stackedElevation(project, item, desired, ignored);
      if (Math.abs(next) < FLOOR_SNAP) next = 0;
      onMove(item.id, position, roundMm(next));
    }, () => setLiftingActive(false));
  };

  return (
    <group position={[position.x, elevation + itemHeight / 2, position.z]} rotation={[0, item.transform?.rotationY ?? 0, 0]}>
      <mesh castShadow receiveShadow onPointerDown={startDrag}>
        <boxGeometry args={[dimensions.width, dimensions.height, dimensions.depth]} />
        <meshStandardMaterial
          color={color}
          roughness={0.72}
          transparent
          opacity={tintConflict ? 0.82 : 1}
          clippingPlanes={exceedsRoom ? clipPlanes.inside : null}
          clipShadows
        />
      </mesh>
      {exceedsRoom && <OutOfRoomVolume width={dimensions.width} height={dimensions.height} depth={dimensions.depth} planes={clipPlanes.outside} />}
      {selected && elevation > FLOOR_SNAP / 4 && (
        <group position={[0, -itemHeight / 2 - elevation / 2, 0]}>
          <mesh><cylinderGeometry args={[0.006, 0.006, elevation, 8]} /><meshBasicMaterial color={HANDLE_BLUE} transparent opacity={0.7} /></mesh>
          <mesh position={[0, -elevation / 2 + 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.035, 0.05, 24]} /><meshBasicMaterial color={HANDLE_BLUE} side={THREE.DoubleSide} /></mesh>
        </group>
      )}
      {selected && canMove && <ElevationHandle offsetY={itemHeight / 2 + 0.42} active={liftingActive} onPointerDown={startLift} />}
      {(selected || conflict) && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(dimensions.width + 0.025, dimensions.height + 0.025, dimensions.depth + 0.025)]} />
          <lineBasicMaterial color={selected ? "#fff3bf" : "#7e1e15"} />
        </lineSegments>
      )}
      {(selected || conflict) && <Text
        position={[0, dimensions.height / 2 + 0.12, 0]}
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

function Scene({ project, issues, selectedItemId, onSelectItem, onMoveItem, cutaway, viewCommand }: RoomCanvasProps) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const [dragging, setDragging] = useState(false);
  const wallColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("wall"))?.hex ?? "#e7dfd0";
  const floorColor = project.room.palette.find((swatch) => swatch.label.toLowerCase().includes("floor"))?.hex ?? "#a77f59";
  const center = useMemo(() => new THREE.Vector3(project.room.width / 2, 0.55, project.room.length / 2), [project.room.length, project.room.width]);
  const clipPlanes = useMemo(() => roomClipPlanes(project.room.width, project.room.length, project.room.height), [project.room.height, project.room.length, project.room.width]);

  return (
    <>
      <color attach="background" args={["#d6ddd9"]} />
      <fog attach="fog" args={["#d6ddd9", 8, 16]} />
      <ambientLight intensity={1.8} />
      <directionalLight position={[2, 7, 5]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} />
      <CameraRig project={project} command={viewCommand} controlsRef={controls} />
      <OrbitControls ref={controls} enabled={!dragging} makeDefault target={center} minDistance={2} maxDistance={12} maxPolarAngle={Math.PI / 2.02} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[project.room.width / 2, -0.025, project.room.length / 2]} receiveShadow onPointerDown={() => onSelectItem?.("")}>
        <boxGeometry args={[project.room.width, project.room.length, 0.05]} />
        <meshStandardMaterial color={floorColor} roughness={0.92} />
      </mesh>
      <gridHelper args={[Math.max(project.room.width, project.room.length) + 1, 16, "#92745f", "#c5ae98"]} position={[project.room.width / 2, 0.005, project.room.length / 2]} />
      <mesh position={[-0.04, project.room.height / 2, project.room.length / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.08, project.room.height, project.room.length]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      {!cutaway && <mesh position={[project.room.width / 2, project.room.height / 2, -0.04]} castShadow receiveShadow>
        <boxGeometry args={[project.room.width, project.room.height, 0.08]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>}
      <mesh position={[project.room.width / 2, project.room.height / 2, project.room.length + 0.04]} castShadow receiveShadow>
        <boxGeometry args={[project.room.width, project.room.height, 0.08]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      {!cutaway && <mesh position={[project.room.width + 0.04, project.room.height / 2, project.room.length / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.08, project.room.height, project.room.length]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>}
      {project.room.clearanceZones.map((zone) => (
        <group key={zone.id} position={[zone.position.x, 0.012, zone.position.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[zone.width, zone.depth]} />
            <meshBasicMaterial color="#e97055" transparent opacity={0.26} side={THREE.DoubleSide} />
          </mesh>
          <Text position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.12} color="#762b20" anchorX="center">KEEP CLEAR</Text>
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
          onMove={onMoveItem}
          setDragging={setDragging}
        />
      ))}
    </>
  );
}

export function RoomCanvas(props: RoomCanvasProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ fov: 42, near: 0.05, far: 100 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        // Per-material clipping splits out-of-room parts of furniture into the red highlight.
        gl.localClippingEnabled = true;
      }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
