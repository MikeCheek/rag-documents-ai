"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Line, Stars } from "@react-three/drei";
import * as THREE from "three";
import type { EmbeddingSpaceResult, EmbeddingSpacePoint } from "@/types";
import { FALLBACK_DOCUMENT_COLOR } from "@/lib/constellation-colors";

function QueryMarker({ position, label }: { position: [number, number, number]; label: string }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const pulse = 1 + Math.sin(clock.getElapsedTime() * 2) * 0.08;
    meshRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.32, 24, 24]} />
        <meshBasicMaterial color="#E0BD7C" />
      </mesh>
      <Html center distanceFactor={12} style={{ pointerEvents: "none" }}>
        <div
          style={{
            background: "rgba(12,15,22,0.9)",
            border: "1px solid rgba(224,189,124,0.6)",
            borderRadius: 8,
            padding: "4px 10px",
            color: "#F4F2ED",
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: 13,
            whiteSpace: "nowrap",
            transform: "translateY(24px)",
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

function ChunkMarker({
  point,
  color,
  isPinned,
  onTogglePin,
}: {
  point: EmbeddingSpacePoint;
  color: string;
  isPinned: boolean;
  onTogglePin: (id: number | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const closeness = Math.max(0, Math.min(1, point.similarity));
  const radius = point.isNeighbor ? 0.09 + closeness * 0.14 : 0.06;
  const opacity = point.isNeighbor ? 0.55 + closeness * 0.45 : 0.28;
  const showTooltip = hovered || isPinned;

  return (
    <group position={[point.x, point.y, point.z]}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(isPinned ? null : point.chunkId);
        }}
        scale={hovered || isPinned ? 1.4 : 1}
      >
        <sphereGeometry args={[radius, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>

      {showTooltip && (
        <Html center distanceFactor={10} style={{ pointerEvents: "none" }} zIndexRange={[100, 0]}>
          <div
            style={{
              background: "rgba(12,15,22,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              padding: "8px 12px",
              width: 220,
              color: "#EAEAE3",
              fontFamily: "var(--font-inter), sans-serif",
              transform: "translate(16px, -16px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 500, color: "#F4F2ED" }}>
                {point.documentName}
              </span>
            </div>
            <p style={{ fontSize: 11, lineHeight: 1.4, color: "#C7C9CE", margin: 0 }}>
              {point.content.slice(0, 140)}
              {point.content.length > 140 ? "…" : ""}
            </p>
            <p style={{ fontSize: 10, color: "#8B92A3", marginTop: 6, marginBottom: 0 }}>
              {Math.round(closeness * 100)}% similar
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}

function Scene({
  data,
  queryLabel,
  autoRotate,
  documentColorMap,
  pinnedId,
  onPinnedChange,
}: {
  data: EmbeddingSpaceResult;
  queryLabel: string;
  autoRotate: boolean;
  documentColorMap: Map<string, string>;
  pinnedId: number | null;
  onPinnedChange: (id: number | null) => void;
}) {
  const queryPos: [number, number, number] = [data.query.x, data.query.y, data.query.z];

  return (
    <>
      <color attach="background" args={["#0C0F16"]} />
      <Stars radius={40} depth={30} count={1200} factor={2} saturation={0} fade speed={0.4} />

      <QueryMarker position={queryPos} label={queryLabel} />

      {data.points.map((point) => {
        const color = documentColorMap.get(point.documentId) ?? FALLBACK_DOCUMENT_COLOR;
        return (
          <group key={point.chunkId}>
            {point.isNeighbor && (
              <Line
                points={[queryPos, [point.x, point.y, point.z]]}
                color={color}
                lineWidth={1}
                transparent
                opacity={0.15 + Math.max(0, Math.min(1, point.similarity)) * 0.25}
              />
            )}
            <ChunkMarker
              point={point}
              color={color}
              isPinned={pinnedId === point.chunkId}
              onTogglePin={onPinnedChange}
            />
          </group>
        );
      })}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        autoRotate={autoRotate}
        autoRotateSpeed={0.5}
        minDistance={4}
        maxDistance={40}
      />
    </>
  );
}

export default function ConstellationScene({
  data,
  queryLabel,
  autoRotate,
  documentColorMap,
  pinnedId,
  onPinnedChange,
}: {
  data: EmbeddingSpaceResult;
  queryLabel: string;
  autoRotate: boolean;
  documentColorMap: Map<string, string>;
  pinnedId: number | null;
  onPinnedChange: (id: number | null) => void;
}) {
  const cameraPosition = useMemo<[number, number, number]>(() => [0, 2, 14], []);

  return (
    <Canvas camera={{ position: cameraPosition, fov: 50 }} dpr={[1, 2]}>
      <Scene
        data={data}
        queryLabel={queryLabel}
        autoRotate={autoRotate}
        documentColorMap={documentColorMap}
        pinnedId={pinnedId}
        onPinnedChange={onPinnedChange}
      />
    </Canvas>
  );
}
