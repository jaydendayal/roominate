"use client";

import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Edges, PresentationControls, useCursor } from "@react-three/drei";
import { roomsTarget, shareTarget, workspaceTabs, type Screen } from "./workspaceTabs";

/** What an object in the model opens inside the current project. */
export type ProjectTarget = Screen | "share";
/** Every object in the model: the project targets, plus the bed, which leads to the other rooms. */
export type DioramaTarget = ProjectTarget | "rooms";

export interface HomeDioramaProps {
  issueCount: number;
  hasErrors: boolean;
  /** One short line of live project state for each callout's card, such as "3 in cart". */
  statuses: Record<DioramaTarget, string>;
  /** Highlighted object, whether the pointer is on it or on its callout, or its callout has focus. */
  active: DioramaTarget | null;
  onHover: (target: DioramaTarget | null) => void;
  onSelect: (target: DioramaTarget) => void;
}

const KHAKI = "#322e18";
const GRANITE = "#847979";
const SLATE = "#cfccd6";
const PERIWINKLE = "#bbc2e2";
const LAVENDER = "#b7b5e4";
const PAPER = "#f4f3f7";
// Model-only tints drawn from the palette.
const FLOOR = "#c6c0c6";
const CARDBOARD = "#a8998f";
const CARDBOARD_INSIDE = "#85776f";
const CORK = "#9c8d85";
const LEAF = "#4a452c";
const MIRROR = "#dfe1f1";
const ALERT_NOTE = "#d49a8c";

/** Room shell in meters, in the app's convention: X is width, Y is length (back wall at +Y), Z is up. */
const W = 4.4;
const L = 3.6;
const H = 2.5;
const T = 0.12;
const BACK = L / 2;
const LEFT = -W / 2;
const WINDOW = { left: -0.3, right: 0.9, sill: 0.95, head: 2.05 };
const DOOR = { front: -1.65, back: -0.85, head: 2.05 };
/** How far the door swings into the room while hovered, in radians: about 57°, which keeps it clear of the shopping bag. */
const DOOR_SWING = 1;

type Vec3 = [number, number, number];

/**
 * Where each callout's leader line lands on its object, and the leader length in pixels.
 * Leaders are staggered so neighbouring callouts don't collide.
 */
const CALLOUTS: Record<DioramaTarget, { anchor: Vec3; lead: number }> = {
  capture: { anchor: [-0.95, 1.55, 0.72], lead: 62 },
  studio: { anchor: [0.3, BACK, 2.14], lead: 20 },
  products: { anchor: [1.62, 0.2, 0.92], lead: 42 },
  constraints: { anchor: [1.6, BACK - 0.03, 1.84], lead: 34 },
  issues: { anchor: [LEFT + 0.04, -0.475, 1.8], lead: 22 },
  better: { anchor: [-1.25, -1.05, 0.64], lead: 44 },
  share: { anchor: [LEFT - T / 2, (DOOR.front + DOOR.back) / 2, 2.2], lead: 70 },
  rooms: { anchor: [LEFT + 0.5, 0.75, 0.46], lead: 56 },
};
/** Every object with a callout, in tab order: the six tabs by number, then the door and the bed by icon. */
const TARGETS: { id: DioramaTarget; mark: ReactNode; label: string; object: string; summary: string }[] = [
  ...workspaceTabs.map((tab) => ({ ...tab, mark: tab.index })),
  { ...shareTarget, id: "share", mark: <shareTarget.icon size={12} /> },
  { ...roomsTarget, id: "rooms", mark: <roomsTarget.icon size={12} /> },
];

type AnchorRegistry = Map<DioramaTarget, THREE.Object3D>;

const HoverContext = createContext(false);
const AnchorContext = createContext<RefObject<AnchorRegistry> | null>(null);

interface BlockProps {
  /** Centre of the block's base. */
  at: Vec3;
  size: Vec3;
  color: string;
  rotation?: Vec3;
  opacity?: number;
  metalness?: number;
  roughness?: number;
  outline?: boolean;
}

/** A box resting on `at`, finished like a card architectural model: flat colour and inked edges. */
function Block({ at, size, color, rotation, opacity, metalness = 0, roughness = 0.88, outline = true }: BlockProps) {
  const hovered = useContext(HoverContext);
  return (
    <mesh position={[at[0], at[1], at[2] + size[2] / 2]} rotation={rotation} castShadow={opacity === undefined} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={LAVENDER} emissiveIntensity={hovered ? 0.3 : 0} transparent={opacity !== undefined} opacity={opacity ?? 1} />
      {outline && <Edges threshold={20} color={KHAKI} lineWidth={hovered ? 1.6 : 1} transparent opacity={hovered ? 0.95 : 0.5} />}
    </mesh>
  );
}

/** A cylinder standing on `at`, or centred on `at` and lying along Y (facing into the room) when `alongY`. */
function Round({ at, radius, height, color, alongY = false }: { at: Vec3; radius: number; height: number; color: string; alongY?: boolean }) {
  const hovered = useContext(HoverContext);
  return (
    <mesh position={alongY ? at : [at[0], at[1], at[2] + height / 2]} rotation={alongY ? undefined : [Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, 20]} />
      <meshStandardMaterial color={color} roughness={0.8} emissive={LAVENDER} emissiveIntensity={hovered ? 0.3 : 0} />
      <Edges threshold={40} color={KHAKI} lineWidth={1} transparent opacity={0.5} />
    </mesh>
  );
}

/** A cardboard flap hinged on the top edge of a box, tilted `angle` radians up from lying flat outward. */
function Flap({ side, hinge, length, width, angle = 1.1 }: { side: "front" | "back" | "left" | "right"; hinge: Vec3; length: number; width: number; angle?: number }) {
  const alongY = side === "front" || side === "back";
  const outward = side === "back" || side === "right" ? 1 : -1;
  const rotation: Vec3 = alongY ? [outward * angle, 0, 0] : [0, -outward * angle, 0];
  const at: Vec3 = alongY ? [0, (outward * length) / 2, 0] : [(outward * length) / 2, 0, 0];
  return (
    <group position={hinge} rotation={rotation}>
      <Block at={at} size={alongY ? [width, length, 0.006] : [length, width, 0.006]} color={CARDBOARD} />
    </group>
  );
}

interface HotspotProps {
  target: DioramaTarget;
  active: boolean;
  /** How far the object rises while active, in meters. */
  lift?: number;
  onHover: (target: DioramaTarget | null) => void;
  onSelect: (target: DioramaTarget) => void;
  children: ReactNode;
}

function Hotspot({ target, active, lift = 0.05, onHover, onSelect, children }: HotspotProps) {
  const group = useRef<THREE.Group>(null);
  const anchors = useContext(AnchorContext);
  const [pointerInside, setPointerInside] = useState(false);
  useCursor(pointerInside);

  useFrame((_, delta) => {
    if (group.current) group.current.position.z = THREE.MathUtils.damp(group.current.position.z, active ? lift : 0, 14, delta);
  });

  return (
    <group
      ref={group}
      onPointerOver={(event) => { event.stopPropagation(); setPointerInside(true); onHover(target); }}
      onPointerOut={(event) => { event.stopPropagation(); setPointerInside(false); onHover(null); }}
      // `delta` is how far the pointer travelled; a drag that turns the model shouldn't also open a tab.
      onClick={(event) => { event.stopPropagation(); if (event.delta < 6) onSelect(target); }}
    >
      <HoverContext.Provider value={active}>{children}</HoverContext.Provider>
      <object3D
        position={CALLOUTS[target].anchor}
        ref={(anchor) => {
          if (!anchors) return;
          if (anchor) anchors.current.set(target, anchor);
          else anchors.current.delete(target);
        }}
      />
    </group>
  );
}

/** Moves each DOM callout to its anchor's projected screen position, so labels follow lifts and drags. */
function CalloutTracker({ callouts }: { callouts: RefObject<Map<DioramaTarget, HTMLElement>> }) {
  const anchors = useContext(AnchorContext);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!anchors) return;
    for (const [target, anchor] of anchors.current) {
      const element = callouts.current.get(target);
      if (!element) continue;
      anchor.getWorldPosition(point).project(camera);
      element.style.transform = `translate3d(${((point.x + 1) / 2) * size.width}px, ${((1 - point.y) / 2) * size.height}px, 0)`;
      element.style.visibility = "visible";
    }
  });
  return null;
}

function Floorboards() {
  const geometry = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let y = -L / 2 + 0.24; y < L / 2; y += 0.24) points.push(new THREE.Vector3(-W / 2, y, 0.001), new THREE.Vector3(W / 2, y, 0.001));
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);
  return <lineSegments geometry={geometry}><lineBasicMaterial color={KHAKI} transparent opacity={0.1} /></lineSegments>;
}

/** The door leaf, hinged on the back jamb: shut at rest, it swings into the room while the door is active. */
function DoorLeaf() {
  const open = useContext(HoverContext);
  const leaf = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (leaf.current) leaf.current.rotation.z = THREE.MathUtils.damp(leaf.current.rotation.z, open ? DOOR_SWING : 0, 9, delta);
  });
  return (
    <group ref={leaf} position={[LEFT, DOOR.back - 0.02, 0]}>
      <Block at={[0.02, -0.38, 0]} size={[0.04, 0.76, 2.02]} color={PAPER} />
      <Block at={[0.055, -0.66, 0.98]} size={[0.03, 0.09, 0.025]} color={KHAKI} />
    </group>
  );
}

/** Dashed quarter circle on the floor showing where the door swings, as a plan drawing would. */
function DoorSwing() {
  const geometry = useMemo(() => {
    const radius = DOOR.back - DOOR.front;
    const points: THREE.Vector3[] = [];
    const steps = 24;
    for (let step = 0; step < steps; step += 2) {
      for (const at of [step, step + 1]) {
        const angle = -(Math.PI / 2) * (1 - at / steps);
        points.push(new THREE.Vector3(LEFT + radius * Math.cos(angle), DOOR.back + radius * Math.sin(angle), 0.004));
      }
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, []);
  return <lineSegments geometry={geometry}><lineBasicMaterial color={KHAKI} transparent opacity={0.55} /></lineSegments>;
}

function Shell() {
  const wallY = BACK + T / 2;
  const wallX = LEFT - T / 2;
  return (
    <group>
      <Block at={[-T / 2, T / 2, -0.18]} size={[W + T + 0.5, L + T + 0.5, 0.16]} color={GRANITE} />
      <Block at={[0, 0, -0.02]} size={[W, L, 0.02]} color={FLOOR} />
      <Floorboards />
      {/* Back wall, open around the window. */}
      <Block at={[(LEFT - T + WINDOW.left) / 2, wallY, 0]} size={[WINDOW.left - LEFT + T, T, H]} color={SLATE} />
      <Block at={[(WINDOW.right + W / 2) / 2, wallY, 0]} size={[W / 2 - WINDOW.right, T, H]} color={SLATE} />
      <Block at={[(WINDOW.left + WINDOW.right) / 2, wallY, 0]} size={[WINDOW.right - WINDOW.left, T, WINDOW.sill]} color={SLATE} />
      <Block at={[(WINDOW.left + WINDOW.right) / 2, wallY, WINDOW.head]} size={[WINDOW.right - WINDOW.left, T, H - WINDOW.head]} color={SLATE} />
      {/* Left wall, open around the door. */}
      <Block at={[wallX, (-L / 2 + DOOR.front) / 2, 0]} size={[T, DOOR.front + L / 2, H]} color={SLATE} />
      <Block at={[wallX, (DOOR.back + BACK) / 2, 0]} size={[T, BACK - DOOR.back, H]} color={SLATE} />
      <Block at={[wallX, (DOOR.front + DOOR.back) / 2, DOOR.head]} size={[T, DOOR.back - DOOR.front, H - DOOR.head]} color={SLATE} />
      {/* Cut wall tops filled solid, like the section poché on a plan. */}
      <Block at={[(LEFT - T + W / 2) / 2, wallY, H]} size={[W / 2 - LEFT + T, T, 0.012]} color={KHAKI} outline={false} />
      <Block at={[wallX, (BACK - L / 2) / 2, H]} size={[T, BACK + L / 2, 0.012]} color={KHAKI} outline={false} />
    </group>
  );
}

function Bed() {
  const x = LEFT + 0.5;
  return (
    <group>
      <Block at={[x, 0.8, 0]} size={[1, 2, 0.28]} color={GRANITE} />
      <Block at={[x, 0.8, 0.28]} size={[0.94, 1.94, 0.14]} color={PAPER} />
      <Block at={[x, 0.42, 0.42]} size={[0.98, 1.18, 0.035]} color={LAVENDER} />
      <Block at={[x, 1.5, 0.42]} size={[0.6, 0.32, 0.09]} color={PAPER} />
      <Block at={[x, BACK - 0.03, 0]} size={[1, 0.06, 0.9]} color={GRANITE} />
    </group>
  );
}

function Desk() {
  const legs: Vec3[] = [[-0.3, 1.3, 0], [0.9, 1.3, 0], [-0.3, 1.74, 0], [0.9, 1.74, 0]];
  const chairLegs: Vec3[] = [[0.06, 0.78, 0], [0.44, 0.78, 0], [0.06, 1.12, 0], [0.44, 1.12, 0]];
  return (
    <group>
      {legs.map((leg) => <Block key={leg.join()} at={leg} size={[0.04, 0.04, 0.71]} color={KHAKI} />)}
      <Block at={[0.3, 1.52, 0.71]} size={[1.3, 0.55, 0.04]} color={PAPER} />
      <Block at={[0.2, 1.48, 0.75]} size={[0.34, 0.24, 0.014]} color={GRANITE} />
      <Block at={[0.2, 1.6, 0.764]} size={[0.34, 0.012, 0.21]} color={GRANITE} />
      <Block at={[0.72, 1.6, 0.75]} size={[0.2, 0.26, 0.04]} color={PERIWINKLE} />
      <Block at={[0.72, 1.6, 0.79]} size={[0.18, 0.24, 0.035]} color={SLATE} />
      {chairLegs.map((leg) => <Block key={leg.join()} at={leg} size={[0.03, 0.03, 0.42]} color={KHAKI} />)}
      <Block at={[0.25, 0.95, 0.42]} size={[0.44, 0.42, 0.05]} color={GRANITE} />
      <Block at={[0.25, 0.755, 0.47]} size={[0.44, 0.035, 0.42]} color={GRANITE} />
    </group>
  );
}

function Plant() {
  const leaves: [Vec3, number][] = [[[1.95, 1.5, 0.52], 0.2], [[1.87, 1.43, 0.72], 0.15], [[2.02, 1.58, 0.68], 0.13]];
  return (
    <group>
      <Round at={[1.95, 1.5, 0]} radius={0.14} height={0.3} color={GRANITE} />
      {leaves.map(([position, radius]) => (
        <mesh key={position.join()} position={position} castShadow>
          <icosahedronGeometry args={[radius, 0]} />
          <meshStandardMaterial color={LEAF} roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  );
}

const CORKBOARD_PAPERS = [
  { x: 1.36, z: 1.36, w: 0.16, h: 0.2, color: PAPER },
  { x: 1.6, z: 1.46, w: 0.2, h: 0.15, color: PERIWINKLE },
  { x: 1.84, z: 1.3, w: 0.15, h: 0.2, color: LAVENDER },
  { x: 1.55, z: 1.23, w: 0.18, h: 0.12, color: PAPER },
];

/** Sticky notes scattered across the mirror: one per open issue (up to six), warmer when something is blocking. */
function MirrorNotes({ count, hasErrors }: { count: number; hasErrors: boolean }) {
  const spots: [number, number, number][] = [[-0.6, 1.52, 0.1], [-0.37, 1.48, -0.14], [-0.58, 1.3, -0.06], [-0.36, 1.26, 0.12], [-0.6, 1.08, 0.08], [-0.38, 1.05, -0.1]];
  return (
    <>
      {spots.slice(0, Math.min(Math.max(count, 1), spots.length)).map(([y, z, tilt], index) => (
        <Block
          key={index}
          at={[LEFT + 0.039, y, z]}
          size={[0.005, 0.1, 0.1]}
          rotation={[tilt, 0, 0]}
          color={count === 0 ? PAPER : hasErrors && index % 2 === 0 ? ALERT_NOTE : index % 2 ? PERIWINKLE : LAVENDER}
        />
      ))}
    </>
  );
}

function Room({ issueCount, hasErrors, active, onHover, onSelect }: Omit<HomeDioramaProps, "statuses">) {
  const spot = (target: DioramaTarget) => ({ target, active: active === target, onHover, onSelect });
  return (
    <group>
      <Shell />
      <Desk />
      <Plant />
      <Block at={[0.35, -0.2, 0]} size={[1.9, 1.3, 0.012]} color={PERIWINKLE} />

      <Hotspot {...spot("rooms")}>
        <Bed />
      </Hotspot>

      <Hotspot {...spot("capture")}>
        <Block at={[-0.95, 1.59, 0]} size={[0.42, 0.4, 0.5]} color={PAPER} />
        <Block at={[-0.95, 1.385, 0.26]} size={[0.34, 0.012, 0.13]} color={SLATE} />
        <Block at={[-0.95, 1.56, 0.5]} size={[0.22, 0.1, 0.13]} color={KHAKI} />
        <Round at={[-0.95, 1.48, 0.565]} radius={0.045} height={0.08} color={GRANITE} alongY />
        <Round at={[-0.95, 1.435, 0.565]} radius={0.032} height={0.012} color={PERIWINKLE} alongY />
        <Block at={[-1.01, 1.56, 0.63]} size={[0.07, 0.06, 0.035]} color={KHAKI} />
        <Round at={[-0.87, 1.56, 0.63]} radius={0.022} height={0.02} color={SLATE} />
      </Hotspot>

      <Hotspot {...spot("studio")}>
        <Block at={[0.3, BACK - 0.02, WINDOW.sill - 0.04]} size={[1.34, 0.16, 0.04]} color={PAPER} />
        <Block at={[0.3, BACK + T / 2, WINDOW.head - 0.05]} size={[1.2, 0.07, 0.05]} color={PAPER} />
        <Block at={[WINDOW.left + 0.025, BACK + T / 2, WINDOW.sill]} size={[0.05, 0.07, WINDOW.head - WINDOW.sill - 0.05]} color={PAPER} />
        <Block at={[WINDOW.right - 0.025, BACK + T / 2, WINDOW.sill]} size={[0.05, 0.07, WINDOW.head - WINDOW.sill - 0.05]} color={PAPER} />
        <Block at={[0.3, BACK + T / 2, WINDOW.sill]} size={[0.035, 0.05, WINDOW.head - WINDOW.sill - 0.05]} color={PAPER} />
        <Block at={[0.3, BACK + T / 2, 1.47]} size={[1.1, 0.05, 0.035]} color={PAPER} />
        <Block at={[0.3, BACK + T / 2 + 0.01, WINDOW.sill]} size={[1.1, 0.012, WINDOW.head - WINDOW.sill - 0.05]} color={PERIWINKLE} opacity={0.55} outline={false} />
      </Hotspot>

      <Hotspot {...spot("products")}>
        <Block at={[1.62, 0.2, 0]} size={[0.58, 0.46, 0.4]} color={CARDBOARD} />
        <Block at={[1.62, 0.2, 0.4]} size={[0.58, 0.07, 0.006]} color={PAPER} outline={false} />
        <group position={[1.58, 0.16, 0.406]} rotation={[0, 0, 0.3]}>
          <Block at={[0, 0, 0]} size={[0.4, 0.32, 0.28]} color={CARDBOARD} />
          <Block at={[0, 0, 0.276]} size={[0.38, 0.3, 0.006]} color={CARDBOARD_INSIDE} outline={false} />
          <Flap side="back" hinge={[0, 0.16, 0.28]} length={0.16} width={0.4} />
          <Flap side="front" hinge={[0, -0.16, 0.28]} length={0.16} width={0.4} />
          <Flap side="right" hinge={[0.2, 0, 0.28]} length={0.14} width={0.32} angle={1.25} />
          <Flap side="left" hinge={[-0.2, 0, 0.28]} length={0.14} width={0.32} angle={1.25} />
        </group>
      </Hotspot>

      <Hotspot {...spot("constraints")}>
        <Block at={[1.6, BACK - 0.012, 1.14]} size={[0.84, 0.024, 0.62]} color={KHAKI} />
        <Block at={[1.6, BACK - 0.03, 1.17]} size={[0.76, 0.02, 0.56]} color={CORK} />
        {CORKBOARD_PAPERS.map((paper) => (
          <group key={`${paper.x}-${paper.z}`}>
            <Block at={[paper.x, BACK - 0.043, paper.z]} size={[paper.w, 0.005, paper.h]} color={paper.color} />
            <Round at={[paper.x, BACK - 0.05, paper.z + paper.h - 0.03]} radius={0.013} height={0.014} color={KHAKI} alongY />
          </group>
        ))}
      </Hotspot>

      <Hotspot {...spot("issues")}>
        <Block at={[LEFT + 0.012, -0.475, 0.5]} size={[0.024, 0.52, 1.28]} color={KHAKI} />
        <Block at={[LEFT + 0.03, -0.475, 0.54]} size={[0.012, 0.44, 1.2]} color={MIRROR} metalness={0.35} roughness={0.25} />
        <MirrorNotes count={issueCount} hasErrors={hasErrors} />
      </Hotspot>

      <Hotspot {...spot("better")}>
        <group position={[-1.25, -1.05, 0]} rotation={[0, 0, -0.35]}>
          <Block at={[0, 0, 0]} size={[0.34, 0.2, 0.36]} color={LAVENDER} />
          <Block at={[0, 0, 0.3]} size={[0.346, 0.206, 0.06]} color={PERIWINKLE} />
          <Block at={[0.06, 0, 0.3]} size={[0.12, 0.1, 0.16]} color={PAPER} />
          <Round at={[-0.08, 0.02, 0.3]} radius={0.025} height={0.22} color={GRANITE} />
          {[0.05, -0.05].map((y) => (
            <mesh key={y} position={[0, y, 0.36]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.07, 0.008, 6, 20, Math.PI]} />
              <meshStandardMaterial color={KHAKI} />
            </mesh>
          ))}
        </group>
      </Hotspot>

      {/* The swing is this object's hover cue, so it doesn't also rise off the floor. */}
      <Hotspot {...spot("share")} lift={0}>
        <Block at={[LEFT - T / 2, DOOR.front - 0.015, 0]} size={[T + 0.04, 0.03, DOOR.head + 0.03]} color={KHAKI} />
        <Block at={[LEFT - T / 2, DOOR.back + 0.015, 0]} size={[T + 0.04, 0.03, DOOR.head + 0.03]} color={KHAKI} />
        <Block at={[LEFT - T / 2, (DOOR.front + DOOR.back) / 2, DOOR.head]} size={[T + 0.04, DOOR.back - DOOR.front + 0.06, 0.03]} color={KHAKI} />
        <DoorLeaf />
        {/* An invisible pane across the doorway keeps the door hovered while the leaf swings out from under the pointer. */}
        <mesh position={[LEFT - T / 2, (DOOR.front + DOOR.back) / 2, DOOR.head / 2]} visible={false}>
          <boxGeometry args={[T + 0.04, DOOR.back - DOOR.front, DOOR.head]} />
        </mesh>
        <DoorSwing />
      </Hotspot>
    </group>
  );
}

/** Orthographic zoom and a view offset that keep the model centred, with headroom for its callouts, at any size. */
function FitCamera() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const { width, height } = size;
    camera.zoom = Math.max(20, Math.min((width - 48) / 6.8, (height - 90) / 5.45));
    camera.lookAt(0.24, 0.8, -0.1);
    // The model's outline sits about 0.27 units left of and 0.3 units above the look-at point on screen.
    // A negative offset starts the rendered window before the full view, which moves the model right and down.
    camera.setViewOffset(width, height, -0.27 * camera.zoom, -0.3 * camera.zoom, width, height);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function HomeDiorama({ issueCount, hasErrors, statuses, active, onHover, onSelect }: HomeDioramaProps) {
  const anchors = useRef<AnchorRegistry>(new Map());
  const callouts = useRef(new Map<DioramaTarget, HTMLElement>());
  const cardId = useId();
  return (
    <>
      <Canvas
        className="diorama-canvas"
        orthographic
        shadows
        flat
        dpr={[1, 2]}
        camera={{ position: [6.4, 7.2, 8.6], zoom: 80, near: 0.1, far: 60 }}
        fallback={<p className="diorama-fallback">This browser can’t draw the 3D model.</p>}
      >
        <AnchorContext.Provider value={anchors}>
          <FitCamera />
          <CalloutTracker callouts={callouts} />
          <hemisphereLight args={[PAPER, GRANITE, 1.7]} />
          <directionalLight position={[-3.5, 9, 6]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02} />
          <PresentationControls global snap cursor={false} polar={[-0.08, 0.1]} azimuth={[-0.5, 0.35]} speed={1.1}>
            {/* The model is authored Z-up like the rest of the app; this stands it upright for the Y-up camera. */}
            <group rotation={[-Math.PI / 2, 0, 0]}>
              <Room issueCount={issueCount} hasErrors={hasErrors} active={active} onHover={onHover} onSelect={onSelect} />
            </group>
          </PresentationControls>
        </AnchorContext.Provider>
      </Canvas>
      {/* The callouts are the page's navigation, so they are real buttons in tab order, not decoration. */}
      <div className="diorama-callouts">
        {TARGETS.map(({ id: target, mark, label, object, summary }) => (
          <div
            key={target}
            className={`callout-pin${active === target ? " active" : ""}`}
            ref={(element) => {
              if (element) callouts.current.set(target, element);
              else callouts.current.delete(target);
            }}
          >
            <button
              type="button"
              className="diorama-callout"
              aria-label={label}
              aria-describedby={`${cardId}-${target}`}
              style={{ "--lead": `${CALLOUTS[target].lead}px` } as CSSProperties}
              onPointerEnter={() => onHover(target)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(target)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(target)}
            >
              <span className="callout-chip">
                <b>{mark}</b>
                <span>{label}</span>
                {target === "issues" && issueCount > 0 && <em>{issueCount}</em>}
                <span className="callout-card" id={`${cardId}-${target}`}>
                  <small>{object}</small>{" "}
                  <span>{summary}</span>{" "}
                  <strong className={target === "issues" && hasErrors ? "alert" : undefined}>{statuses[target]}</strong>
                </span>
              </span>
              <i className="callout-stem" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
