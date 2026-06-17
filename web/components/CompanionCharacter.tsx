"use client";

import { ContactShadows, Environment, Float } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type AgentMode = "script" | "copy" | "media" | "trend" | "review";

type CompanionCharacterProps = {
  mode: AgentMode;
  name: string;
  role: string;
  isOnline: boolean;
  isThinking?: boolean;
  isTalking?: boolean;
  isSummoned?: boolean;
};

export type ModeColors = {
  body: string;
  glow: string;
  accent: string;
};

export const MODE_COLORS: Record<AgentMode, ModeColors> = {
  script: { body: "#3b82f6", glow: "#60a5fa", accent: "#bfdbfe" },
  copy: { body: "#a855f7", glow: "#c084fc", accent: "#e9d5ff" },
  media: { body: "#f97316", glow: "#fb923c", accent: "#fed7aa" },
  trend: { body: "#22c55e", glow: "#4ade80", accent: "#bbf7d0" },
  review: { body: "#ef4444", glow: "#f87171", accent: "#fecaca" },
};

/* ── Animated eyelid: closes when blinkRef=1 ── */
function EyeLid({ blinkRef }: { blinkRef: React.MutableRefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (!meshRef.current) return;
    const target = blinkRef.current === 1 ? 1 : 0;
    const current = meshRef.current.scale.y;
    meshRef.current.scale.y = THREE.MathUtils.lerp(current, target, 0.25);
    meshRef.current.position.y = THREE.MathUtils.lerp(
      0.06,
      0.072,
      meshRef.current.scale.y,
    );
  });
  return (
    <mesh ref={meshRef} position={[0, 0.06, 0.01]} scale={[1.05, 0, 0.6]}>
      <sphereGeometry args={[0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
      <meshStandardMaterial
        color="#f8faff"
        side={THREE.FrontSide}
        roughness={0.3}
      />
    </mesh>
  );
}

export function CompanionModel({
  isThinking,
  isTalking,
  isSummoned,
  isDancing,
  isWalking,
  colors,
  onClick,
}: {
  isThinking?: boolean;
  isTalking?: boolean;
  isSummoned?: boolean;
  isDancing?: boolean;
  isWalking?: boolean;
  colors: ModeColors;
  onClick?: () => void;
}) {
  const headRef = useRef<THREE.Group>(null);
  const propRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Mesh>(null);
  const rightArmRef = useRef<THREE.Mesh>(null);
  const leftLegRef = useRef<THREE.Mesh>(null);
  const rightLegRef = useRef<THREE.Mesh>(null);
  const hovered = true;
  const [spinning, setSpinning] = useState(0);
  // Blink: 0=open, 1=shut
  const blinkRef = useRef(0);
  const nextBlinkRef = useRef(2.5);

  useEffect(() => {
    // Random blink every 2-5s via a clock-independent timer
    let cancelled = false;
    const scheduleNext = () => {
      if (cancelled) return;
      const delay = 2500 + Math.random() * 3000;
      setTimeout(() => {
        if (cancelled) return;
        // Close eyes
        blinkRef.current = 1;
        setTimeout(() => {
          if (cancelled) return;
          blinkRef.current = 0;
          scheduleNext();
        }, 120);
      }, delay);
    };
    scheduleNext();
    return () => {
      cancelled = true;
    };
  }, []);

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    // ── Body animation: dance / walk / idle ──
    if (isDancing && groupRef.current) {
      // Body bounce up-down (double-time beat)
      groupRef.current.position.y = Math.abs(Math.sin(elapsed * 5)) * 0.18;
      // Side-to-side sway
      groupRef.current.rotation.z = Math.sin(elapsed * 2.5) * 0.18;
      // Gentle spin on Z rhythm
      groupRef.current.rotation.y = Math.sin(elapsed * 1.5) * 0.35;
    } else if (isWalking && groupRef.current) {
      const phase = elapsed * 5; // walk cycle frequency
      const halfSwing = Math.sin(phase);
      // Smooth double-peak vertical bob (sin² = always positive, smooth at contacts)
      const bob = Math.pow(Math.sin(phase), 2) * 0.055;
      groupRef.current.position.y = THREE.MathUtils.lerp(
        groupRef.current.position.y,
        bob,
        0.28,
      );
      // Body roll — weight shifts over support leg
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        -halfSwing * 0.055,
        0.18,
      );
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        0,
        0.12,
      );
    } else if (groupRef.current) {
      groupRef.current.position.y = THREE.MathUtils.lerp(
        groupRef.current.position.y,
        isSummoned ? 0.08 : 0,
        0.08,
      );
      groupRef.current.rotation.z = THREE.MathUtils.lerp(
        groupRef.current.rotation.z,
        isSummoned ? Math.sin(elapsed * 2.5) * 0.04 : 0,
        0.08,
      );
    }

    // ── Arms: dance rotation / walk position swing / idle ──
    if (leftArmRef.current && rightArmRef.current) {
      if (isDancing) {
        const swing = Math.sin(elapsed * 5) * 0.7;
        leftArmRef.current.rotation.z = THREE.MathUtils.lerp(
          leftArmRef.current.rotation.z,
          swing,
          0.15,
        );
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.z,
          -swing,
          0.15,
        );
      } else if (isWalking) {
        const halfSwing = Math.sin(elapsed * 5);
        // Arms swing forward/back via position.z (rotation does nothing on spheres)
        leftArmRef.current.position.z = THREE.MathUtils.lerp(
          leftArmRef.current.position.z,
          halfSwing * 0.16,
          0.22,
        );
        rightArmRef.current.position.z = THREE.MathUtils.lerp(
          rightArmRef.current.position.z,
          -halfSwing * 0.16,
          0.22,
        );
      } else {
        // Lerp back to neutral
        leftArmRef.current.position.z = THREE.MathUtils.lerp(
          leftArmRef.current.position.z,
          0,
          0.12,
        );
        rightArmRef.current.position.z = THREE.MathUtils.lerp(
          rightArmRef.current.position.z,
          0,
          0.12,
        );
      }
    }

    // ── Legs: walk position swing / neutral ──
    if (leftLegRef.current && rightLegRef.current) {
      if (isWalking && !isDancing) {
        const halfSwing = Math.sin(elapsed * 5);
        // Opposite phase to same-side arm = opposite to opposite arm
        leftLegRef.current.position.z = THREE.MathUtils.lerp(
          leftLegRef.current.position.z,
          -halfSwing * 0.1,
          0.22,
        );
        rightLegRef.current.position.z = THREE.MathUtils.lerp(
          rightLegRef.current.position.z,
          halfSwing * 0.1,
          0.22,
        );
      } else {
        leftLegRef.current.position.z = THREE.MathUtils.lerp(
          leftLegRef.current.position.z,
          0,
          0.12,
        );
        rightLegRef.current.position.z = THREE.MathUtils.lerp(
          rightLegRef.current.position.z,
          0,
          0.12,
        );
      }
    }

    if (headRef.current) {
      headRef.current.position.y = Math.sin(elapsed * 1.5) * 0.05 + 0.6;
      if (isTalking) {
        headRef.current.position.y += Math.sin(elapsed * 15) * 0.02;
      }
      headRef.current.rotation.y = THREE.MathUtils.lerp(
        headRef.current.rotation.y,
        state.pointer.x * 0.35,
        0.08,
      );
      headRef.current.rotation.x = THREE.MathUtils.lerp(
        headRef.current.rotation.x,
        -state.pointer.y * 0.18,
        0.08,
      );
    }

    if (groupRef.current && spinning > 0) {
      groupRef.current.rotation.y += 0.22;
      if (groupRef.current.rotation.y >= spinning * Math.PI * 2) {
        setSpinning(0);
        groupRef.current.rotation.y = 0;
      }
    }

    if (propRef.current && (isThinking || isSummoned)) {
      propRef.current.rotation.y += isThinking ? 1.2 : 0.45;
    }

    if (ringRef.current) {
      ringRef.current.rotation.z += 0.01;
      const pulse = 1 + Math.sin(elapsed * (isThinking ? 6 : 3)) * 0.05;
      ringRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group
      ref={groupRef}
      onClick={() => {
        setSpinning((previous) => previous + 1);
        onClick?.();
      }}
    >
      <mesh
        ref={ringRef}
        position={[0, -0.62, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[0.48, 0.68, 64]} />
        <meshStandardMaterial
          color={colors.glow}
          emissive={colors.glow}
          emissiveIntensity={isThinking ? 1.1 : 0.6}
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshStandardMaterial
          color={colors.body}
          roughness={0.28}
          metalness={0.1}
          emissive={hovered ? colors.glow : "#000000"}
          emissiveIntensity={hovered ? 0.28 : 0.05}
        />
      </mesh>

      <mesh position={[0, -0.05, 0.08]} scale={[1, 1, 1.05]}>
        <sphereGeometry args={[0.335, 32, 32]} />
        <meshStandardMaterial color="#ffffff" roughness={0.45} />
      </mesh>

      {/* Pocket arc */}
      <mesh position={[0, -0.08, 0.4]} rotation={[0, 0, 0]}>
        <torusGeometry args={[0.16, 0.005, 8, 32, Math.PI]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
      </mesh>

      {/* Pocket top line */}
      <mesh position={[0, -0.08, 0.4]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.32, 0.01, 0.015]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.5} />
      </mesh>

      <group ref={headRef}>
        <mesh castShadow>
          <sphereGeometry args={[0.45, 32, 32]} />
          <meshStandardMaterial
            color={colors.body}
            roughness={0.3}
            metalness={0.1}
            emissive={hovered ? colors.glow : "#000000"}
            emissiveIntensity={hovered ? 0.34 : 0.08}
          />
        </mesh>

        {/* Face white patch - Doraemon style, covers lower front */}
        <mesh position={[0, -0.06, 0.08]} scale={[1, 0.95, 1.05]}>
          <sphereGeometry args={[0.41, 32, 32]} />
          <meshStandardMaterial color="#ffffff" roughness={0.6} />
        </mesh>

        {/* Eyes — large Doraemon-style white ovals, touching in the middle */}
        {([-0.105, 0.105] as number[]).map((x, i) => {
          // Dynamic eye expressions per state
          let pupilNode;
          if (isDancing) {
            // Happy ^ ^ eyes
            pupilNode = (
              <group position={[-x * 0.15, 0.015, 0.052]}>
                <mesh>
                  <torusGeometry args={[0.026, 0.007, 8, 20, Math.PI]} />
                  <meshStandardMaterial color="#000000" roughness={0.1} />
                </mesh>
              </group>
            );
          } else if (isThinking) {
            // Looking up and away
            pupilNode = (
              <group position={[x > 0 ? 0.035 : 0.055, 0.045, 0.043]}>
                <mesh>
                  <sphereGeometry args={[0.018, 16, 16]} />
                  <meshStandardMaterial color="#000000" roughness={0.1} />
                </mesh>
              </group>
            );
          } else if (isSummoned) {
            // Surprised/Excited: Huge pupil with manga glints
            pupilNode = (
              <group position={[-x * 0.12, 0, 0.05]}>
                <mesh>
                  <sphereGeometry args={[0.035, 16, 16]} />
                  <meshStandardMaterial color="#000000" roughness={0.1} />
                </mesh>
                <mesh position={[0.012, 0.015, 0.032]}>
                  <sphereGeometry args={[0.012, 8, 8]} />
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive="#ffffff"
                    emissiveIntensity={2}
                  />
                </mesh>
                <mesh position={[-0.015, -0.012, 0.032]}>
                  <sphereGeometry args={[0.006, 8, 8]} />
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive="#ffffff"
                    emissiveIntensity={2}
                  />
                </mesh>
              </group>
            );
          } else if (isTalking) {
            // Looking slightly cross-eyed inward (more animated/focused)
            pupilNode = (
              <group position={[-x * 0.35, -0.01, 0.048]}>
                <mesh>
                  <sphereGeometry args={[0.024, 16, 16]} />
                  <meshStandardMaterial color="#000000" roughness={0.1} />
                </mesh>
                <mesh position={[0.008, 0.015, 0.022]}>
                  <sphereGeometry args={[0.007, 8, 8]} />
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive="#ffffff"
                    emissiveIntensity={2}
                  />
                </mesh>
              </group>
            );
          } else {
            // Neutral
            pupilNode = (
              <group position={[-x * 0.15, 0, 0.048]}>
                <mesh>
                  <sphereGeometry args={[0.024, 16, 16]} />
                  <meshStandardMaterial color="#000000" roughness={0.1} />
                </mesh>
                <mesh position={[0.008, 0.015, 0.022]}>
                  <sphereGeometry args={[0.007, 8, 8]} />
                  <meshStandardMaterial
                    color="#ffffff"
                    emissive="#ffffff"
                    emissiveIntensity={2}
                  />
                </mesh>
              </group>
            );
          }

          return (
            <group key={i} position={[x, 0.15, 0.395]}>
              {/* White oval eye */}
              <mesh scale={[1, 1.3, 0.45]}>
                <sphereGeometry args={[0.105, 24, 24]} />
                <meshStandardMaterial color="#f8faff" roughness={0.2} />
              </mesh>

              {pupilNode}

              {/* Eyelid blink - only blink naturally if not using special eye shapes */}
              {!isDancing && !isThinking && <EyeLid blinkRef={blinkRef} />}
            </group>
          );
        })}

        {/* Red nose — big round Doraemon nose */}
        <mesh position={[0, -0.02, 0.47]}>
          <sphereGeometry args={[0.055, 24, 24]} />
          <meshStandardMaterial
            color="#e8192c"
            roughness={0.3}
            emissive="#cc0000"
            emissiveIntensity={0.2}
          />
        </mesh>

        {/* Philtrum (vertical line under nose) */}
        <mesh position={[0, -0.07, 0.49]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.003, 0.003, 0.08, 8]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>

        {/* Whiskers — 3 per side, classic Doraemon */}
        {([-1, 1] as number[]).map((side, si) =>
          ([-0.06, 0, 0.06] as number[]).map((yOff, wi) => (
            <mesh
              key={`w${si}${wi}`}
              position={[side * 0.2, -0.07 + yOff, 0.42]}
              rotation={[0, 0, side * 0.05]}
            >
              <boxGeometry args={[0.19, 0.006, 0.003]} />
              <meshStandardMaterial color="#111122" roughness={0.9} />
            </mesh>
          )),
        )}

        {/* Mouth — Doraemon's iconic wide line + expressions */}
        {isTalking ? (
          /* Talking: big open mouth with tongue */
          <group position={[0, -0.16, 0.41]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.115, 0.115, 0.018, 28]} />
              <meshStandardMaterial color="#1a0000" />
            </mesh>
            <mesh position={[0, -0.03, 0.005]} rotation={[0.4, 0, 0]}>
              <sphereGeometry args={[0.068, 12, 8]} />
              <meshStandardMaterial color="#e05070" roughness={0.5} />
            </mesh>
          </group>
        ) : isThinking ? (
          /* Thinking: flat tilted line */
          <mesh position={[0.04, -0.165, 0.435]} rotation={[0, 0, 0.18]}>
            <boxGeometry args={[0.15, 0.011, 0.006]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
        ) : isDancing ? (
          /* Dancing: huge happy arc + teeth */
          <group position={[0, -0.15, 0.415]}>
            <mesh rotation={[Math.PI, 0, 0]}>
              <torusGeometry args={[0.105, 0.013, 8, 30, Math.PI]} />
              <meshStandardMaterial color="#1a0000" roughness={0.5} />
            </mesh>
            <mesh position={[0, 0.026, 0.01]} rotation={[0.25, 0, 0]}>
              <boxGeometry args={[0.15, 0.024, 0.01]} />
              <meshStandardMaterial color="#f8f8f8" />
            </mesh>
          </group>
        ) : isSummoned ? (
          /* Summoned/surprised: wide O */
          <mesh position={[0, -0.16, 0.425]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.078, 0.078, 0.014, 22]} />
            <meshStandardMaterial color="#1a0000" />
          </mesh>
        ) : (
          /* Neutral: Doraemon's wide upward arc smile */
          <group position={[0, -0.155, 0.425]}>
            <mesh rotation={[Math.PI, 0, 0]}>
              <torusGeometry args={[0.09, 0.011, 8, 30, Math.PI]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
            </mesh>
          </group>
        )}

        {/* Cheek circles — always shown, brighter when happy */}
        {([-0.27, 0.27] as number[]).map((x, i) => (
          <mesh key={i} position={[x, -0.09, 0.36]}>
            <sphereGeometry args={[0.07, 10, 10]} />
            <meshStandardMaterial
              color="#ffaaaa"
              transparent
              opacity={isDancing || isTalking ? 0.65 : 0.32}
              roughness={1}
            />
          </mesh>
        ))}

        {(isThinking || isSummoned) && (
          <group position={[0, 0.45, 0]}>
            <mesh>
              <cylinderGeometry args={[0.01, 0.01, 0.15]} />
              <meshStandardMaterial color="#92400e" />
            </mesh>
            <mesh ref={propRef} position={[0, 0.07, 0]}>
              <boxGeometry args={[0.6, 0.02, 0.06]} />
              <meshStandardMaterial
                color={colors.accent}
                roughness={0.3}
                metalness={0.5}
              />
            </mesh>
          </group>
        )}
      </group>

      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 32]} />
        <meshStandardMaterial color="#dc2626" />
        <mesh position={[0, -0.02, 0.32]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial
            color="#fbbf24"
            metalness={0.6}
            roughness={0.2}
          />
        </mesh>
        {/* Bell line */}
        <mesh position={[0, -0.02, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.061, 0.061, 0.005, 16]} />
          <meshStandardMaterial color="#b45309" />
        </mesh>
      </mesh>

      {/* Arms: Blue arm, white hand */}
      <group position={[-0.32, 0.1, 0]} ref={leftArmRef}>
        <mesh position={[-0.05, -0.06, 0]} rotation={[0, 0, -Math.PI / 8]}>
          <cylinderGeometry args={[0.045, 0.055, 0.15, 16]} />
          <meshStandardMaterial color={colors.body} />
        </mesh>
        <mesh position={[-0.08, -0.13, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>
      <group position={[0.32, 0.1, 0]} ref={rightArmRef}>
        <mesh position={[0.05, -0.06, 0]} rotation={[0, 0, Math.PI / 8]}>
          <cylinderGeometry args={[0.045, 0.055, 0.15, 16]} />
          <meshStandardMaterial color={colors.body} />
        </mesh>
        <mesh position={[0.08, -0.13, 0]}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* Legs */}
      <mesh
        position={[-0.15, -0.35, 0.05]}
        scale={[1, 0.6, 1.2]}
        ref={leftLegRef}
      >
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh
        position={[0.15, -0.35, 0.05]}
        scale={[1, 0.6, 1.2]}
        ref={rightLegRef}
      >
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

export function CompanionCharacter({
  mode,
  name,
  role,
  isOnline,
  isThinking,
  isTalking,
  isSummoned,
}: CompanionCharacterProps) {
  const colors = useMemo(() => MODE_COLORS[mode], [mode]);

  return (
    <div
      className={`relative flex flex-col items-center select-none ${!isOnline ? "opacity-40 grayscale" : ""}`}
    >
      <div className="h-[28rem] w-[24rem] cursor-pointer">
        <Canvas
          shadows
          camera={{ position: [0, 0.6, 3.6], fov: 34 }}
          dpr={[1, 2]}
        >
          <ambientLight intensity={0.95} />
          <pointLight position={[10, 10, 10]} intensity={1.6} castShadow />
          <pointLight
            position={[-8, 6, 4]}
            intensity={0.65}
            color={colors.glow}
          />
          <Suspense fallback={null}>
            <Float
              speed={isSummoned ? 3.4 : 2.2}
              rotationIntensity={isSummoned ? 0.65 : 0.15}
              floatIntensity={isSummoned ? 0.55 : 0.25}
            >
              <CompanionModel
                colors={colors}
                isThinking={isThinking}
                isTalking={isTalking}
                isSummoned={isSummoned}
              />
            </Float>
            <ContactShadows
              resolution={1024}
              scale={11}
              blur={2.8}
              opacity={0.5}
              far={10}
              color="#000000"
              position={[0, -0.88, 0]}
            />
            <Environment preset="city" />
          </Suspense>
        </Canvas>
      </div>

      <div className="pointer-events-none -mt-12 flex flex-col items-center">
        <motion.div
          className="min-w-[180px] rounded-full border border-white/10 bg-slate-950/70 px-6 py-3 text-center shadow-[0_18px_60px_rgba(15,23,42,0.35)] backdrop-blur-3xl"
          animate={{
            scale: isThinking ? [1, 1.03, 1] : 1,
            borderColor: isThinking
              ? [
                  "rgba(255,255,255,0.12)",
                  colors.glow,
                  "rgba(255,255,255,0.12)",
                ]
              : "rgba(255,255,255,0.12)",
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <div className="flex items-center justify-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-emerald-400 shadow-[0_0_14px_#34d399]" : "bg-slate-500"}`}
            />
            <span className="text-xs font-black uppercase tracking-[0.32em] text-white">
              {name}
            </span>
          </div>
          <div className="mt-2 border-t border-white/10 pt-2 text-[10px] font-bold tracking-[0.28em] text-slate-300">
            {role}
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {isThinking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 10 }}
            className="absolute top-2 rounded-full bg-white/10 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.32em] text-white shadow-[0_0_32px_rgba(255,255,255,0.18)] backdrop-blur-2xl"
          >
            Role Syncing...
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
