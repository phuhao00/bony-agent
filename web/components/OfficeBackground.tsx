"use client";

import {
  AgentMode,
  CompanionModel,
  MODE_COLORS,
} from "@/components/CompanionCharacter";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

const MOVEMENT_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

function isTypingInEditable(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!el.closest('[contenteditable="true"]');
}

function clearMovementKeys(keys: Record<string, boolean>) {
  for (const key of MOVEMENT_KEYS) keys[key] = false;
}

type OfficeBackgroundProps = {
  mode?: AgentMode;
  isThinking?: boolean;
  isTalking?: boolean;
  isSummoned?: boolean;
  onCharacterClick?: () => void;
  mediaUrl?: string;
  onMediaClose?: () => void;
};

/* ─────────────────────────────────────────────
   Bright maple floor with plank stripes + pastel rug
───────────────────────────────────────────── */
function WoodFloor() {
  return (
    <group>
      {/* Base warm maple */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -1.8, 0]}
        receiveShadow
      >
        <planeGeometry args={[22, 22]} />
        <meshStandardMaterial color="#C8955C" roughness={0.9} metalness={0} />
      </mesh>
      {/* Plank stripe highlights */}
      {Array.from({ length: 14 }).map((_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[i * 0.8 - 5.6, -1.795, 0]}
        >
          <planeGeometry args={[0.76, 22]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? "#D4A76A" : "#C8955C"}
            roughness={0.92}
            metalness={0}
            transparent
            opacity={0.55}
          />
        </mesh>
      ))}
      {/* Pastel circular rug */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.785, 1.0]}>
        <circleGeometry args={[2.0, 48]} />
        <meshStandardMaterial color="#F4C3CC" roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.783, 1.0]}>
        <circleGeometry args={[1.65, 48]} />
        <meshStandardMaterial color="#FBEAF0" roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.782, 1.0]}>
        <circleGeometry args={[0.95, 48]} />
        <meshStandardMaterial color="#F4C3CC" roughness={0.95} metalness={0} />
      </mesh>
      {/* Sunlight patch */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.2, -1.775, -0.8]}>
        <planeGeometry args={[2.6, 3.2]} />
        <meshStandardMaterial
          color="#FFE5A0"
          roughness={0.4}
          transparent
          opacity={0.3}
          metalness={0}
        />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Night room walls – cream/lavender tones
───────────────────────────────────────────── */
function RoomShell() {
  return (
    <group>
      {/* Back wall - warm cream */}
      <mesh position={[0, 1.2, -5.5]} receiveShadow>
        <planeGeometry args={[22, 9]} />
        <meshStandardMaterial color="#F2EDE6" roughness={0.92} metalness={0} />
      </mesh>
      {/* Wainscoting lower panel */}
      <mesh position={[0, -0.9, -5.48]}>
        <planeGeometry args={[22, 1.8]} />
        <meshStandardMaterial color="#E8DDD4" roughness={0.88} metalness={0} />
      </mesh>
      {/* Chair rail trim */}
      <mesh position={[0, -0.02, -5.46]}>
        <boxGeometry args={[22, 0.07, 0.06]} />
        <meshStandardMaterial color="#C8B89A" roughness={0.7} metalness={0} />
      </mesh>
      {/* Left wall */}
      <mesh
        rotation={[0, Math.PI / 2, 0]}
        position={[-7, 1.2, -2]}
        receiveShadow
      >
        <planeGeometry args={[14, 9]} />
        <meshStandardMaterial color="#EDE6DC" roughness={0.92} metalness={0} />
      </mesh>
      {/* Right wall */}
      <mesh
        rotation={[0, -Math.PI / 2, 0]}
        position={[7, 1.2, -2]}
        receiveShadow
      >
        <planeGeometry args={[14, 9]} />
        <meshStandardMaterial color="#EDE6DC" roughness={0.92} metalness={0} />
      </mesh>
      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 3.8, -2]}>
        <planeGeometry args={[22, 14]} />
        <meshStandardMaterial color="#F0EBE3" roughness={0.95} metalness={0} />
      </mesh>
      {/* Baseboard back */}
      <mesh position={[0, -1.55, -5.46]}>
        <boxGeometry args={[22, 0.14, 0.06]} />
        <meshStandardMaterial color="#C8B89A" roughness={0.8} metalness={0} />
      </mesh>
      {/* Baseboard left */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-6.97, -1.55, -2]}>
        <boxGeometry args={[14, 0.14, 0.06]} />
        <meshStandardMaterial color="#C8B89A" roughness={0.8} metalness={0} />
      </mesh>
      {/* Baseboard right */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[6.97, -1.55, -2]}>
        <boxGeometry args={[14, 0.14, 0.06]} />
        <meshStandardMaterial color="#C8B89A" roughness={0.8} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Night city skyline visible through windows
───────────────────────────────────────────── */
// City buildings silhouette rows – hoisted to module scope
const _BUILDINGS: { x: number; w: number; h: number; lit: boolean }[] = [
  { x: -5.5, w: 0.8, h: 1.4, lit: true },
  { x: -4.5, w: 0.6, h: 2.1, lit: false },
  { x: -3.7, w: 0.9, h: 1.7, lit: true },
  { x: -2.6, w: 0.5, h: 2.6, lit: true },
  { x: -1.9, w: 1.0, h: 1.2, lit: false },
  { x: -0.7, w: 0.7, h: 2.0, lit: true },
  { x: 0.2, w: 0.6, h: 1.5, lit: false },
  { x: 1.0, w: 0.9, h: 2.3, lit: true },
  { x: 2.1, w: 0.5, h: 1.8, lit: true },
  { x: 2.8, w: 0.8, h: 1.0, lit: false },
  { x: 3.8, w: 0.7, h: 2.5, lit: true },
  { x: 4.7, w: 1.0, h: 1.6, lit: false },
];
const _WIN_LIGHTS: { bx: number; bh: number; wx: number; wy: number }[] = [
  { bx: -5.5, bh: 1.4, wx: -0.2, wy: 0.5 },
  { bx: -5.5, bh: 1.4, wx: 0.2, wy: 0.2 },
  { bx: -3.7, bh: 1.7, wx: 0.1, wy: 0.6 },
  { bx: -2.6, bh: 2.6, wx: -0.1, wy: 0.8 },
  { bx: -2.6, bh: 2.6, wx: 0.15, wy: 1.5 },
  { bx: -0.7, bh: 2.0, wx: 0.0, wy: 0.7 },
  { bx: 1.0, bh: 2.3, wx: -0.1, wy: 1.0 },
  { bx: 1.0, bh: 2.3, wx: 0.2, wy: 0.4 },
  { bx: 2.1, bh: 1.8, wx: 0.0, wy: 0.6 },
  { bx: 3.8, bh: 2.5, wx: 0.1, wy: 1.2 },
  { bx: 3.8, bh: 2.5, wx: -0.15, wy: 0.5 },
];

function WindowUnit({ x, curtainColor }: { x: number; curtainColor: string }) {
  return (
    <group position={[x, 1.65, -5.46]}>
      {/* Frame */}
      <mesh>
        <boxGeometry args={[2.5, 2.5, 0.14]} />
        <meshStandardMaterial color="#E8E0D8" roughness={0.7} metalness={0} />
      </mesh>
      {/* Night sky glass – deep indigo */}
      <mesh position={[0, 0, 0.08]}>
        <planeGeometry args={[2.1, 2.1]} />
        <meshStandardMaterial
          color="#0A1628"
          emissive="#1A3366"
          emissiveIntensity={0.6}
          roughness={0.05}
          metalness={0}
        />
      </mesh>
      {/* Building silhouettes in window */}
      {_BUILDINGS.map((b, i) => (
        <mesh key={i} position={[b.x / 6.5, -0.75 + b.h / 2, 0.09]}>
          <boxGeometry args={[b.w / 4, b.h / 2, 0.01]} />
          <meshStandardMaterial
            color={b.lit ? "#1C2E4A" : "#111827"}
            emissive={b.lit ? "#2A4A7A" : "#0A0F1A"}
            emissiveIntensity={b.lit ? 0.4 : 0.1}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Lit windows on buildings */}
      {_WIN_LIGHTS.map((w, i) => (
        <mesh
          key={i}
          position={[w.bx / 6.5 + w.wx / 8, -0.75 + w.wy / 2, 0.095]}
        >
          <planeGeometry args={[0.055, 0.04]} />
          <meshStandardMaterial
            color="#FFE08A"
            emissive="#FFD060"
            emissiveIntensity={2.5}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Moon */}
      <mesh position={[0.5, 0.7, 0.09]}>
        <circleGeometry args={[0.13, 20]} />
        <meshStandardMaterial
          color="#FFFDE0"
          emissive="#FFFACC"
          emissiveIntensity={2.0}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Stars */}
      {Array.from({ length: 18 }).map((_, i) => (
        <mesh
          key={`star-${i}`}
          position={[
            ((i * 0.37 + 0.1) % 2.0) - 1.0,
            ((i * 0.53 + 0.2) % 1.8) - 0.2,
            0.095,
          ]}
        >
          <planeGeometry args={[0.018, 0.018]} />
          <meshStandardMaterial
            color="#FFFFFF"
            emissive="#FFFFFF"
            emissiveIntensity={i % 3 === 0 ? 3.0 : 1.5}
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Cross bars */}
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[0.055, 2.1, 0.025]} />
        <meshStandardMaterial color="#D8D0C8" roughness={0.6} metalness={0} />
      </mesh>
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[2.1, 0.055, 0.025]} />
        <meshStandardMaterial color="#D8D0C8" roughness={0.6} metalness={0} />
      </mesh>
      {/* Curtain rod */}
      <mesh position={[0, 1.36, 0.15]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, 3.2, 8]} />
        <meshStandardMaterial color="#C8A878" roughness={0.6} metalness={0} />
      </mesh>
      {/* Left curtain */}
      <mesh position={[-1.28, 0.05, 0.15]}>
        <boxGeometry args={[0.35, 2.55, 0.06]} />
        <meshStandardMaterial
          color={curtainColor}
          roughness={0.88}
          metalness={0}
        />
      </mesh>
      {/* Right curtain */}
      <mesh position={[1.28, 0.05, 0.15]}>
        <boxGeometry args={[0.35, 2.55, 0.06]} />
        <meshStandardMaterial
          color={curtainColor}
          roughness={0.88}
          metalness={0}
        />
      </mesh>
      {/* Tie-back */}
      <mesh position={[-1.28, -0.5, 0.17]}>
        <boxGeometry args={[0.08, 0.06, 0.08]} />
        <meshStandardMaterial color="#C8A878" roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[1.28, -0.5, 0.17]}>
        <boxGeometry args={[0.08, 0.06, 0.08]} />
        <meshStandardMaterial color="#C8A878" roughness={0.7} metalness={0} />
      </mesh>
      {/* Moonlight glow through glass */}
      <pointLight
        position={[0, 0, 0.5]}
        color="#B0C8FF"
        intensity={1.2}
        distance={5}
      />
    </group>
  );
}

function NightWindows() {
  return (
    <group>
      <WindowUnit x={-2.4} curtainColor="#C2A8C8" />
      <WindowUnit x={2.8} curtainColor="#A8B8D8" />
    </group>
  );
}

/* ─────────────────────────────────────────────
   Cute pendant ceiling lights (dome shade)
───────────────────────────────────────────── */
function Pendant({
  x,
  z,
  shadeColor,
  lightColor,
}: {
  x: number;
  z: number;
  shadeColor: string;
  lightColor: string;
}) {
  return (
    <group position={[x, 0, z]}>
      {/* Cord */}
      <mesh position={[0, 3.15, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.72, 6]} />
        <meshStandardMaterial color="#888" roughness={0.7} metalness={0} />
      </mesh>
      {/* Dome shade */}
      <mesh position={[0, 2.76, 0]}>
        <sphereGeometry
          args={[0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]}
        />
        <meshStandardMaterial
          color={shadeColor}
          roughness={0.55}
          metalness={0}
        />
      </mesh>
      {/* Bulb */}
      <mesh position={[0, 2.75, 0]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial
          color="#FFFDE0"
          emissive="#FFFDE0"
          emissiveIntensity={2.2}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <pointLight
        position={[0, 2.6, 0]}
        color={lightColor}
        intensity={5}
        distance={8}
      />
    </group>
  );
}

function CeilingLight() {
  return (
    <>
      <Pendant x={0} z={-2.5} shadeColor="#FFE4B5" lightColor="#FFF8DC" />
      <Pendant x={2.0} z={-0.5} shadeColor="#FFD6D6" lightColor="#FFF0F0" />
      <Pendant x={-3.5} z={-1.0} shadeColor="#D6E8FF" lightColor="#EEF5FF" />
    </>
  );
}

/* ─────────────────────────────────────────────
   Cozy white desk with kawaii accessories
───────────────────────────────────────────── */
function Desk() {
  return (
    <group position={[2.2, 0, -3.5]}>
      {/* Desk surface - cream white */}
      <mesh position={[0, -1.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.0, 0.08, 0.95]} />
        <meshStandardMaterial color="#F2EFEA" roughness={0.78} metalness={0} />
      </mesh>
      {/* Legs */}
      {(
        [
          [-1.38, -1.79, 0.38],
          [-1.38, -1.79, -0.38],
          [1.38, -1.79, 0.38],
          [1.38, -1.79, -0.38],
        ] as [number, number, number][]
      ).map((pos, i) => (
        <mesh key={i} position={pos} castShadow>
          <boxGeometry args={[0.07, 1.02, 0.07]} />
          <meshStandardMaterial
            color="#E0D8C8"
            roughness={0.75}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Monitor - white frame */}
      <mesh position={[0.3, -0.85, -0.26]} castShadow>
        <boxGeometry args={[1.35, 0.82, 0.055]} />
        <meshStandardMaterial color="#F5F5F5" roughness={0.7} metalness={0} />
      </mesh>
      {/* Screen */}
      <mesh position={[0.3, -0.85, -0.232]}>
        <planeGeometry args={[1.2, 0.68]} />
        <meshStandardMaterial
          color="#1A2E4A"
          emissive="#3B82F6"
          emissiveIntensity={0.4}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0.3, -1.225, -0.25]} castShadow>
        <boxGeometry args={[0.07, 0.17, 0.07]} />
        <meshStandardMaterial color="#E8E8E8" roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[0.3, -1.255, -0.32]} castShadow>
        <boxGeometry args={[0.34, 0.025, 0.2]} />
        <meshStandardMaterial color="#E8E8E8" roughness={0.7} metalness={0} />
      </mesh>
      {/* Pastel keyboard */}
      <mesh position={[0.3, -1.245, 0.14]} castShadow>
        <boxGeometry args={[0.88, 0.022, 0.3]} />
        <meshStandardMaterial color="#E0DAFF" roughness={0.85} metalness={0} />
      </mesh>
      {/* Coral mug */}
      <mesh position={[-1.1, -1.22, -0.12]} castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.13, 16]} />
        <meshStandardMaterial color="#FF8B71" roughness={0.3} metalness={0} />
      </mesh>
      <mesh position={[-1.1, -1.178, -0.12]}>
        <cylinderGeometry args={[0.058, 0.058, 0.01, 16]} />
        <meshStandardMaterial color="#6B3A2A" roughness={0.9} metalness={0} />
      </mesh>
      <mesh position={[-1.178, -1.22, -0.12]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.034, 0.009, 6, 12, Math.PI]} />
        <meshStandardMaterial color="#FF8B71" roughness={0.3} metalness={0} />
      </mesh>
      {/* Yellow sticky note */}
      <mesh
        position={[1.1, -1.235, -0.3]}
        rotation={[-Math.PI / 2 + 0.05, 0, 0.08]}
      >
        <planeGeometry args={[0.26, 0.26]} />
        <meshStandardMaterial color="#FFE869" roughness={0.9} metalness={0} />
      </mesh>
      {/* Tiny succulent pot */}
      <mesh position={[-1.2, -1.25, -0.28]} castShadow>
        <cylinderGeometry args={[0.065, 0.05, 0.1, 10]} />
        <meshStandardMaterial color="#90CAF9" roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[-1.2, -1.18, -0.28]} castShadow>
        <sphereGeometry args={[0.085, 10, 10]} />
        <meshStandardMaterial color="#66BB6A" roughness={0.88} metalness={0} />
      </mesh>
      {/* Desk books */}
      {(
        [
          [0.95, "#E74C3C", 0.068],
          [1.03, "#3498DB", 0.058],
          [1.1, "#F39C12", 0.075],
          [1.19, "#9B59B6", 0.06],
        ] as [number, string, number][]
      ).map(([bx, color, w], i) => (
        <mesh key={i} position={[bx, -1.11, -0.28]} castShadow>
          <boxGeometry args={[w, 0.36, 0.24]} />
          <meshStandardMaterial color={color} roughness={0.82} metalness={0} />
        </mesh>
      ))}
      {/* Small star decoration */}
      <mesh position={[1.35, -1.235, -0.18]} castShadow>
        <octahedronGeometry args={[0.045]} />
        <meshStandardMaterial
          color="#FFD700"
          emissive="#FFD700"
          emissiveIntensity={0.6}
          roughness={0.4}
          metalness={0}
        />
      </mesh>
    </group>
  );
}
/* ─────────────────────────────────────────────
   Cozy salmon sofa with pillows
───────────────────────────────────────────── */
function Sofa() {
  return (
    <group position={[-4.0, -1.8, 0.2]}>
      {/* Seat base */}
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.44, 0.9]} />
        <meshStandardMaterial color="#FFB3B3" roughness={0.9} metalness={0} />
      </mesh>
      {/* Back rest */}
      <mesh position={[0, 0.74, -0.32]} castShadow>
        <boxGeometry args={[2.2, 0.66, 0.28]} />
        <meshStandardMaterial color="#FF9999" roughness={0.9} metalness={0} />
      </mesh>
      {/* Left arm */}
      <mesh position={[-1.06, 0.54, -0.04]} castShadow>
        <boxGeometry args={[0.12, 0.64, 0.84]} />
        <meshStandardMaterial color="#FF9999" roughness={0.9} metalness={0} />
      </mesh>
      {/* Right arm */}
      <mesh position={[1.06, 0.54, -0.04]} castShadow>
        <boxGeometry args={[0.12, 0.64, 0.84]} />
        <meshStandardMaterial color="#FF9999" roughness={0.9} metalness={0} />
      </mesh>
      {/* Legs */}
      {(
        [
          [-0.9, -0.04, 0.32],
          [0.9, -0.04, 0.32],
          [-0.9, -0.04, -0.32],
          [0.9, -0.04, -0.32],
        ] as [number, number, number][]
      ).map((p, i) => (
        <mesh key={i} position={p} castShadow>
          <boxGeometry args={[0.09, 0.12, 0.09]} />
          <meshStandardMaterial color="#D4AF87" roughness={0.7} metalness={0} />
        </mesh>
      ))}
      {/* Seat cushion */}
      <mesh position={[0, 0.47, 0.1]} castShadow>
        <boxGeometry args={[1.88, 0.14, 0.62]} />
        <meshStandardMaterial color="#FFCDD2" roughness={0.9} metalness={0} />
      </mesh>
      {/* Pink pillow */}
      <mesh position={[-0.54, 0.72, -0.08]} castShadow>
        <boxGeometry args={[0.46, 0.38, 0.17]} />
        <meshStandardMaterial color="#F8BBD9" roughness={0.88} metalness={0} />
      </mesh>
      {/* Blue pillow */}
      <mesh position={[0.5, 0.7, -0.08]} castShadow>
        <boxGeometry args={[0.4, 0.36, 0.17]} />
        <meshStandardMaterial color="#B3E5FC" roughness={0.88} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Plants (large + small)
───────────────────────────────────────────── */
function Plants() {
  return (
    <group>
      {/* Large floor plant – right back corner */}
      <group position={[5.5, -1.8, -4.0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.22, 0.17, 0.4, 12]} />
          <meshStandardMaterial
            color="#A5D6A7"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <cylinderGeometry args={[0.21, 0.21, 0.04, 12]} />
          <meshStandardMaterial color="#4CAF50" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, 0.62, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.04, 0.65, 6]} />
          <meshStandardMaterial color="#558B2F" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, 1.08, 0]} castShadow>
          <sphereGeometry args={[0.42, 12, 12]} />
          <meshStandardMaterial
            color="#388E3C"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
        <mesh position={[0.23, 1.0, 0.12]} castShadow>
          <sphereGeometry args={[0.27, 10, 10]} />
          <meshStandardMaterial
            color="#66BB6A"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
      </group>
      {/* Small plant – left area */}
      <group position={[-3.2, -1.8, -0.4]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.17, 0.13, 0.3, 10]} />
          <meshStandardMaterial
            color="#FF8B71"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
        <mesh position={[0, 0.19, 0]}>
          <cylinderGeometry args={[0.165, 0.165, 0.03, 10]} />
          <meshStandardMaterial
            color="#3B2008"
            roughness={0.95}
            metalness={0}
          />
        </mesh>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.03, 0.5, 6]} />
          <meshStandardMaterial color="#4A7C59" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, 0.84, 0]} castShadow>
          <sphereGeometry args={[0.3, 10, 10]} />
          <meshStandardMaterial
            color="#2D6A4F"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
        <mesh position={[0.18, 0.78, 0.1]} castShadow>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshStandardMaterial
            color="#40916C"
            roughness={0.88}
            metalness={0}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Colorful bookshelf (caramel tone)
───────────────────────────────────────────── */
function Bookshelf() {
  const shelfColor = "#D4AF87";
  return (
    <group position={[-5.8, -0.2, -3.5]} rotation={[0, Math.PI / 2, 0]}>
      {/* Sides */}
      <mesh position={[-0.6, 0.5, 0]} castShadow>
        <boxGeometry args={[0.07, 3.0, 0.36]} />
        <meshStandardMaterial
          color={shelfColor}
          roughness={0.7}
          metalness={0}
        />
      </mesh>
      <mesh position={[0.6, 0.5, 0]} castShadow>
        <boxGeometry args={[0.07, 3.0, 0.36]} />
        <meshStandardMaterial
          color={shelfColor}
          roughness={0.7}
          metalness={0}
        />
      </mesh>
      {/* Shelf boards */}
      {[-0.9, -0.05, 0.78, 1.58].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow>
          <boxGeometry args={[1.27, 0.055, 0.36]} />
          <meshStandardMaterial
            color={shelfColor}
            roughness={0.7}
            metalness={0}
          />
        </mesh>
      ))}
      {/* Top cap */}
      <mesh position={[0, 2.02, 0]} castShadow>
        <boxGeometry args={[1.36, 0.055, 0.4]} />
        <meshStandardMaterial
          color={shelfColor}
          roughness={0.7}
          metalness={0}
        />
      </mesh>
      {/* Bottom shelf books */}
      {(
        [
          [-0.5, "#E74C3C", 0.08],
          [-0.4, "#3498DB", 0.07],
          [-0.32, "#2ECC71", 0.09],
          [-0.22, "#F39C12", 0.065],
          [-0.15, "#9B59B6", 0.075],
          [-0.07, "#1ABC9C", 0.055],
          [0.0, "#E67E22", 0.08],
        ] as [number, string, number][]
      ).map(([x, c, w], i) => (
        <mesh key={`s0-${i}`} position={[x, -0.65, 0]} castShadow>
          <boxGeometry args={[w, 0.38, 0.27]} />
          <meshStandardMaterial color={c} roughness={0.82} metalness={0} />
        </mesh>
      ))}
      {/* Mid shelf books */}
      {(
        [
          [-0.42, "#FF6B9D", 0.07],
          [-0.34, "#45B7D1", 0.085],
          [-0.25, "#98D8C8", 0.065],
          [-0.18, "#FFD93D", 0.08],
          [-0.09, "#6BCB77", 0.07],
        ] as [number, string, number][]
      ).map(([x, c, w], i) => (
        <mesh key={`s1-${i}`} position={[x, 0.16, 0]} castShadow>
          <boxGeometry args={[w, 0.36, 0.27]} />
          <meshStandardMaterial color={c} roughness={0.82} metalness={0} />
        </mesh>
      ))}
      {/* Trophy on upper shelf */}
      <mesh position={[0.32, 1.02, 0]} castShadow>
        <boxGeometry args={[0.11, 0.22, 0.11]} />
        <meshStandardMaterial color="#FFD700" roughness={0.35} metalness={0} />
      </mesh>
      <mesh position={[0.32, 1.16, 0]} castShadow>
        <sphereGeometry args={[0.075, 8, 8]} />
        <meshStandardMaterial color="#FFD700" roughness={0.35} metalness={0} />
      </mesh>
      {/* Top shelf plant */}
      <mesh position={[-0.28, 1.66, 0]} castShadow>
        <cylinderGeometry args={[0.088, 0.072, 0.14, 10]} />
        <meshStandardMaterial color="#FF8B71" roughness={0.85} metalness={0} />
      </mesh>
      <mesh position={[-0.28, 1.8, 0]} castShadow>
        <sphereGeometry args={[0.13, 10, 10]} />
        <meshStandardMaterial color="#66BB6A" roughness={0.88} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Wall art, bulletin board, wall clock
───────────────────────────────────────────── */
function WallDecorations() {
  return (
    <group>
      {/* Framed landscape painting */}
      <group position={[-4.2, 1.85, -5.42]}>
        <mesh>
          <boxGeometry args={[0.9, 0.68, 0.04]} />
          <meshStandardMaterial color="#D4AF87" roughness={0.6} metalness={0} />
        </mesh>
        {/* Sky */}
        <mesh position={[0, 0.06, 0.026]}>
          <planeGeometry args={[0.76, 0.28]} />
          <meshStandardMaterial
            color="#87CEEB"
            emissive="#AEDFE8"
            emissiveIntensity={0.25}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
        {/* Grass */}
        <mesh position={[0, -0.16, 0.026]}>
          <planeGeometry args={[0.76, 0.2]} />
          <meshStandardMaterial color="#7CB97C" roughness={0.9} metalness={0} />
        </mesh>
        {/* Mountain */}
        <mesh position={[0.05, -0.02, 0.028]}>
          <coneGeometry args={[0.22, 0.3, 3]} />
          <meshStandardMaterial color="#90A4AE" roughness={0.9} metalness={0} />
        </mesh>
      </group>

      {/* Cute flower frame */}
      <group position={[5.2, 1.85, -5.42]}>
        <mesh>
          <boxGeometry args={[0.72, 0.56, 0.04]} />
          <meshStandardMaterial color="#FFB3C1" roughness={0.6} metalness={0} />
        </mesh>
        <mesh position={[0, 0, 0.026]}>
          <planeGeometry args={[0.58, 0.42]} />
          <meshStandardMaterial
            color="#FFF9C4"
            emissive="#FFFDE7"
            emissiveIntensity={0.2}
            roughness={0.9}
            metalness={0}
          />
        </mesh>
        <mesh position={[0, 0, 0.029]}>
          <circleGeometry args={[0.1, 12]} />
          <meshStandardMaterial color="#FF80AB" roughness={0.9} metalness={0} />
        </mesh>
        <mesh position={[0, 0, 0.031]}>
          <circleGeometry args={[0.05, 12]} />
          <meshStandardMaterial color="#FFD740" roughness={0.9} metalness={0} />
        </mesh>
      </group>

      {/* Bulletin board */}
      <group position={[3.8, 1.5, -5.42]}>
        <mesh>
          <boxGeometry args={[1.45, 1.05, 0.07]} />
          <meshStandardMaterial color="#DEB887" roughness={0.8} metalness={0} />
        </mesh>
        <mesh position={[0, 0, 0.04]}>
          <planeGeometry args={[1.32, 0.92]} />
          <meshStandardMaterial color="#F5DEB3" roughness={0.9} metalness={0} />
        </mesh>
        {/* Pinned notes */}
        {(
          [
            [-0.3, 0.22, "#FFE869"],
            [0.12, -0.08, "#B3E5FC"],
            [-0.1, -0.22, "#F8BBD9"],
            [0.38, 0.18, "#C8E6C9"],
            [-0.35, -0.05, "#FFD180"],
          ] as [number, number, string][]
        ).map(([x, y, c], i) => (
          <mesh
            key={i}
            position={[x, y, 0.046]}
            rotation={[0, 0, (i - 2) * 0.07]}
          >
            <planeGeometry args={[0.28, 0.21]} />
            <meshStandardMaterial color={c} roughness={0.9} metalness={0} />
          </mesh>
        ))}
        {/* Push pins */}
        {(
          [
            [-0.3, 0.32],
            [0.12, 0.02],
            [-0.1, -0.12],
            [0.38, 0.28],
            [-0.35, 0.05],
          ] as [number, number][]
        ).map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.058]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial
              color={["#FF5252", "#69F0AE", "#448AFF", "#FF6D00", "#EA80FC"][i]}
              roughness={0.4}
              metalness={0}
            />
          </mesh>
        ))}
      </group>

      {/* Wall clock on right wall */}
      <mesh position={[6.92, 2.1, -1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.28, 0.28, 0.05, 24]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.55} metalness={0} />
      </mesh>
      <mesh position={[6.91, 2.1, -1.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.24, 0.24, 0.01, 24]} />
        <meshStandardMaterial color="#F9F9F9" roughness={0.9} metalness={0} />
      </mesh>
      {/* Hour hand */}
      <mesh position={[6.895, 2.16, -1.5]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.012, 0.13, 0.015]} />
        <meshStandardMaterial color="#333" roughness={0.8} metalness={0} />
      </mesh>
      {/* Minute hand */}
      <mesh
        position={[6.895, 2.14, -1.46]}
        rotation={[0, 0, Math.PI / 2 - 0.9]}
      >
        <boxGeometry args={[0.009, 0.17, 0.012]} />
        <meshStandardMaterial color="#333" roughness={0.8} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Small round side table
───────────────────────────────────────────── */
function SideTable() {
  return (
    <group position={[-2.4, -1.8, 0.8]}>
      <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.38, 0.38, 0.05, 20]} />
        <meshStandardMaterial color="#F5DEB3" roughness={0.8} metalness={0} />
      </mesh>
      <mesh position={[0, 0.26, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
        <meshStandardMaterial color="#D4AF87" roughness={0.75} metalness={0} />
      </mesh>
      <mesh position={[0, 0.01, 0]} castShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.04, 16]} />
        <meshStandardMaterial color="#D4AF87" roughness={0.75} metalness={0} />
      </mesh>
      {/* Teacup */}
      <mesh position={[0.1, 0.585, 0.05]} castShadow>
        <cylinderGeometry args={[0.055, 0.045, 0.1, 12]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.3} metalness={0} />
      </mesh>
      <mesh position={[0.1, 0.558, 0.05]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.012, 16]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.3} metalness={0} />
      </mesh>
      {/* Small book */}
      <mesh position={[-0.12, 0.565, 0]} castShadow>
        <boxGeometry args={[0.2, 0.025, 0.16]} />
        <meshStandardMaterial color="#FF80AB" roughness={0.85} metalness={0} />
      </mesh>
    </group>
  );
}

/* ─────────────────────────────────────────────
   Cozy night-room lighting
───────────────────────────────────────────── */
function SceneLighting() {
  return (
    <>
      {/* Scene base color */}
      <color attach="background" args={["#0D1B2A"]} />
      {/* Soft warm ambient – indoor at night */}
      <ambientLight intensity={0.9} color="#FFE8CC" />
      {/* Main warm lamp glow from center */}
      <pointLight
        position={[0, 2.8, -2]}
        color="#FFD090"
        intensity={6.0}
        distance={16}
      />
      {/* Front character fill */}
      <pointLight
        position={[0, 1.8, 4.0]}
        color="#FFE8CC"
        intensity={3.5}
        distance={12}
      />
      {/* Left side warm bounce */}
      <pointLight
        position={[-4, 2.0, 0]}
        color="#FFCC88"
        intensity={2.5}
        distance={10}
      />
      {/* Right side warm bounce */}
      <pointLight
        position={[4, 2.0, 0]}
        color="#FFCC88"
        intensity={2.2}
        distance={10}
      />
      {/* Cool moonlight from windows */}
      <pointLight
        position={[-2.4, 2.5, -3]}
        color="#7090C8"
        intensity={1.0}
        distance={8}
      />
      <pointLight
        position={[2.8, 2.5, -3]}
        color="#7090C8"
        intensity={0.8}
        distance={8}
      />
    </>
  );
}

/* ─────────────────────────────────────────────
   Full scene
───────────────────────────────────────────── */
function OfficeScene() {
  return (
    <>
      <SceneLighting />
      <NightWindows />
      <CeilingLight />
      <RoomShell />
      <WoodFloor />
      <Desk />
      <Sofa />
      <Plants />
      <Bookshelf />
      <WallDecorations />
      <SideTable />
      <ContactShadows
        position={[0, -1.79, 0]}
        opacity={0.22}
        scale={14}
        blur={2.5}
        far={4}
        color="#2A1500"
      />
    </>
  );
}

/* ─────────────────────────────────────────────
   Walking character + camera follow
───────────────────────────────────────────── */
function WalkingCharacterScene({
  mode = "copy",
  isThinking,
  isTalking,
  isSummoned,
  onCharacterClick,
  mediaUrl,
}: OfficeBackgroundProps) {
  const hasMedia = !!mediaUrl;
  const colors = MODE_COLORS[mode];
  const charRef = useRef<THREE.Group>(null);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const keys = useRef<Record<string, boolean>>({});
  const wasMovingRef = useRef(false);
  const [isWalking, setIsWalking] = useState(false);

  // Key listeners
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (MOVEMENT_KEYS.has(key) && isTypingInEditable()) return;
      keys.current[key] = true;
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (MOVEMENT_KEYS.has(key) && isTypingInEditable()) return;
      keys.current[key] = false;
    };
    const onFocusIn = () => {
      if (isTypingInEditable()) clearMovementKeys(keys.current);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  useFrame((_, delta) => {
    if (!charRef.current) return;

    // ── Media active: slide Nova to the right edge, point camera at video ──
    if (hasMedia) {
      charRef.current.position.x = THREE.MathUtils.lerp(
        charRef.current.position.x,
        3.6,
        0.03,
      );
      charRef.current.position.z = THREE.MathUtils.lerp(
        charRef.current.position.z,
        0.8,
        0.03,
      );
      charRef.current.position.y = THREE.MathUtils.lerp(
        charRef.current.position.y,
        -1.18,
        0.12,
      );
      // Turn Nova to face slightly inward (toward the screen)
      charRef.current.rotation.y = THREE.MathUtils.lerp(
        charRef.current.rotation.y,
        -Math.PI * 0.18,
        0.05,
      );
      const orbit = orbitRef.current as unknown as {
        target: THREE.Vector3;
      } | null;
      if (orbit) {
        orbit.target.lerp(new THREE.Vector3(0, 0.5, -0.2), 0.04);
      }
      return;
    }

    const k = keys.current;
    const speed = 2.8;
    let dx = 0;
    let dz = 0;

    if (isTypingInEditable()) {
      clearMovementKeys(k);
      if (wasMovingRef.current) {
        wasMovingRef.current = false;
        setIsWalking(false);
      }
    } else {
      if (k["w"] || k["arrowup"]) dz -= 1;
      if (k["s"] || k["arrowdown"]) dz += 1;
      if (k["a"] || k["arrowleft"]) dx -= 1;
      if (k["d"] || k["arrowright"]) dx += 1;
    }

    const isMoving = dx !== 0 || dz !== 0;

    // Notify CompanionModel of walking state (only triggers re-render on change)
    if (isMoving !== wasMovingRef.current) {
      wasMovingRef.current = isMoving;
      setIsWalking(isMoving);
    }

    if (isMoving) {
      // Normalise diagonal
      const len = Math.sqrt(dx * dx + dz * dz);
      dx = (dx / len) * speed * delta;
      dz = (dz / len) * speed * delta;

      // Face movement direction
      const targetAngle = Math.atan2(dx, dz);
      charRef.current.rotation.y = THREE.MathUtils.lerp(
        charRef.current.rotation.y,
        targetAngle,
        0.18,
      );

      // Move, clamped inside the room
      charRef.current.position.x = THREE.MathUtils.clamp(
        charRef.current.position.x + dx,
        -5.5,
        5.5,
      );
      charRef.current.position.z = THREE.MathUtils.clamp(
        charRef.current.position.z + dz,
        -4.5,
        2.5,
      );

      // Flat world Y — CompanionModel handles the internal body bob
      charRef.current.position.y = THREE.MathUtils.lerp(
        charRef.current.position.y,
        -1.18,
        0.18,
      );
      // Slight forward lean while walking
      charRef.current.rotation.x = THREE.MathUtils.lerp(
        charRef.current.rotation.x,
        0.06,
        0.12,
      );
    } else {
      // Settle back to floor and upright
      charRef.current.position.y = THREE.MathUtils.lerp(
        charRef.current.position.y,
        -1.18,
        0.12,
      );
      charRef.current.rotation.x = THREE.MathUtils.lerp(
        charRef.current.rotation.x,
        0,
        0.12,
      );
    }

    // Camera follows character
    const orbit = orbitRef.current as unknown as {
      target: THREE.Vector3;
    } | null;
    if (orbit) {
      orbit.target.lerp(
        new THREE.Vector3(
          charRef.current.position.x,
          charRef.current.position.y + 0.6,
          charRef.current.position.z,
        ),
        0.08,
      );
    }
  });

  return (
    <>
      <OrbitControls
        ref={orbitRef}
        makeDefault
        minPolarAngle={Math.PI / 2.3}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={2}
        maxDistance={9}
        enablePan={false}
        rotateSpeed={0.5}
        zoomSpeed={0.8}
        target={[0, -0.5, 1.5]}
      />
      <group ref={charRef} position={[0, -1.18, 1.5]}>
        <CompanionModel
          colors={colors}
          isThinking={isThinking}
          isTalking={isTalking}
          isSummoned={isSummoned}
          isDancing={hasMedia}
          isWalking={isWalking}
          onClick={onCharacterClick}
        />
      </group>
    </>
  );
}

/* ─────────────────────────────────────────────
   Generated media display – left wall gallery frame
───────────────────────────────────────────── */
function ImageFrame3D({ url, onClose }: { url: string; onClose?: () => void }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (t) => setTexture(t),
      undefined,
      (err) => console.warn("[ImageFrame3D] texture load failed:", url, err),
    );
  }, [url]);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y =
        0.6 + Math.sin(clock.getElapsedTime() * 0.8) * 0.04;
    }
  });

  if (!texture) return null;

  const W = 4.2,
    H = 4.2; // square for images
  return (
    <group ref={groupRef} position={[0, 0.6, -1.8]}>
      {/* Ambient glow behind screen */}
      <pointLight
        position={[0, 0, 0.6]}
        color="#a78bfa"
        intensity={6}
        distance={7}
      />
      {/* Outer dark frame */}
      <mesh castShadow>
        <boxGeometry args={[W + 0.32, H + 0.32, 0.07]} />
        <meshStandardMaterial
          color="#0f0f1e"
          roughness={0.15}
          metalness={0.95}
        />
      </mesh>
      {/* Neon violet border */}
      <mesh position={[0, 0, 0.036]}>
        <boxGeometry args={[W + 0.14, H + 0.14, 0.016]} />
        <meshStandardMaterial
          color="#7c3aed"
          emissive="#7c3aed"
          emissiveIntensity={2.2}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Image */}
      <mesh
        position={[0, 0, 0.045]}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial
          map={texture ?? undefined}
          roughness={0.1}
          metalness={0}
          toneMapped={false}
        />
      </mesh>
      {/* Close button — HTML overlay */}
      <Html position={[W / 2 - 0.05, H / 2 + 0.05, 0.12]} center>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.25)",
            background: "rgba(15,15,30,0.85)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 18,
            lineHeight: "32px",
            textAlign: "center",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 0 12px rgba(124,58,237,0.6), inset 0 0 6px rgba(124,58,237,0.2)",
            transition: "background 0.15s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(124,58,237,0.85)";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "scale(1.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(15,15,30,0.85)";
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          ✕
        </button>
      </Html>
    </group>
  );
}

function VideoFrame3D({ url, onClose }: { url: string; onClose?: () => void }) {
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(
    null,
  );
  const groupRef = useRef<THREE.Group>(null);
  const vidRef = useRef<HTMLVideoElement | null>(null);

  // Player control state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const vid = document.createElement("video");
    vidRef.current = vid;
    vid.src = url;
    vid.loop = true;
    vid.muted = false;
    vid.playsInline = true;
    vid.crossOrigin = "anonymous";

    vid.addEventListener("play", () => setIsPlaying(true));
    vid.addEventListener("pause", () => setIsPlaying(false));
    vid.addEventListener("loadedmetadata", () =>
      setDuration(vid.duration || 0),
    );
    // timeupdate 可达 ~4–30Hz；每帧 setState 会拖死主线程（返回首页等交互明显卡顿）
    let raf = 0;
    const syncTime = () => {
      raf = 0;
      setCurrentTime(vid.currentTime);
    };
    const onTimeUpdate = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(syncTime);
    };
    vid.addEventListener("timeupdate", onTimeUpdate);

    // Try playing with sound; if autoplay policy blocks it, fall back to muted
    vid.play().catch(() => {
      vid.muted = true;
      setIsMuted(true);
      vid.play().catch(() => {});
    });
    const vt = new THREE.VideoTexture(vid);
    // Defer setState to satisfy Turbopack's "no sync setState in effect body" rule
    const timer = setTimeout(() => setVideoTexture(vt), 0);
    return () => {
      clearTimeout(timer);
      if (raf !== 0) cancelAnimationFrame(raf);
      vid.removeEventListener("timeupdate", onTimeUpdate);
      vid.pause();
      vid.src = "";
      vt.dispose();
      vidRef.current = null;
    };
  }, [url]);

  const togglePlay = () => {
    const vid = vidRef.current;
    if (!vid) return;
    if (vid.paused) vid.play().catch(() => {});
    else vid.pause();
  };
  const toggleMute = () => {
    const vid = vidRef.current;
    if (!vid) return;
    vid.muted = !vid.muted;
    setIsMuted(vid.muted);
  };
  const handleVolume = (v: number) => {
    const vid = vidRef.current;
    if (!vid) return;
    vid.volume = v;
    vid.muted = v === 0;
    setVolume(v);
    setIsMuted(v === 0);
  };
  const handleSeek = (t: number) => {
    const vid = vidRef.current;
    if (!vid) return;
    vid.currentTime = t;
    setCurrentTime(t);
  };
  const handleRate = (r: number) => {
    const vid = vidRef.current;
    if (!vid) return;
    vid.playbackRate = r;
    setPlaybackRate(r);
  };
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60)
      .toString()
      .padStart(2, "0")}`;
  };

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.y =
        0.5 + Math.sin(clock.getElapsedTime() * 0.7) * 0.04;
    }
  });

  if (!videoTexture) return null;

  const W = 5.6,
    H = 3.15; // 16:9
  return (
    <group ref={groupRef} position={[0, 0.5, -1.8]}>
      {/* Ambient glow */}
      <pointLight
        position={[0, 0, 0.8]}
        color="#a78bfa"
        intensity={8}
        distance={8}
      />
      {/* Outer dark frame */}
      <mesh castShadow>
        <boxGeometry args={[W + 0.32, H + 0.32, 0.07]} />
        <meshStandardMaterial
          color="#0f0f1e"
          roughness={0.15}
          metalness={0.95}
        />
      </mesh>
      {/* Neon violet border */}
      <mesh position={[0, 0, 0.036]}>
        <boxGeometry args={[W + 0.14, H + 0.14, 0.016]} />
        <meshStandardMaterial
          color="#7c3aed"
          emissive="#7c3aed"
          emissiveIntensity={2.2}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {/* Video screen — click to toggle play/pause, not close */}
      <mesh position={[0, 0, 0.045]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial
          map={videoTexture}
          roughness={0.1}
          metalness={0}
          toneMapped={false}
        />
      </mesh>
      {/* Close button — HTML overlay */}
      <Html position={[W / 2 - 0.05, H / 2 + 0.05, 0.12]} center>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.25)",
            background: "rgba(15,15,30,0.85)",
            backdropFilter: "blur(8px)",
            color: "#fff",
            fontSize: 18,
            lineHeight: "32px",
            textAlign: "center",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 0 12px rgba(124,58,237,0.6), inset 0 0 6px rgba(124,58,237,0.2)",
            transition: "background 0.15s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(124,58,237,0.85)";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "scale(1.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(15,15,30,0.85)";
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          ✕
        </button>
      </Html>

      {/* Playback controls bar */}
      <Html position={[0, -H / 2 - 0.28, 0.12]} center>
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 520,
            background: "rgba(10,10,24,0.88)",
            backdropFilter: "blur(10px)",
            borderRadius: 12,
            border: "1px solid rgba(124,58,237,0.35)",
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
            userSelect: "none",
          }}
        >
          {/* Progress bar */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => handleSeek(Number(e.target.value))}
            style={{
              width: "100%",
              cursor: "pointer",
              accentColor: "#a78bfa",
              height: 4,
            }}
          />
          {/* Controls row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#fff",
              fontSize: 13,
            }}
          >
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#fff",
                color: "#0f0f1e",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
              }}
            >
              {isPlaying ? "⏸" : "▶"}
            </button>
            {/* Restart */}
            <button
              onClick={() => handleSeek(0)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
              }}
            >
              ↺
            </button>
            {/* Time */}
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
                color: "#ccc",
                minWidth: 80,
              }}
            >
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <div style={{ flex: 1 }} />
            {/* Mute + Volume */}
            <button
              onClick={toggleMute}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
              }}
            >
              {isMuted || volume === 0 ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolume(Number(e.target.value))}
              style={{ width: 72, cursor: "pointer", accentColor: "#a78bfa" }}
            />
            {/* Speed */}
            <select
              value={playbackRate}
              onChange={(e) => handleRate(Number(e.target.value))}
              style={{
                height: 28,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                padding: "0 6px",
                cursor: "pointer",
                fontSize: 12,
                outline: "none",
              }}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <option
                  key={r}
                  value={r}
                  style={{ background: "#1e1b4b", color: "#fff" }}
                >
                  {r}x
                </option>
              ))}
            </select>
          </div>
        </div>
      </Html>
    </group>
  );
}

/** Normalise media paths for the in-canvas player: same-origin API proxy or backend absolute URL. */
function normaliseMediaUrl(url: string): string {
  if (url.startsWith("/storage/outputs/")) {
    const filename = url.replace("/storage/outputs/", "");
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    return `${base}/media/${filename}`;
  }
  // FastAPI 静态路由 /media/<file> 在 Next:dev(3000) 上不可用 → 走磁盘代理
  if (url.startsWith("/media/")) {
    const filename = url.replace(/^\/media\//, "");
    return `/api/media/${filename}`;
  }
  return url;
}

function MediaDisplay3D({
  url,
  onClose,
}: {
  url: string;
  onClose?: () => void;
}) {
  const resolved = normaliseMediaUrl(url);
  const isVideo = /\.(mp4|webm)/i.test(resolved);
  if (isVideo) return <VideoFrame3D url={resolved} onClose={onClose} />;
  return <ImageFrame3D url={resolved} onClose={onClose} />;
}

/* ─────────────────────────────────────────────
   Exported component – absolute inset, z-0
───────────────────────────────────────────── */
export default function OfficeBackground({
  mode = "copy",
  isThinking = false,
  isTalking = false,
  isSummoned = false,
  onCharacterClick,
  mediaUrl,
  onMediaClose,
}: OfficeBackgroundProps = {}) {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, -0.5, 5.2], fov: 45 }}
        shadows
        gl={{ antialias: true, alpha: false }}
        style={{ background: "#0D1B2A" }}
      >
        <Suspense fallback={null}>
          <OfficeScene />
          <WalkingCharacterScene
            mode={mode}
            isThinking={isThinking}
            isTalking={isTalking}
            isSummoned={isSummoned}
            onCharacterClick={onCharacterClick}
            mediaUrl={mediaUrl}
          />
          {mediaUrl && <MediaDisplay3D url={mediaUrl} onClose={onMediaClose} />}
        </Suspense>
      </Canvas>
      {/* Navigation hint */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3 rounded-full bg-black/25 px-4 py-1.5 text-[11px] text-white/70 backdrop-blur-sm">
        <span>WASD 移动</span>
        <span>·</span>
        <span>🖱 左键旋转</span>
        <span>·</span>
        <span>滚轮缩放</span>
      </div>
    </div>
  );
}
