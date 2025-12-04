import React, { useRef, useState, useMemo, useEffect } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

// --- HELPER: CALCULATE SUN POSITION ---
const getSunPosition = (date) => {
  const now = date || new Date();
  const hours = now.getUTCHours() + (now.getUTCMinutes() / 60);
  const angle = ((hours - 12) * 15) * (Math.PI / 180); 
  const distance = 500; 
  return {
    x: Math.sin(angle) * distance,
    y: 0, 
    z: Math.cos(angle) * distance
  };
};

function App() {
  const globeEl = useRef();
  const [simulationTime, setSimulationTime] = useState(new Date());

  // 1. MATERIAL
  const earthMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0, 
      metalness: 0.0,
      emissive: 0x000000
    });
  }, []);

  // 2. DATA
  const layerData = useMemo(() => [{ type: 'shield' }, { type: 'storm'} ], []);
  // 3. CLOUD PARTICLES (Fewer, Tighter Cluster)
  const solarCloud = useMemo(() => {
    // Reduced count to 40 for a single "Blob" feel
    return Array.from({ length: 40 }).map((_, i) => ({
      type: 'cloud',
      id: i,
      progress: Math.random(), 
      // SPAWN: Start very TIGHT (Cluster width 20 instead of 120)
      // This makes it look like one single cloud mass initially
      yOffset: (Math.random() - 0.5) * 60, 
      zOffset: (Math.random() - 0.5) * 60,
      speed: 0.005 + Math.random() * 0.005
    }));
  }, []);

  // 4. GLOBE READY HANDLER
  const handleGlobeReady = () => {
    if (!globeEl.current) return;
    try {
      const scene = globeEl.current.scene();

      // A. KILL GHOST LIGHTS
      scene.traverse((obj) => {
        if (obj.isLight && obj.name !== "sun-light" && obj.name !== "ambient-light") {
          obj.intensity = 0;
          obj.visible = false;
        }
      });

      // B. CUSTOM SUN
      let sunLight = scene.getObjectByName("sun-light");
      if (!sunLight) {
        sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
        sunLight.name = "sun-light";
        scene.add(sunLight);
      }
      const pos = getSunPosition(new Date());
      sunLight.position.set(pos.x, pos.y, pos.z);

      // C. AMBIENT LIGHT
      let ambientLight = scene.getObjectByName("ambient-light");
      if (!ambientLight) {
        ambientLight = new THREE.AmbientLight(0xffffff, 0.3); 
        ambientLight.name = "ambient-light";
        scene.add(ambientLight);
      }
    } catch (e) { console.error(e); }
  };

  // 5. UPDATE LOOP
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

        customLayerData={[...layerData, ...solarCloud]} 

        // A. BUILD SHAPES
        customThreeObject={(d) => {
          
          // --- SHIELD ---
          if (d.type === 'shield') {
            const geometry = new THREE.SphereGeometry(137, 64, 64);
            
            // Morph: Less squashing on the nose so it remains visible
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              const z = positions.getZ(i);
              if (z < 0) {
                 positions.setZ(i, z * 2.9); // Tail stretch
              } else {
                 positions.setZ(i, z * 1.02); // Almost full roundness on nose
              }
            }
            geometry.computeVertexNormals();

            const material = new THREE.MeshPhongMaterial({
              color: 0x44aaff,
              transparent: true,
              opacity: 0.25, // Increased opacity to make Sun-side visible
              side: THREE.DoubleSide,
              shininess: 100,
              depthWrite: false, 
            });
            return new THREE.Mesh(geometry, material);
          }

          // --- CLOUD ---
          if (d.type === 'cloud') {
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const context = canvas.getContext('2d');
            const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
            gradient.addColorStop(0, 'rgba(255, 180, 50, 1)'); 
            gradient.addColorStop(1, 'rgba(255, 100, 0, 0)'); 
            context.fillStyle = gradient;
            context.fillRect(0, 0, 32, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ 
              map: texture, 
              color: 0xffaa00,
              transparent: true,
              opacity: 0.7,
              blending: THREE.AdditiveBlending 
            });
            
            const sprite = new THREE.Sprite(material);
            // Reduced size back to 5 (similar to original particles)
            sprite.scale.set(8, 8, 1); 
            return sprite;
          }

          if (d.type === 'storm') {
            const geometry = new THREE.SphereGeometry(169, 64, 64);
            
            // Morph: Less squashing on the nose so it remains visible
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
              const z = positions.getZ(i);
              if (z < 0) {
                 positions.setZ(i, z * -0.3); // Tail stretch
              } else {
                 positions.setZ(i, z * 0.3); // Almost full roundness on nose
              }
            }
            geometry.computeVertexNormals();

            const material = new THREE.MeshPhongMaterial({
              color: 0xffaa00,
              transparent: true,
              opacity: 0.39, // Increased opacity to make Sun-side visible
              side: THREE.DoubleSide,
              shininess: 80,
              depthWrite: false, 
            });
            return new THREE.Mesh(geometry, material);
          }
        }}

        // B. ANIMATE
        customThreeObjectUpdate={(obj, d) => {
          const sunPos = getSunPosition(simulationTime);

          // --- SHIELD ---
          if (d.type === 'shield') {
            obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
          }

          // --- CLOUD ---
          if (d.type === 'cloud') {
            d.progress += d.speed;
            if (d.progress > 1.0) d.progress = 0;

            const t = d.progress;
            
            // 1. Center Line Position (Sun -> Earth)
            const cx = sunPos.x * (1 - t);
            const cy = sunPos.y * (1 - t);
            const cz = sunPos.z * (1 - t);

            // 2. FLOW LOGIC (The "Splash")
            // If we are far from Earth (t < 0.7), stay TIGHT (Beam).
            // If we hit Earth (t > 0.7), spread WIDE (Splash).
            let spreadMultiplier = 1.0;
            
            if (t > 0.75) {
                // Rapidly expand from 1.0 to 6.0 width
                spreadMultiplier = 1.0 + ((t - 0.75) * 20); 
            }

            // Apply position
            Object.assign(obj.position, {
              x: cx, 
              // Spread expands as we pass the shield
              y: cy + (d.yOffset * spreadMultiplier), 
              z: cz + (d.zOffset * spreadMultiplier)  
            });
          }

          if (d.type === 'storm') {
            // 1. Calculate a position slightly towards the sun
            // Shield Radius (102) + Storm Radius (70) = ~170 to touch tips.
            // We set it to 160 so they slightly overlap (Impact Visual)
            
            // Normalize sun vector and multiply by distance
            const offsetDistance = 100; 
            const dist = Math.sqrt(sunPos.x**2 + sunPos.y**2 + sunPos.z**2);
            
            const newX = (sunPos.x / dist) * offsetDistance;
            const newY = (sunPos.y / dist) * offsetDistance;
            const newZ = (sunPos.z / dist) * offsetDistance;

            obj.position.set(newX, newY, newZ);

            // 2. Rotate to face the shield
            // It points its "Tail" (Z>0) towards the Sun
            obj.lookAt(sunPos.x, sunPos.y, sunPos.z);          
          }
        }}
      />

      {/* HUD */}
      <div className="absolute z-10 top-0 left-0 w-full p-6 pointer-events-none flex justify-between">
        <header className="border-l-4 border-cyan-500 pl-4 bg-black/30 backdrop-blur-sm pr-6">
          <h1 className="text-4xl text-white font-bold tracking-widest font-mono drop-shadow-md">
            SOLAR SENTINEL
          </h1>
          <p className="text-cyan-400 text-sm font-mono tracking-widest">
            MAGNETOSPHERE INTEGRITY: 100%
          </p>
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
          <span className="text-white font-mono font-bold">
            {simulationTime.getUTCHours().toString().padStart(2, '0')}:00
          </span>
        </div>
      </div>

    </div>
  );
}

export default App;