"use client";

import React, { useMemo, useRef, Suspense, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, Cylinder, Box, Float, Environment, ContactShadows, Text } from "@react-three/drei";
import * as THREE from "three";
import { motion, AnimatePresence } from "framer-motion";

interface GameCharacterProps {
  type?: "master" | "node" | "expert";
  name: string;
  role: string;
  isOnline: boolean;
  isThinking?: boolean;
  isTalking?: boolean;
  isDancing?: boolean;
}

/**
 * Professional Three.js Doraemon Model with Deep Interaction
 */
const DoraemonModel = ({ type, isThinking, isTalking, isDancing, colors }: { 
  type: string, 
  isThinking?: boolean, 
  isTalking?: boolean,
  isDancing?: boolean,
  colors: any 
}) => {
  const headRef = useRef<THREE.Group>(null);
  const propRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  
  const [hovered, setHover] = useState(false);
  const [spinning, setSpinning] = useState(0); // Use a counter to trigger multiple spins

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    
    // Look-at Mouse Interaction (Smooth LERP)
    if (headRef.current) {
      // Base floating position
      headRef.current.position.y = Math.sin(t * 1.5) * 0.05 + 0.6;
      if (isTalking) {
        headRef.current.position.y += Math.sin(t * 15) * 0.02;
      }

      // Mouse Follow Rotation (Look-at)
      const targetRotationY = state.pointer.x * 0.4;
      const targetRotationX = -state.pointer.y * 0.2;
      headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetRotationY, 0.1);
      headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetRotationX, 0.1);
    }
    
    // Spinning Animation when clicked
    if (groupRef.current && spinning > 0) {
      groupRef.current.rotation.y += 0.2;
      if (groupRef.current.rotation.y >= spinning * Math.PI * 2) {
        setSpinning(0);
        groupRef.current.rotation.y = 0;
      }
    }

    // Propeller Spin
    if (propRef.current && (type === "master" || isThinking || isDancing)) {
      propRef.current.rotation.y += (isThinking || isDancing) ? 1.2 : 0.3;
    }

    // Dance Logic: Complex Rhythmic Motion
    if (groupRef.current && isDancing) {
      const beat = (t * 10) % (Math.PI * 2);
      groupRef.current.position.y += Math.sin(beat) * 0.15;
      groupRef.current.rotation.z = Math.sin(t * 8) * 0.2;
      groupRef.current.scale.setScalar(1 + Math.sin(t * 12) * 0.05);
    } else if (groupRef.current) {
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.1);
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, 0.1);
      groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, 1, 0.1));
    }
  });

  const handlePointerOver = () => setHover(true);
  const handlePointerOut = () => setHover(false);
  const handleClick = () => setSpinning(prev => prev + 1);

  return (
    <group 
      ref={groupRef} 
      onPointerOver={handlePointerOver} 
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      {/* Body */}
      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshStandardMaterial 
          color={colors.body} 
          roughness={0.3} 
          metalness={0.1} 
          emissive={hovered ? colors.body : "#000000"}
          emissiveIntensity={hovered ? 0.2 : 0}
        />
      </mesh>
      
      {/* Stomach (White) */}
      <mesh position={[0, -0.05, 0.1]} scale={[1, 0.9, 1]}>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>

      {/* Pocket */}
      <mesh position={[0, -0.1, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.02, 32]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.5} />
      </mesh>

      {/* Head Group */}
      <group ref={headRef}>
        {/* Blue Sphere */}
        <mesh castShadow>
          <sphereGeometry args={[0.45, 32, 32]} />
          <meshStandardMaterial 
            color={colors.body} 
            roughness={0.3} 
            metalness={0.1}
            emissive={hovered ? colors.body : "#000000"}
            emissiveIntensity={hovered ? 0.3 : 0}
          />
        </mesh>

        {/* White Face Mask */}
        <mesh position={[0, -0.05, 0.1]} scale={[1, 0.9, 1.05]}>
          <sphereGeometry args={[0.38, 32, 32]} />
          <meshStandardMaterial color="#ffffff" roughness={0.5} />
        </mesh>

        {/* Eyes */}
        <group position={[0, 0.1, 0.4]}>
          <mesh position={[-0.08, 0, 0]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="#ffffff" />
            <mesh position={[0, 0, 0.06]}>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshStandardMaterial color="#000000" />
            </mesh>
          </mesh>
          <mesh position={[0.08, 0, 0]}>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshStandardMaterial color="#ffffff" />
            <mesh position={[0, 0, 0.06]}>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshStandardMaterial color="#000000" />
            </mesh>
          </mesh>
        </group>

        {/* Red Nose */}
        <mesh position={[0, 0, 0.48]}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshStandardMaterial color="#ef4444" roughness={0.1} />
        </mesh>

        {/* Mouth (Simple Line and Open when talking) */}
        {isTalking ? (
           <mesh position={[0, -0.12, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
             <boxGeometry args={[0.18, 0.02, 0.08]} />
             <meshStandardMaterial color="#ef4444" />
           </mesh>
        ) : (
           <mesh position={[0, -0.12, 0.45]}>
             <boxGeometry args={[0.22, 0.01, 0.01]} />
             <meshStandardMaterial color="#334155" />
           </mesh>
        )}

        {/* Bamboo Copter (Propeller) */}
        {(type === "master" || isThinking) && (
          <group position={[0, 0.45, 0]}>
            <mesh>
              <cylinderGeometry args={[0.01, 0.01, 0.15]} />
              <meshStandardMaterial color="#92400e" />
            </mesh>
            <mesh ref={propRef} position={[0, 0.07, 0]}>
              <boxGeometry args={[0.6, 0.02, 0.06]} />
              <meshStandardMaterial color="#fbbf24" roughness={0.3} metalness={0.5} />
            </mesh>
          </group>
        )}
      </group>

      {/* Collar & Bell */}
      <mesh position={[0, 0.2, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 32]} />
        <meshStandardMaterial color="#dc2626" />
        <mesh position={[0, -0.02, 0.32]}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshStandardMaterial color="#facc15" metalness={0.8} roughness={0.2} />
        </mesh>
      </mesh>

      {/* Hands */}
      <mesh position={[-0.45, 0.1, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.45, 0.1, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>

      {/* Feet */}
      <mesh position={[-0.15, -0.35, 0.05]} scale={[1, 0.6, 1.2]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0.15, -0.35, 0.05]} scale={[1, 0.6, 1.2]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    </group>
  );
};

export const GameCharacter: React.FC<GameCharacterProps> = ({
  type = "node",
  name,
  role,
  isOnline,
  isThinking,
  isTalking,
  isDancing = false,
}) => {
  const colors = useMemo(() => {
    let baseColor = "#3b82f6"; // Blue
    if (type === "node") baseColor = "#fbbf24"; // Yellow
    if (type === "expert") baseColor = "#ef4444"; // Red
    
    return {
      body: baseColor,
      glow: baseColor + "66"
    };
  }, [type]);

  return (
    <div className={`relative flex flex-col items-center select-none ${!isOnline ? "opacity-40 grayscale" : ""}`}>
      
      {/* Three.js Canvas */}
      <div className="w-56 h-56 -mb-8 cursor-pointer">
        <Canvas shadows camera={{ position: [0, 0.5, 3.5], fov: 35 }} dpr={[1, 2]}>
          <AmbientLight intensity={0.9} />
          <PointLight position={[10, 10, 10]} intensity={1.5} castShadow />
          <Suspense fallback={null}>
            <Float speed={isDancing ? 4 : 2.5} rotationIntensity={isDancing ? 1 : 0.2} floatIntensity={isDancing ? 1 : 0.3}>
              <DoraemonModel type={type} isThinking={isThinking} isTalking={isTalking} isDancing={isDancing} colors={colors} />
            </Float>
            <ContactShadows resolution={1024} scale={10} blur={2.5} opacity={0.5} far={10} color="#000000" position={[0, -0.8, 0]} />
            <Environment preset="city" />
          </Suspense>
        </Canvas>
      </div>

      {/* Status Info Board (2D Overlay) */}
      <div className="flex flex-col items-center pointer-events-none mb-4">
        <motion.div 
          className="bg-slate-900/80 backdrop-blur-3xl px-6 py-2.5 rounded-full border border-white/10 shadow-2xl flex flex-col items-center min-w-[140px]"
          animate={{ 
            scale: isThinking ? [1, 1.03, 1] : 1,
            borderColor: isThinking ? ["rgba(255,255,255,0.1)", "rgba(34,211,238,0.5)", "rgba(255,255,255,0.1)"] : "rgba(255,255,255,0.1)"
          }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-400 shadow-[0_0_12px_#10b981]" : "bg-slate-500"}`}></span>
            <span className="text-[12px] font-black text-white tracking-[0.25em] uppercase">
              {name}
            </span>
          </div>
          <div className="text-[9px] text-slate-400 font-bold tracking-[0.4em] mt-1.5 border-t border-white/10 pt-1.5 w-full text-center">
            {role.split(" ").slice(0, 2).join(" ")}
          </div>
        </motion.div>
      </div>

      {/* Thinking Indicator */}
      {isThinking && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.8, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="absolute top-0 bg-cyan-500/90 text-white text-[9px] px-4 py-1.5 rounded-full font-black shadow-[0_0_30px_rgba(34,211,238,0.6)] uppercase tracking-[0.3em] overflow-hidden"
        >
          <div className="relative z-10">Neural Scanning...</div>
          <motion.div 
            className="absolute inset-0 bg-white/20"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          />
        </motion.div>
      )}
    </div>
  );
};

// Internal components to avoid confusion with react-three/fiber built-ins
const AmbientLight = (props: any) => <ambientLight {...props} />;
const PointLight = (props: any) => <pointLight {...props} />;
