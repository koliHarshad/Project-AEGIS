import React, { useRef, useState, useMemo, useEffect } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

// --- 1. TEXTURE GENERATOR (The "Nebula" Painter) ---
// This creates a random, smoky cloud texture in memory
const generateCloudTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; 
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 1. Base transparent background
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 512, 512);

  // 2. Draw random "Puffs"
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 50 + Math.random() * 100;
    
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    // Core: Solar Orange/Red
    gradient.addColorStop(0, 'rgba(255, 100, 50, 0.8)'); 
    // Edge: Transparent
    gradient.addColorStop(1, 'rgba(255, 50, 0, 0)'); 
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
};

// --- HELPER: SUN POSITION ---
const getSunPosition = (date) => {
  const now = date || new Date();
  const hours = now.getUTCHours() + (now.getUTCMinutes() / 60);
  const angle = ((hours - 12) * 15) * (Math.PI / 180); 
  const distance = 400; 
  return {
    x: Math.sin(angle) * distance,
    y: 0, 
    z: Math.cos(angle) * distance
  };
};

function App() {
  const globeEl = useRef();
  const [simulationTime, setSimulationTime] = useState(new Date());

  // 1. GENERATE CLOUD TEXTURES (Once)
  const cloudMap2 = useMemo(() => generateCloudTexture(), []);
  const cloudMap3 = useMemo(() => generateCloudTexture(), []);

  // 2. EARTH MATERIAL
  const earthMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0, 
      metalness: 0.0,
      emissive: 0x000000
    });
  }, []);

  // 3. DATA LAYERS (3 Layers of Fog + 1 Shield)
  const layerData = useMemo(() => [
    { type: 'shield' }, 
 
    { type: 'nebula', radius: 175, map: cloudMap2, speed: 0.002, opacity: 0.3 }, // Reverse spin
    { type: 'nebula', radius: 200, map: cloudMap3, speed: 0.002, opacity: 0.21 },
  ], [cloudMap2, cloudMap3]);

  // 4. SCENE SETUP
  const handleGlobeReady = () => {
    if (!globeEl.current) return;
    try {
      const scene = globeEl.current.scene();
      
      // Cleanup Ghosts
      scene.traverse((obj) => {
        if (obj.isLight && obj.name !== "sun-light" && obj.name !== "ambient-light") {
          obj.intensity = 0; obj.visible = false;
        }
      });

      // Sun
      let sunLight = scene.getObjectByName("sun-light");
      if (!sunLight) {
        sunLight = new THREE.DirectionalLight(0xffffff, 4.5);
        sunLight.name = "sun-light";
        scene.add(sunLight);
      }
      const pos = getSunPosition(new Date());
      sunLight.position.set(pos.x, pos.y, pos.z);

      // Ambient
      let ambientLight = scene.getObjectByName("ambient-light");
      if (!ambientLight) {
        ambientLight = new THREE.AmbientLight(0xffffff, 0.4); 
        ambientLight.name = "ambient-light";
        scene.add(ambientLight);
      }
    } catch (e) { console.error(e); }
  };

  // UPDATE LOOP
  useEffect(() => {
    if (!globeEl.current) return;
    const scene = globeEl.current.scene();
    const sunLight = scene.getObjectByName("sun-light");
    if (sunLight) {
      const newPos = getSunPosition(simulationTime);
      sunLight.position.set(newPos.x, newPos.y, newPos.z);
    }
  }, [simulationTime]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <Globe
        ref={globeEl}
        onGlobeReady={handleGlobeReady}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        atmosphereColor="#3a228a"
        atmosphereAltitude={0.2}
        globeMaterial={earthMaterial}

        customLayerData={layerData} 

        // A. BUILD SHAPES
        customThreeObject={(d) => {
          
          // --- SHIELD (The Boundary) ---
          if (d.type === 'shield') {
            const geometry = new THREE.SphereGeometry(130, 64, 64);
            // Morph shield to have a tail
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
               const z = positions.getZ(i);
               if (z < 0) positions.setZ(i, z * 3.0); // Stretch tail
            }
            geometry.computeVertexNormals();
            
            return new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
              color: 0x44aaff,
              transparent: true,
              opacity: 0.3, // Faint
              side: THREE.DoubleSide,
              depthWrite: false, 
            }));
          }

          // --- NEBULA (The Storm) ---
          if (d.type === 'nebula') {
            // Use a "Hemisphere" geometry so it only covers the sun side
            // Radius, WidthSeg, HeightSeg, PhiStart, PhiLength (PI = 180 deg / Half Sphere)
            const geometry = new THREE.SphereGeometry(d.radius, 64, 64, 0, Math.PI * 2, 0, Math.PI / 3);
            
            const material = new THREE.MeshBasicMaterial({
              map: d.map,           // Use our generated cloud texture
              color: 0xffaa00,      // Solar tint
              transparent: true,
              opacity: d.opacity,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending, // Glow effect
              depthWrite: false,    // Soft blending
            });
            
            const mesh = new THREE.Mesh(geometry, material);
            // Rotate geometry so the "Cap" faces forward initially
            mesh.geometry.rotateX(-Math.PI / 2); 
            return mesh;
          }
        }}

        // B. ANIMATE
        customThreeObjectUpdate={(obj, d) => {
          const sunPos = getSunPosition(simulationTime);

          if (d.type === 'shield') {
            obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
          }

          if (d.type === 'nebula') {
            // 1. Always face the sun
            obj.lookAt(-sunPos.x, -sunPos.y, -sunPos.z);
            
            // 2. Spin locally on Z axis (Turbulence)
            // We use the time + speed to rotate it continuously
            obj.rotateZ(d.speed); 
          }
        }}
      />

      {/* HUD */}
      <div className="absolute z-10 top-0 left-0 w-full p-6 pointer-events-none flex justify-between">
        <header className="border-l-4 border-cyan-500 pl-4 bg-black/30 backdrop-blur-sm pr-6">
          <h1 className="text-4xl text-white font-bold tracking-widest font-mono drop-shadow-md">SOLAR SENTINEL</h1>
          <p className="text-cyan-400 text-sm font-mono tracking-widest">MAGNETOSPHERE INTEGRITY: 100%</p>
        </header>
      </div>
      
      {/* SLIDER */}
      <div className="absolute z-10 bottom-0 w-full p-6 bg-gradient-to-t from-black to-transparent">
        <div className="flex items-center gap-4">
          <label className="text-cyan-400 font-mono text-xs">SIMULATION TIME (UTC)</label>
          <input 
            type="range" min="0" max="23" step="0.1"
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            onChange={(e) => {
               const newDate = new Date();
               newDate.setUTCHours(parseFloat(e.target.value));
               setSimulationTime(newDate);
            }}
          />
        </div>
      </div>

    </div>
  );
}

export default App;