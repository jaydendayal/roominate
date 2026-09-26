"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type ThreeEvent, useThree } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { itemHasConflict, productFor } from "@/lib/calculations";
import type { Issue, Item, Project, Vec2 } from "@/lib/types";

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

function FurnitureItem({
  project,
  item,
  issues,
  selected,
  onSelect,
  onMove,
  setDragging,
}: {
  project: Project;
  item: Item;
  issues: Issue[];
  selected: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: Vec2) => void;
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
    if (!onMove || item.locked) return;
    activePointer.current = event.pointerId;
    setDragging(true);
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((pointerEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((pointerEvent.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(plane, point)) {
        onMove(item.id, {
          x: Math.max(-0.5, Math.min(project.room.width + 0.5, point.x)),
          z: Math.max(-0.5, Math.min(project.room.length + 0.5, point.z)),
        });
      }
    };
    const stop = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointer.current) return;
      activePointer.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <group position={[position.x, dimensions.height / 2, position.z]} rotation={[0, item.transform?.rotationY ?? 0, 0]}>
      <mesh castShadow receiveShadow onPointerDown={startDrag}>
        <boxGeometry args={[dimensions.width, dimensions.height, dimensions.depth]} />
        <meshStandardMaterial color={color} roughness={0.72} transparent opacity={conflict ? 0.82 : 1} />
      </mesh>
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
    <Canvas shadows dpr={[1, 1.6]} camera={{ fov: 42, near: 0.05, far: 100 }} gl={{ antialias: true }}>
      <Scene {...props} />
    </Canvas>
  );
}
