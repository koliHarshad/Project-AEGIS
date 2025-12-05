import React, { useRef, useState, useMemo, useEffect } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

// ==========================================
// SECTION 1: UTILITY TOOLS (Outside Component)
// ==========================================

/**
 * 1. TEXTURE PAINTER
 * Creates a "smoky" dot texture in memory.
 * We use this for the particles so they look like soft gas, not squares.
 */
const generateCloudTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256; // Low res is fine for clouds
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 256, 256);

  // Draw 20 random fuzzy puffs
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const radius = 20 + Math.random() * 60;
    
    // Gradient: Orange Center -> Transparent Edge
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255, 100, 50, 1.0)'); 
    gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
};

const generateparticleTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 180, 50, 1)'); 
  gradient.addColorStop(1, 'rgba(255, 100, 0, 0)'); 
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);

  return new THREE.CanvasTexture(canvas);
}
/**
 * 2. ASTROPHYSICS ENGINE
 * Calculates where the Sun is based on the time of day.
 * Distance is fixed at 400 units so it sits outside the Shield.
 */
const getSunPosition = (date) => {
  const now = date || new Date();
  // Convert time to angle (12:00 UTC = 0 degrees)
  const hours = now.getUTCHours() + (now.getUTCMinutes() / 60);
  const angle = ((hours - 12) * 15) * (Math.PI / 180); 
  const distance = 600; 
  return {
    x: Math.sin(angle) * distance,
    y: 0, 
    z: Math.cos(angle) * distance
  };
};


// ==========================================
// SECTION 2: THE MAIN COMPONENT
// ==========================================

function App() {
  const globeEl = useRef();
  const [simulationTime, setSimulationTime] = useState(new Date());

  // ------------------------------------------
  // A. THE WAREHOUSE (useMemo)
  // We build these heavy objects ONCE and reuse them forever.
  // ------------------------------------------

  // A1. The Cloud Texture (The Paint)
  const cloud1_Texture = useMemo(() => generateCloudTexture(), []);
  const cloud2_Texture = useMemo(() => generateCloudTexture(), []);
  const particle_Texture = useMemo(() => generateparticleTexture(), []);

  // A2. The Geometries (The Shapes)
  const geometries = useMemo(() => {
    // 1. SHIELD GEOMETRY (The Wall)
    const shieldGeo = new THREE.SphereGeometry(130, 64, 64);
    const pos1 = shieldGeo.attributes.position;
    for (let i = 0; i < pos1.count; i++) {
       const z = pos1.getZ(i);
       if (z < 0) pos1.setZ(i, z * 3.0); // Stretch the tail
    }
    shieldGeo.computeVertexNormals();

    // 2. STORM GEOMETRY (The Projectile)
    const storm1_geo = new THREE.SphereGeometry(175, 64, 64, 0, Math.PI * 2, 0, Math.PI / 3);
    storm1_geo.rotateX(- Math.PI / 2); // Flip to face the Sun
    const storm2_geo = new THREE.SphereGeometry(200, 64, 64, 0, Math.PI * 3, 0, Math.PI / 3);
    storm2_geo.rotateX(- Math.PI/ 2); // Flip to face the Sun
    return { shield: shieldGeo, storm1: storm1_geo, storm2: storm2_geo };
  }, []);

  // A3. The Materials (The Skin)
  const materials = useMemo(() => {
    return {
      earth: new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 1.0, metalness: 0.1, emissive: 0x000000
      }),
      shield: new THREE.MeshPhongMaterial({
        color: 0x44aaff, transparent: true, opacity: 0.3, 
        side: THREE.DoubleSide, depthWrite: false, shininess: 100
      }),
      storm1: new THREE.MeshPhongMaterial({
        map: cloud1_Texture, color: 0xffaa00, transparent: true, opacity: 0.2, 
        side: THREE.DoubleSide, depthWrite: false,shininess: 100, blending: THREE.AdditiveBlending
      }),
      storm2: new THREE.MeshPhongMaterial({
        map: cloud2_Texture, color: 0xffaa00, transparent: true, opacity: 0.14, 
        side: THREE.DoubleSide, depthWrite: false,shininess: 100, blending: THREE.AdditiveBlending
      }),      
      particle: new THREE.SpriteMaterial({
        map:particle_Texture ,color: 0xffaa00, transparent: true, opacity: 0.7, depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    };
  }, [cloud1_Texture, cloud2_Texture, particle_Texture]);

  // A4. The Data Layers (The Instruction List)
  const layerData = useMemo(() => {
    // 1. The Big Shapes
    const staticLayers = [{ type: 'shield' }, { type: 'storm1' }, { type: 'storm2' }];
    
    // 2. The Particles (Targeted Storm)
    // We create 30 particles that act as the "Spray" from the storm
    const particles = Array.from({ length: 40 }).map((_, i) => ({
      type: 'particle',
      id: i,
      progress: Math.random(), 
      // CLUSTER: Keep them tight (Width 15) so they hit a specific region
      yOffset: (Math.random() - 0.5) * 100, 
      zOffset: (Math.random() - 0.5) * 100,
      speed: 0.005 + Math.random() * 0.005
    }));

    return [...staticLayers, ...particles];
  }, []);


  // ------------------------------------------
  // B. SCENE MANAGEMENT (The Stage Crew)
  // ------------------------------------------

  const handleGlobeReady = () => {
    if (!globeEl.current) return;
    try {
      const scene = globeEl.current.scene();

      // 1. Cleanup old lights
      scene.traverse((obj) => {
        if (obj.isLight && obj.name !== "sun-light" && obj.name !== "ambient-light") {
          obj.intensity = 0; obj.visible = false;
        }
      });

      // 2. Setup Sun
      let sunLight = scene.getObjectByName("sun-light");
      if (!sunLight) {
        sunLight = new THREE.DirectionalLight(0xffffff, 4.5);
        sunLight.name = "sun-light";
        scene.add(sunLight);
      }
      const pos = getSunPosition(new Date());
      sunLight.position.set(pos.x, pos.y, pos.z);

      // 3. Setup Ambient
      let ambientLight = scene.getObjectByName("ambient-light");
      if (!ambientLight) {
        ambientLight = new THREE.AmbientLight(0xffffff, 0.26); 
        ambientLight.name = "ambient-light";
        scene.add(ambientLight);
      }
    } catch (e) { console.error(e); }
  };

  // ------------------------------------------
  // C. THE RENDER LOOP (The Camera Action)
  // ------------------------------------------

  // Update Sun Position when time changes
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
        globeMaterial={materials.earth}

        customLayerData={layerData} 

        // ------------------------------------
        // D. OBJECT BUILDER (Runs ONCE per object)
        // ------------------------------------
        customThreeObject={(d) => {
          if (d.type === 'shield') {
            return new THREE.Mesh(geometries.shield, materials.shield);
          }
          if (d.type === 'storm1') {
            return new THREE.Mesh(geometries.storm1, materials.storm1);
          }
          if (d.type === 'storm2') {
            return new THREE.Mesh(geometries.storm2, materials.storm2);
          }
          if (d.type === 'particle') {
            const sprite = new THREE.Sprite(materials.particle);
            sprite.scale.set(12, 12, 1); // Size of one puff
            return sprite;
          }
        }}

        // ------------------------------------
        // E. ANIMATION LOOP (Runs 60x per sec)
        // ------------------------------------
        customThreeObjectUpdate={(obj, d) => {
          const sunPos = getSunPosition(simulationTime);

          // 1. SHIELD & STORM (Face the Sun)
          if (d.type === 'shield') {
            obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
          }
          if (d.type === 'storm1' || d.type === 'storm2') {
            obj.lookAt(-sunPos.x, -sunPos.y, -sunPos.z);
          }

          // 2. PARTICLES (Travel from Sun to Impact Zone)
          if (d.type === 'particle') {
            d.progress += d.speed;
            if (d.progress > 1.0) d.progress = 0;

            const t = d.progress;
            
            // Interpolate from Sun(400) to Shield(100)
            const startX = sunPos.x;
            const startY = sunPos.y;
            const startZ = sunPos.z;

            const cx = startX * (1 - t);
            const cy = startY * (1 - t);
            const cz = startZ * (1 - t);

            // "Splash" Logic: Spread out when close to Earth
            let spread = 1.0;
            if (t > 0.75) {
              spread = 1.0 + ((t - 0.75) * 20); 
            }
            Object.assign(obj.position, {
              x: cx, 
              y: cy + (d.yOffset * spread), 
              z: cz + (d.zOffset * spread)  
            });
          }
        }}
      />

      {/* HUD & TIME CONTROL (Keep your existing UI here) */}
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