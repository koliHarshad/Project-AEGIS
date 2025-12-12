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
  const distance = 750; 
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

const pseudoRandom = (seed) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
};

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
        map: cloud2_Texture, color: 0xff4400, transparent: true, opacity: 0.14, shininess: 100,
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
    const particles = Array.from({ length: 100 }).map((_, i) => ({
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
            const processed = data.map((d, index) => {
                const birth = parseTimestamp(d.timestamp);
                let impact = parseTimestamp(d.impact_time);
                if (!impact || impact <= birth) impact = birth + (60 * 60 * 1000);
                
                // --- NEW: IMPACT VECTOR CALCULATION ---
                // Use index as a seed for stable randomness
                const randY = pseudoRandom(index * 73); // Random 0.0 to 1.0
                const randZ = pseudoRandom(index * 42); 
                
                // Define the "Target Window" on the shield
                // Y: -60 (South Pole) to +60 (North Pole)
                // Z: -30 (Left) to +30 (Right)
                const targetY = (randY - 0.5) * 120; 
                const targetZ = (randZ - 0.5) * 60;

                return {
                    ...d,
                    birthTime: birth,
                    impactTime: impact,
                    totalDuration: impact - birth,
                    speed: d.speed || 350,
                    density: d.density,
                    bz: d.bz,
                    kp: d.kp,
                    y: targetY,
                    z: targetZ,
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

  // HUD helper function
  // HELPER: Translates raw data into a tactical status message
  const getSystemStatus = (data) => {
    if (!data) return { status: "OFFLINE", subtext: "WAITING FOR DATA STREAM...", color: "text-gray-500" };

    const kp = Number(data.kp) || 0;
    const speed = Number(data.speed) || 0;

    // SCENARIO 1: The "Silent Killer" (Your ML Model's time to shine)
    // Low Wind Speed (Low Pressure), but High Kp (High Damage)
    if (speed < 450 && kp >= 5) {
      return {
        title: "MAGNETIC BREACH",
        subtext: "LOW PRESSURE / HIGH INSTABILITY",
        desc: "ML WARNING: Solar wind is slow, but magnetic alignment is causing shield failure. Invisible threat detected.",
        color: "text-red-500 animate-pulse",
        borderColor: "border-red-600"
      };
    }

    // SCENARIO 2: Pure Physical Stress
    // High Wind Speed (High Pressure), but Low Kp (Shield holds)
    if (speed > 600 && kp < 5) {
      return {
        title: "COMPRESSION ALERT",
        subtext: "HIGH PRESSURE / INTEGRITY STABLE",
        desc: "Shield is physically compressed by high-speed wind, but defenses are holding. No breach.",
        color: "text-orange-400",
        borderColor: "border-orange-500"
      };
    }

    // SCENARIO 3: Total Storm (The Big One)
    if (kp >= 6) {
      return {
        title: "CRITICAL FAILURE",
        subtext: "EXTREME PRESSURE & INSTABILITY",
        desc: "Severe storm conditions. Shield collapse imminent. Grid warning issued.",
        color: "text-red-600 animate-pulse",
        borderColor: "border-red-600"
      };
    }

    // SCENARIO 4: Quiet / Normal
    return {
      title: "SYSTEMS NOMINAL",
      subtext: "SOLAR CONDITIONS QUIET",
      desc: "Magnetosphere stable. Standard monitoring active.",
      color: "text-cyan-400",
      borderColor: "border-cyan-500"
    };
  };

  const status = getSystemStatus(currentData);
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
          const currentTimeMs = simulationTime.getTime();

          // --- STEP 3: SHIELD COMPRESSION LOGIC ---
          
          // 1. Calculate Global Pressure & Max Kp
          // We check ALL active storms to see if ANY is hitting us right now.
          let maxPressure = 0;
          let maxKp = 0;

          // Find active storms
          const activeStorms = processedData.filter(storm => 
              storm.birthTime < currentTimeMs && storm.impactTime > currentTimeMs
          );
          
          activeStorms.forEach(s => {
             const elapsed = currentTimeMs - s.birthTime;
             const p = elapsed / s.totalDuration;
             
             // If storm is AT the shield (Progress 0.9 to 1.0)
             if (p > 0.9) {
                 // Simple Pressure Formula: (Density * Speed) / Scaling Factor
                 // We divide by 6000 so the result is usually between 0.0 and 0.5
                 const pressure = (s.density * s.speed) / 6000; 
                 if (pressure > maxPressure) maxPressure = pressure;
            
                 // Track the highest alert level
                 if (s.kp > maxKp) maxKp = s.kp;
             }
          });

          // 2. UPDATE SHIELD MESH
          if (d.type === 'shield') {
             obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
             
             // A. COMPRESSION (Physical Deform)
             // Base scale is 1.0. We subtract pressure.
             // We clamp it so it never shrinks below 0.5 (half size)
             const compression = Math.max(0.87, 1.0 - maxPressure);
             obj.scale.set(1, 1, compression); 

             // B. COLOR ALERT (Visual Warning)
             if (maxKp > 6) {
                // Panic Mode
                obj.material.color.setHex(0xff0000);
                // Rapid pulsing (Panic heartbeat)
                obj.material.opacity = 0.4 + Math.sin(simulationTime.getTime() / 50) * 0.2; 
              } else if (maxKp > 4) {
                  // Warning Mode
                  obj.material.color.setHex(0xffaa00);
                  obj.material.opacity = 0.3;
              } else {
                  // Safe Mode
                  obj.material.color.setHex(0x44aaff);
                  obj.material.opacity = 0.25; // Keep it subtle so Aurora pops
              }
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

                  //opacity 
                  const density = myStorm.density || 3.0;
                  const baseOpacity = Math.min(1.0, 0.4 + (density / 5.0));
                  obj.material.opacity = baseOpacity

                  // POSITION
                  const sunPosAtBirth = getSunPosition(new Date(myStorm.birthTime));
                  const sunDist = Math.sqrt(sunPosAtBirth.x**2 + sunPosAtBirth.y**2 + sunPosAtBirth.z**2);
                  const dirX = -sunPosAtBirth.x / sunDist;
                  const dirZ = -sunPosAtBirth.z / sunDist;

                  // spread
                  const travelDist = 750 * progress;
                  const coneWidth = 0.9 + (progress * 2.0); 
                  const density_spread = 5.0 / (density + 2.0); // making density affect the spread. Higher density = less spread
                  const spread = coneWidth + density_spread; 

                  const currentDriftY = myStorm.y * progress;
                  const currentDriftZ = myStorm.z * progress;

                  const px = sunPosAtBirth.x + (dirX * travelDist) + (d.offsetX * spread);
                  const py = (d.offsetY * spread) + currentDriftY; 
                  const pz = sunPosAtBirth.z + (dirZ * travelDist) + (d.offsetZ * spread) + currentDriftZ;

                  // shield collision
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
      
      {/* HUD & OPERATIONS CONSOLE */}
      <div className="absolute top-0 left-0 p-6 z-20 pointer-events-none max-w-md w-full">
          
          {/* MAIN STATUS PANEL */}
          <div className={`border-l-4 ${status.borderColor} bg-black/80 backdrop-blur-md p-4 shadow-2xl`}>
              
              {/* HEADER: The Verdict */}
              <div className="flex justify-between items-start mb-2">
                  <div>
                      <h2 className="text-xs font-mono text-gray-400 tracking-widest mb-1">DEFENSE STATUS</h2>
                      <h1 className={`text-3xl font-black font-mono tracking-tight ${status.color}`}>
                          {status.title}
                      </h1>
                      <p className={`text-xs font-bold font-mono mt-1 ${status.color.replace('animate-pulse', '')} opacity-80`}>
                          {status.subtext}
                      </p>
                  </div>
                  {/* Live Indicator */}
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${currentData ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className="text-[10px] font-mono text-gray-500">LIVE FEED</span>
                  </div>
              </div>

              {/* SEPARATOR */}
              <div className="h-px w-full bg-gray-700 my-3"></div>

              {/* THE "WHY": Contextual Explanation */}
              <p className="text-xs font-mono text-gray-300 leading-relaxed opacity-90 mb-4">
                  {`>> `}{status.desc}
              </p>
              <span className={`text-sm font-mono text-white`}>
                impact time: {currentData ? currentData.impact_time : 0}
              </span>
              
              {/* METRICS GRID: Physics vs ML */}
              <div className="grid grid-cols-2 gap-4">
                  
                  {/* COL 1: The Input (Physics) */}
                  <div className="bg-white/5 p-2 rounded border border-white/10">
                      <div className="text-[10px] text-gray-400 font-mono mb-1">INCOMING PRESSURE</div>
                      <div className="flex items-baseline gap-1">
                          <span className="text-xl font-bold text-white font-mono">
                              {currentData ? Math.round(currentData.speed) : 0}
                          </span>
                          <span className="text-[10px] text-gray-500">km/s</span>
                      </div>
                      {/* Visual Bar for Speed */}
                      <div className="w-full h-1 bg-gray-700 mt-2 rounded-full overflow-hidden">
                          <div 
                              className="h-full bg-blue-500 transition-all duration-500"
                              style={{ width: `${Math.min(100, ((currentData?.speed || 0) / 800) * 100)}%` }}
                          ></div>
                      </div>
                  </div>

                  {/* COL 2: The Output (ML Prediction) - HIGHLIGHTED */}
                  <div className={`bg-white/10 p-2 rounded border ${status.borderColor} relative overflow-hidden`}>
                      {/* Background glow for emphasis */}
                      <div className={`absolute inset-0 opacity-10 ${status.color.replace('text-', 'bg-')}`}></div>
                      
                      <div className="text-[10px] text-cyan-300 font-mono mb-1 flex justify-between">
                          <span>ML INTEGRITY SCORE</span>
                          <span className="text-[9px] border border-cyan-500/50 px-1 rounded">AI ACTIVE</span>
                      </div>
                      <div className="flex items-baseline gap-1 relative z-10">
                          <span className={`text-l font-bold font-mono ${status.color}`}>
                              Kp Index: {currentData ? currentData.kp_pred : 0}
                          </span>
                      </div>
                      {/* Visual Bar for Kp */}
                      <div className="w-full h-1 bg-gray-700 mt-2 rounded-full overflow-hidden relative z-10">
                          <div 
                              className={`h-full transition-all duration-500 ${
                                  (currentData?.kp || 0) > 5 ? 'bg-red-500' : 'bg-cyan-400'
                              }`}
                              style={{ width: `${Math.min(100, ((currentData?.kp || 0) / 9) * 100)}%` }}
                          ></div>
                      </div>
                  </div>
              </div>

          </div>
      </div>
    </div>
  );
}

export default App;