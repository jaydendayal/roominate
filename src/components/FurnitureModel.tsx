"use client";

import { createContext, useContext } from "react";
import * as THREE from "three";
import { furnitureModelKind } from "@/lib/furniture";
import type { FurnitureVisualPart, FurnitureVisualProfile } from "@/lib/types";

type Size = [number, number, number];
type Position = [number, number, number];

interface ModelProps {
  category: string;
  name: string;
  dimensions: { width: number; depth: number; height: number };
  color: string;
  opacity?: number;
  profile?: FurnitureVisualProfile;
  emphasized?: boolean;
  /** World-space clipping applied to every part (e.g. to split off the portion outside the room). */
  clipping?: ModelClipping;
}

export interface ModelClipping {
  planes: THREE.Plane[];
  /** Clip only where every plane clips (keeps the union of the planes' outsides) instead of where any does. */
  intersection?: boolean;
}

const FinishContext = createContext({ roughness: .7, metalness: 0 });
const ClipContext = createContext<ModelClipping | undefined>(undefined);

/** Material props that apply the model's clipping, if any. */
function useClip() {
  const clipping = useContext(ClipContext);
  return { clippingPlanes: clipping?.planes ?? null, clipIntersection: clipping?.intersection ?? false, clipShadows: true };
}

function tone(color: string, lightness: number) {
  return new THREE.Color(color).offsetHSL(0, 0, lightness).getStyle();
}

function BoxPart({ size, position, color, opacity = 1, radius = 0 }: { size: Size; position: Position; color: string; opacity?: number; radius?: number }) {
  const finish = useContext(FinishContext);
  const clip = useClip();
  return <mesh position={position} castShadow receiveShadow>
    {radius > 0 ? <boxGeometry args={size} /> : <boxGeometry args={size} />}
    <meshStandardMaterial color={color} roughness={radius ? Math.max(.72, finish.roughness) : finish.roughness} metalness={finish.metalness} transparent={opacity < 1} opacity={opacity} {...clip} />
  </mesh>;
}

function CylinderPart({ size, position, color, opacity = 1, sides = 18 }: { size: Size; position: Position; color: string; opacity?: number; sides?: number }) {
  const finish = useContext(FinishContext);
  const clip = useClip();
  return <mesh position={position} scale={[size[0] / 2, size[1], size[2] / 2]} castShadow receiveShadow>
    <cylinderGeometry args={[1, 1, 1, sides]} />
    <meshStandardMaterial color={color} roughness={finish.roughness} metalness={finish.metalness} transparent={opacity < 1} opacity={opacity} {...clip} />
  </mesh>;
}

function Chair({ w, h, d, color, opacity, hasArms = false, hasBack = true }: { w: number; h: number; d: number; color: string; opacity: number; hasArms?: boolean; hasBack?: boolean }) {
  const bottom = -h / 2;
  const seatY = bottom + h * 0.46;
  const legH = h * 0.43;
  const leg = Math.min(w, d) * 0.09;
  return <>
    <BoxPart size={[w * .84, h * .12, d * .78]} position={[0, seatY, d * .04]} color={color} opacity={opacity} radius={.04} />
    {hasBack && <BoxPart size={[w * .82, h * .48, d * .11]} position={[0, bottom + h * .72, -d * .37]} color={tone(color, -.06)} opacity={opacity} radius={.04} />}
    {hasArms && <><BoxPart size={[w * .08, h * .09, d * .62]} position={[-w * .43, bottom + h * .64, d * .02]} color={tone(color, -.04)} opacity={opacity} /><BoxPart size={[w * .08, h * .09, d * .62]} position={[w * .43, bottom + h * .64, d * .02]} color={tone(color, -.04)} opacity={opacity} /></>}
    {([-1, 1] as const).flatMap((x) => ([-1, 1] as const).map((z) => <BoxPart key={`${x}-${z}`} size={[leg, legH, leg]} position={[x * w * .34, bottom + legH / 2, z * d * .29]} color={tone(color, -.18)} opacity={opacity} />))}
  </>;
}

function Couch({ w, h, d, color, opacity, hasArms = true, hasBack = true }: { w: number; h: number; d: number; color: string; opacity: number; hasArms?: boolean; hasBack?: boolean }) {
  const bottom = -h / 2;
  return <>
    <BoxPart size={[w * .94, h * .27, d * .82]} position={[0, bottom + h * .25, d * .04]} color={tone(color, -.08)} opacity={opacity} radius={.06} />
    <BoxPart size={[w * .88, h * .22, d * .61]} position={[0, bottom + h * .47, d * .08]} color={tone(color, .04)} opacity={opacity} radius={.06} />
    {hasBack && <BoxPart size={[w * .88, h * .48, d * .16]} position={[0, bottom + h * .7, -d * .36]} color={color} opacity={opacity} radius={.06} />}
    {hasArms && <><BoxPart size={[w * .12, h * .48, d * .78]} position={[-w * .43, bottom + h * .46, d * .02]} color={tone(color, -.04)} opacity={opacity} radius={.05} /><BoxPart size={[w * .12, h * .48, d * .78]} position={[w * .43, bottom + h * .46, d * .02]} color={tone(color, -.04)} opacity={opacity} radius={.05} /></>}
    {[-1, 1].map((x) => <BoxPart key={x} size={[w * .04, h * .1, d * .08]} position={[x * w * .37, bottom + h * .05, d * .24]} color={tone(color, -.24)} opacity={opacity} />)}
  </>;
}

function Desk({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const bottom = -h / 2;
  const topH = Math.max(.04, h * .09);
  const legW = Math.min(w * .07, .09);
  return <>
    <BoxPart size={[w, topH, d]} position={[0, h / 2 - topH / 2, 0]} color={color} opacity={opacity} />
    {([-1, 1] as const).flatMap((x) => ([-1, 1] as const).map((z) => <BoxPart key={`${x}-${z}`} size={[legW, h - topH, legW]} position={[x * (w / 2 - legW), bottom + (h - topH) / 2, z * (d / 2 - legW)]} color={tone(color, -.16)} opacity={opacity} />))}
    <BoxPart size={[w * .72, h * .24, d * .05]} position={[0, bottom + h * .62, -d * .43]} color={tone(color, -.08)} opacity={opacity} />
  </>;
}

function Wardrobe({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const front = d / 2;
  return <>
    <BoxPart size={[w, h, d]} position={[0, 0, 0]} color={tone(color, -.08)} opacity={opacity} />
    <BoxPart size={[w * .47, h * .93, d * .025]} position={[-w * .245, 0, front + .012]} color={color} opacity={opacity} />
    <BoxPart size={[w * .47, h * .93, d * .025]} position={[w * .245, 0, front + .012]} color={tone(color, .025)} opacity={opacity} />
    <CylinderPart size={[w * .025, h * .1, w * .025]} position={[-w * .04, 0, front + .035]} color={tone(color, -.35)} opacity={opacity} sides={10} />
    <CylinderPart size={[w * .025, h * .1, w * .025]} position={[w * .04, 0, front + .035]} color={tone(color, -.35)} opacity={opacity} sides={10} />
  </>;
}

function Hamper({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const clip = useClip();
  return <>
    <CylinderPart size={[w * .92, h * .9, d * .92]} position={[0, -h * .03, 0]} color={color} opacity={opacity * .82} sides={20} />
    <mesh position={[0, h * .43, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[w * .46, Math.max(w, d) * .045, d * .46]} castShadow>
      <torusGeometry args={[1, .1, 8, 24]} />
      <meshStandardMaterial color={tone(color, -.15)} roughness={.8} transparent={opacity < 1} opacity={opacity} {...clip} />
    </mesh>
  </>;
}

function Beanbag({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const clip = useClip();
  return <mesh scale={[w / 2, h / 2, d / 2]} castShadow receiveShadow>
    <sphereGeometry args={[1, 24, 14]} />
    <meshStandardMaterial color={color} roughness={.94} transparent={opacity < 1} opacity={opacity} {...clip} />
  </mesh>;
}

function Ottoman({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const bottom = -h / 2;
  return <>
    <BoxPart size={[w * .92, h * .72, d * .92]} position={[0, bottom + h * .42, 0]} color={tone(color, -.05)} opacity={opacity} radius={.08} />
    <BoxPart size={[w, h * .24, d]} position={[0, h * .36, 0]} color={color} opacity={opacity} radius={.08} />
  </>;
}

function Dresser({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const front = d / 2;
  const rows = 4;
  return <>
    <BoxPart size={[w, h, d]} position={[0, 0, 0]} color={tone(color, -.1)} opacity={opacity} />
    {Array.from({ length: rows }, (_, index) => {
      const y = -h / 2 + h * (.16 + index * .22);
      return <group key={index}><BoxPart size={[w * .9, h * .18, d * .025]} position={[0, y, front + .012]} color={index % 2 ? color : tone(color, .025)} opacity={opacity} /><CylinderPart size={[w * .035, d * .04, w * .035]} position={[0, y, front + .04]} color={tone(color, -.34)} opacity={opacity} sides={10} /></group>;
    })}
  </>;
}

function Lamp({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const clip = useClip();
  const bottom = -h / 2;
  const span = Math.min(w, d);
  return <>
    <CylinderPart size={[w * .68, h * .06, d * .68]} position={[0, bottom + h * .03, 0]} color={tone(color, -.25)} opacity={opacity} sides={24} />
    <CylinderPart size={[span * .1, h * .66, span * .1]} position={[0, bottom + h * .39, 0]} color={tone(color, -.2)} opacity={opacity} sides={14} />
    <mesh position={[0, bottom + h * .8, 0]} scale={[w * .44, h * .32, d * .44]} castShadow receiveShadow>
      <coneGeometry args={[1, 1, 24, 1, true]} />
      <meshStandardMaterial color={tone(color, .16)} side={THREE.DoubleSide} roughness={.78} transparent opacity={opacity * .9} {...clip} />
    </mesh>
  </>;
}

function Mirror({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const clip = useClip();
  const face = d / 2;
  const frame = Math.max(.025, Math.min(w, h) * .07);
  return <>
    <BoxPart size={[w, h, Math.max(.025, d * .55)]} position={[0, 0, 0]} color={tone(color, -.18)} opacity={opacity} />
    <mesh position={[0, 0, face + .006]} castShadow>
      <planeGeometry args={[Math.max(.02, w - frame * 2), Math.max(.02, h - frame * 2)]} />
      <meshPhysicalMaterial color="#c9cde6" metalness={.75} roughness={.16} transparent={opacity < 1} opacity={opacity} {...clip} />
    </mesh>
    <BoxPart size={[w, frame, d * .25]} position={[0, h / 2 - frame / 2, face]} color={color} opacity={opacity} />
    <BoxPart size={[w, frame, d * .25]} position={[0, -h / 2 + frame / 2, face]} color={color} opacity={opacity} />
    <BoxPart size={[frame, h, d * .25]} position={[-w / 2 + frame / 2, 0, face]} color={color} opacity={opacity} />
    <BoxPart size={[frame, h, d * .25]} position={[w / 2 - frame / 2, 0, face]} color={color} opacity={opacity} />
  </>;
}

function MiniFridge({ w, h, d, color, opacity }: { w: number; h: number; d: number; color: string; opacity: number }) {
  const front = d / 2;
  return <>
    <BoxPart size={[w, h, d]} position={[0, 0, 0]} color={tone(color, -.08)} opacity={opacity} radius={.04} />
    <BoxPart size={[w * .91, h * .91, d * .035]} position={[0, 0, front + .017]} color={tone(color, .08)} opacity={opacity} radius={.03} />
    <BoxPart size={[w * .035, h * .38, d * .045]} position={[w * .38, h * .18, front + .045]} color={tone(color, -.35)} opacity={opacity} />
    <BoxPart size={[w * .88, h * .012, d * .03]} position={[0, h * .31, front + .04]} color={tone(color, -.24)} opacity={opacity} />
  </>;
}

const PART_FINISH: Record<FurnitureVisualPart["material"], { roughness: number; metalness: number }> = {
  wood: { roughness: 0.72, metalness: 0.03 },
  fabric: { roughness: 0.95, metalness: 0 },
  metal: { roughness: 0.34, metalness: 0.72 },
  plastic: { roughness: 0.5, metalness: 0.03 },
  glass: { roughness: 0.14, metalness: 0.62 },
  mixed: { roughness: 0.65, metalness: 0.12 },
};

const bounded = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
const radians = (degrees: number) => bounded(degrees, -180, 180) * Math.PI / 180;
const safeColor = (value: string | null | undefined, fallback: string) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

function ParametricPart({ part, dimensions, color, opacity, usePartColor }: { part: FurnitureVisualPart; dimensions: { width: number; depth: number; height: number }; color: string; opacity: number; usePartColor: boolean }) {
  const clip = useClip();
  const size: Size = [
    dimensions.width * bounded(part.size.x, 0.02, 1),
    dimensions.height * bounded(part.size.y, 0.02, 1),
    dimensions.depth * bounded(part.size.z, 0.02, 1),
  ];
  const position: Position = [
    dimensions.width * bounded(part.position.x, -0.5, 0.5),
    dimensions.height * bounded(part.position.y, -0.5, 0.5),
    dimensions.depth * bounded(part.position.z, -0.5, 0.5),
  ];
  const rotation: Position = [radians(part.rotation.x), radians(part.rotation.y), radians(part.rotation.z)];
  const finish = PART_FINISH[part.material] ?? PART_FINISH.mixed;
  const glass = part.material === "glass";
  const material = <meshStandardMaterial
    color={usePartColor ? safeColor(part.colorHex, color) : color}
    roughness={finish.roughness}
    metalness={finish.metalness}
    transparent={glass || opacity < 1}
    opacity={glass ? opacity * 0.48 : opacity}
    side={glass ? THREE.DoubleSide : THREE.FrontSide}
    {...clip}
  />;
  return <mesh position={position} rotation={rotation} scale={size} castShadow receiveShadow>
    {part.primitive === "sphere" ? <sphereGeometry args={[0.5, 24, 16]} />
      : part.primitive === "cylinder" ? <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
        : part.primitive === "cone" ? <coneGeometry args={[0.5, 1, 24]} />
          : <boxGeometry args={[1, 1, 1]} />}
    {material}
  </mesh>;
}

function ParametricFurniture({ parts, dimensions, color, opacity, usePartColors }: { parts: FurnitureVisualPart[]; dimensions: { width: number; depth: number; height: number }; color: string; opacity: number; usePartColors: boolean }) {
  return <group>{parts.slice(0, 24).map((part, index) => <ParametricPart key={`${part.role}-${index}`} part={part} dimensions={dimensions} color={color} opacity={opacity} usePartColor={usePartColors} />)}</group>;
}

export function FurnitureModel({ category, name, dimensions, color, opacity = 1, profile, emphasized = false, clipping }: ModelProps) {
  const w = dimensions.width;
  const h = dimensions.height;
  const d = dimensions.depth;
  const styleOffset = { modern: .02, traditional: -.08, industrial: -.14, minimal: .1, soft: .07, utility: 0 }[profile?.style ?? "utility"];
  const styledColor = tone(!emphasized && profile?.colorHex ? profile.colorHex : color, styleOffset);
  const finish = {
    wood: { roughness: .72, metalness: .03 }, fabric: { roughness: .95, metalness: 0 }, metal: { roughness: .34, metalness: .72 },
    plastic: { roughness: .5, metalness: .03 }, glass: { roughness: .14, metalness: .62 }, mixed: { roughness: .65, metalness: .12 },
  }[profile?.material ?? "mixed"];
  const footprintScale = { slim: .84, standard: .94, rounded: .92, bulky: 1 }[profile?.silhouette ?? "standard"];
  const kind = profile && profile.confidence >= .5 ? profile.archetype : furnitureModelKind(category, name);
  const props = { w, h, d, color: styledColor, opacity };
  const parametricParts = profile?.parts?.length && profile.parts.length >= 2 ? profile.parts : null;
  let model;
  if (parametricParts) model = <ParametricFurniture parts={parametricParts} dimensions={dimensions} color={styledColor} opacity={opacity} usePartColors={!emphasized} />;
  else switch (kind) {
    case "chair": model = <Chair {...props} hasArms={profile?.hasArms} hasBack={profile?.hasBack} />; break;
    case "couch": model = <Couch {...props} hasArms={profile?.hasArms} hasBack={profile?.hasBack} />; break;
    case "desk": model = <Desk {...props} />; break;
    case "wardrobe": model = <Wardrobe {...props} />; break;
    case "hamper": model = <Hamper {...props} />; break;
    case "beanbag": model = <Beanbag {...props} />; break;
    case "ottoman": model = <Ottoman {...props} />; break;
    case "dresser": model = <Dresser {...props} />; break;
    case "lamp": model = <Lamp {...props} />; break;
    case "mirror": model = <Mirror {...props} />; break;
    case "mini_fridge": model = <MiniFridge {...props} />; break;
    default: model = <BoxPart size={[w, h, d]} position={[0, 0, 0]} color={styledColor} opacity={opacity} />;
  }
  return <FinishContext.Provider value={finish}><ClipContext.Provider value={clipping}><group scale={parametricParts ? [1, 1, 1] : [footprintScale, 1, footprintScale]}>{model}</group></ClipContext.Provider></FinishContext.Provider>;
}
