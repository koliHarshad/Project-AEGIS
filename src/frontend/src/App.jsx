import React, { useRef, useState, useMemo, useEffect } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

// ==========================================
// SECTION 1: UTILITY TOOLS
// ==========================================

const parseTimestamp = (dateString) => {
  if (!dateString) return null;
  let s = dateString.toString().replace(' ', 'T');
  if (s.includes('.')) {
      const parts = s.split('.');
      s = `${parts[0]}.${parts[1].substring(0, 3)}`;
  }
  if (!s.endsWith('Z')) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.getTime();
};

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

// TEXTURE GENERATORS
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

const generateParticleTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)'); 
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}


// ==========================================
// SECTION 2: MAIN COMPONENT
// ==========================================

function App() {
  const globeEl = useRef();
  const [processedData, setProcessedData] = useState([]);
  const [sliderIndex, setSliderIndex] = useState(0);
  const [currentData, setCurrentData] = useState(null); 
  const [simulationTime, setSimulationTime] = useState(new Date());

  // ------------------------------------------
  // ASSETS
  // ------------------------------------------
  const cloud1_Texture = useMemo(() => generateCloudTexture(), []);
  const cloud2_Texture = useMemo(() => generateCloudTexture(), []);
  const particleTexture = useMemo(() => generateParticleTexture(), []);

  const geometries = useMemo(() => {
    // 1. SHIELD
    const shieldGeo = new THREE.SphereGeometry(130, 64, 64);
    const pos = shieldGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
       const z = pos.getZ(i);
       if (z < 0) pos.setZ(i, z * 3.0); 
    }
    shieldGeo.computeVertexNormals();

    // 2. STORM CLOUDS (Restored!)
    // These are the static bow-shock shapes in front of the shield
    const storm1_geo = new THREE.SphereGeometry(175, 64, 64, 0, Math.PI * 2, 0, Math.PI / 3);
    storm1_geo.rotateX(-Math.PI / 2); // Face forward
    
    const storm2_geo = new THREE.SphereGeometry(200, 64, 64, 0, Math.PI * 2, 0, Math.PI / 3);
    storm2_geo.rotateX(-Math.PI / 2);

    return { shield: shieldGeo, storm1: storm1_geo, storm2: storm2_geo };
  }, []);

  const materials = useMemo(() => {
    return {
      earth: new THREE.MeshStandardMaterial({ 
          color: 0xffffff, roughness: 1.0, metalness: 0.1, emissive: 0x000000
      }),
      shield: new THREE.MeshPhongMaterial({ 
          color: 0x44aaff, transparent: true, opacity: 0.3, 
          side: THREE.DoubleSide, depthWrite: false, shininess: 100 
      }),
      // STORM CLOUDS MATERIALS (Restored!)
      storm1: new THREE.MeshPhongMaterial({
        map: cloud1_Texture, color: 0xffaa00, transparent: true, opacity: 0.2, shininess: 100,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }),
      storm2: new THREE.MeshPhongMaterial({
        map: cloud2_Texture, color: 0xff4400, transparent: true, opacity: 0.14, shineiness: 100,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }),
      particle: new THREE.SpriteMaterial({ 
          map: particleTexture, 
          color: 0xffffff, 
          transparent: true, 
          opacity: 0.8, 
          depthWrite: false, 
          blending: THREE.AdditiveBlending 
      })
    };
  }, [cloud1_Texture, cloud2_Texture, particleTexture]);

  // ------------------------------------------
  // LAYERS
  // ------------------------------------------
  const layerData = useMemo(() => {
    // 1. Static Objects (Shield + Storms)
    const staticLayers = [{ type: 'shield' }, { type: 'storm1' }, { type: 'storm2' }];
    
    // 2. Particle Pool
    const particles = Array.from({ length: 150 }).map((_, i) => ({
      type: 'particle',
      id: i,
      offsetX: (Math.random() - 0.5) * 60,
      offsetY: (Math.random() - 0.5) * 60,
      offsetZ: (Math.random() - 0.5) * 20,
      scaleVar: 0.5 + Math.random() * 1.0
    }));

    return [...staticLayers, ...particles];
  }, []);

  // ------------------------------------------
  // DATA LOGIC
  // ------------------------------------------
  useEffect(() => {
    fetch('http://localhost:8000/telemetry/timestamps_particle')
      .then(res => res.json()) 
      .then(data => {
        if(data && data.length > 0) {
            const processed = data.map(d => {
                const birth = parseTimestamp(d.timestamp);
                let impact = parseTimestamp(d.impact_time);
                if (!impact || impact <= birth) impact = birth + (60 * 60 * 1000);
                
                return {
                    ...d,
                    birthTime: birth,
                    impactTime: impact,
                    totalDuration: impact - birth,
                    speed: d.speed || 350
                };
            }).filter(d => d.birthTime !== null);

            setProcessedData(processed);
            const latestIndex = processed.length - 1;
            setSliderIndex(latestIndex);
            setSimulationTime(new Date(processed[latestIndex].birthTime));
            updateSnapshot(data[latestIndex].timestamp);
        }
      })
      .catch(e => console.error(e));
  }, []);

  const updateSnapshot = (timestamp) => {
    fetch(`http://localhost:8000/telemetry/snapshot?timestamp=${timestamp}`)
        .then(res => res.json())
        .then(data => setCurrentData(data))
        .catch(e => console.error(e));
  };

  const handleSliderChange = (e) => {
    const idx = parseInt(e.target.value);
    setSliderIndex(idx);
    if (processedData[idx]) {
        const newTime = new Date(processedData[idx].birthTime);
        setSimulationTime(newTime);
        updateSnapshot(processedData[idx].timestamp);
    }
  };

  // ------------------------------------------
  // SCENE LIGHTING
  // ------------------------------------------
  const handleGlobeReady = () => {
    if (!globeEl.current) return;
    const scene = globeEl.current.scene();

    scene.traverse(obj => {
       if (obj.isLight) obj.visible = false;
    });

    const sunLight = new THREE.DirectionalLight(0xffffff, 4.5);
    sunLight.name = "sun-light";
    scene.add(sunLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.26); 
    scene.add(ambient);
  };

  useEffect(() => {
    if (!globeEl.current) return;
    const scene = globeEl.current.scene();
    const sunLight = scene.getObjectByName("sun-light");
    if (sunLight) {
        const pos = getSunPosition(simulationTime);
        sunLight.position.set(pos.x, pos.y, pos.z);
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

        customThreeObject={(d) => {
          if (d.type === 'shield') return new THREE.Mesh(geometries.shield, materials.shield);
          if (d.type === 'storm1') return new THREE.Mesh(geometries.storm1, materials.storm1);
          if (d.type === 'storm2') return new THREE.Mesh(geometries.storm2, materials.storm2);
          if (d.type === 'particle') return new THREE.Sprite(materials.particle);
        }}

        // ===============================================
        //  RENDER LOOP
        // ===============================================
        customThreeObjectUpdate={(obj, d) => {
          const sunPos = getSunPosition(simulationTime);

          // 1. ALIGN SHIELD & STORM CLOUDS
          if (d.type === 'shield') {
             obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
             return;
          }
          if (d.type === 'storm1' || d.type === 'storm2') {
             obj.lookAt(-sunPos.x, -sunPos.y, -sunPos.z);
             return;
          }

          // 2. PARTICLE LOGIC
          if (d.type === 'particle') {
              const currentTimeMs = simulationTime.getTime();
              const activeStorms = processedData.filter(storm => 
                  storm.birthTime < currentTimeMs && storm.impactTime > currentTimeMs
              );

              if (activeStorms.length > 0) {
                  obj.visible = true;
                  const myStorm = activeStorms[d.id % activeStorms.length];

                  const elapsed = currentTimeMs - myStorm.birthTime;
                  let progress = elapsed / myStorm.totalDuration;
                  if (progress > 1.0) progress = 1.0; 
                  if (progress < 0.0) progress = 0.0;

                  // VISUALS
                  const intensity = Math.max(0, Math.min(1, (myStorm.speed - 300) / 500));
                  const hue = 0.6 - (intensity * 0.6); 
                  obj.material.color.setHSL(hue, 1.0, 0.5);

                  const baseSize = 8 + (intensity * 15); 
                  const size = baseSize * d.scaleVar;
                  obj.scale.set(size, size, 1);

                  // POSITION
                  const sunPosAtBirth = getSunPosition(new Date(myStorm.birthTime));
                  const sunDist = Math.sqrt(sunPosAtBirth.x**2 + sunPosAtBirth.y**2 + sunPosAtBirth.z**2);
                  const dirX = -sunPosAtBirth.x / sunDist;
                  const dirZ = -sunPosAtBirth.z / sunDist;

                  const travelDist = 400 * progress;
                  const spread = 0.1 + (progress * 2.0); 
                  
                  const px = sunPosAtBirth.x + (dirX * travelDist) + (d.offsetX * spread);
                  const py = (d.offsetY * spread); 
                  const pz = sunPosAtBirth.z + (dirZ * travelDist) + (d.offsetZ * spread);

                  const distToEarth = Math.sqrt(px*px + py*py + pz*pz);
                  if (distToEarth < 130) {
                      const push = 130 / distToEarth;
                      obj.position.set(px * push, py * push * 1.5, pz * push * 1.5);
                  } else {
                      obj.position.set(px, py, pz);
                  }
              } else {
                  obj.visible = false;
              }
          }
        }}
      />

      {/* HUD & CONTROLS */}
      <div className="absolute bottom-0 w-full p-6 bg-gradient-to-t from-black to-transparent z-10">
         <div className="text-cyan-400 font-mono text-xs flex justify-between mb-2">
             <span>PAST (24h)</span>
             <span className="text-white font-bold">{simulationTime.toUTCString()}</span>
             <span>NOW</span>
         </div>
         <input 
            type="range" min="0" max={Math.max(0, processedData.length - 1)} step="1"
            value={sliderIndex}
            onChange={handleSliderChange}
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
         />
      </div>
      
      <div className="absolute top-0 left-0 p-6 z-10 pointer-events-none">
         <div className="border-l-4 border-cyan-500 pl-4 bg-black/40 backdrop-blur-md pr-6 py-2">
            <h1 className="text-3xl text-white font-bold tracking-widest font-mono">SOLAR SENTINEL</h1>
            <p className="text-cyan-400 text-sm font-mono mt-1">
               {currentData ? `SPEED: ${Math.round(currentData.speed)} km/s` : "OFFLINE"}
            </p>
         </div>
      </div>
    </div>
  );
}

export default App;