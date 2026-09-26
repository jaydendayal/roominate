"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { FurnitureVisualProfile } from "@/lib/types";
import { FurnitureModel } from "./FurnitureModel";

const DEFAULT_DIMENSIONS: Record<FurnitureVisualProfile["archetype"], { width: number; depth: number; height: number }> = {
  chair: { width: 0.65, depth: 0.65, height: 0.9 },
  couch: { width: 1.8, depth: 0.85, height: 0.85 },
  desk: { width: 1.2, depth: 0.65, height: 0.75 },
  wardrobe: { width: 1.1, depth: 0.6, height: 1.9 },
  hamper: { width: 0.48, depth: 0.48, height: 0.65 },
  beanbag: { width: 0.95, depth: 0.95, height: 0.75 },
  ottoman: { width: 0.7, depth: 0.55, height: 0.42 },
  dresser: { width: 1.1, depth: 0.5, height: 0.9 },
  lamp: { width: 0.45, depth: 0.45, height: 1.55 },
  mirror: { width: 0.7, depth: 0.08, height: 1.65 },
  mini_fridge: { width: 0.52, depth: 0.55, height: 0.82 },
  box: { width: 0.8, depth: 0.6, height: 0.7 },
};

export function ProductModelPreview({
  name,
  category,
  profile,
  dimensions,
}: {
  name: string;
  category: string;
  profile: FurnitureVisualProfile;
  dimensions: { width: number | null; depth: number | null; height: number | null };
}) {
  const fallback = DEFAULT_DIMENSIONS[profile.archetype];
  const size = {
    width: dimensions.width && dimensions.width > 0 ? dimensions.width : fallback.width,
    depth: dimensions.depth && dimensions.depth > 0 ? dimensions.depth : fallback.depth,
    height: dimensions.height && dimensions.height > 0 ? dimensions.height : fallback.height,
  };
  const span = Math.max(size.width, size.depth, size.height);
  const measured = dimensions.width != null && dimensions.depth != null && dimensions.height != null;

  return <div className="product-model-preview" aria-label={`Interactive 3D preview of ${name || profile.archetype}`}>
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [span * 1.55, span * 1.8, span * 1.25], fov: 38, near: 0.01, far: 100, up: [0, 0, 1] }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#e4e2e9"]} />
      <ambientLight intensity={2.1} />
      <directionalLight position={[2, 3, 5]} intensity={2.7} />
      <mesh position={[0, 0, -0.018]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[span * 0.78, span * 0.78, 0.035, 48]} />
        <meshStandardMaterial color="#cfccd6" roughness={0.95} />
      </mesh>
      <group position={[0, 0, size.height / 2]}>
        <group rotation={[Math.PI / 2, 0, 0]}>
          <FurnitureModel category={category} name={name} dimensions={size} color="#847979" profile={profile} />
        </group>
      </group>
      <OrbitControls makeDefault target={[0, 0, size.height * 0.45]} enablePan={false} minDistance={span * 1.35} maxDistance={span * 4.5} />
    </Canvas>
    <span>{measured ? "Confirmed dimensions" : "Typical preview scale — confirm dimensions"} · drag to rotate</span>
  </div>;
}
