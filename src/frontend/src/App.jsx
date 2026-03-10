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
  canvas.width = 256; canvas.height = 256; 
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const radius = 20 + Math.random() * 60;
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

// --- HISTORICAL ANALOG STATE & MOCK DATA ---
  const [showHistorical, setShowHistorical] = useState(false);
  const [historicalData, setHistoricalData] = useState(null);

  // --- ML FAILSAFE LOGIC ---
  const mlKp = currentData?.kp_pred || 0;
  const histKp = historicalData?.primary_match?.max_kp || 0;
  const simScore = historicalData?.primary_match?.similarity_percentage || 0;
  
  // Trigger warning if ML differs from History by 3+ points AND physics match is strong (>75%)
  const showFailsafeWarning = Math.abs(mlKp - histKp) >= 3 && simScore >= 75;


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

    // 2. STORM CLOUDS
    const storm1_geo = new THREE.SphereGeometry(175, 64, 64, 0, Math.PI * 2, 0, Math.PI / 3);
    storm1_geo.rotateX(-Math.PI / 2); 
    
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
      storm1: new THREE.MeshPhongMaterial({
        map: cloud1_Texture, color: 0xffaa00, transparent: true, opacity: 0.23, shininess: 100,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }),
      storm2: new THREE.MeshPhongMaterial({
        map: cloud2_Texture, color: 0xff4400, transparent: true, opacity: 0.19, shininess: 100,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }),
      particle: new THREE.SpriteMaterial({ 
          map: particleTexture, color: 0xffffff, transparent: true, 
          opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending 
      })
    };
  }, [cloud1_Texture, cloud2_Texture, particleTexture]);

  // ------------------------------------------
  // LAYERS
  // ------------------------------------------
  const layerData = useMemo(() => {
    const staticLayers = [{ type: 'shield' }, { type: 'storm1' }, { type: 'storm2' }];
    const particles = Array.from({ length: 170 }).map((_, i) => ({
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
                
                return {
                    ...d,
                    birthTime: birth,
                    impactTime: impact,
                    totalDuration: impact - birth,
                    speed: d.speed || 350,
                    density: d.density,
                    bz: d.bz,
                    kp: d.kp,
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
    setShowHistorical(false);
    setHistoricalData(null);

    const idx = parseInt(e.target.value);
    setSliderIndex(idx);
    if (processedData[idx]) {
        const newTime = new Date(processedData[idx].birthTime);
        setSimulationTime(newTime);
        updateSnapshot(processedData[idx].timestamp);
    }
  };
  const handleViewHistoricalClick = () => {
      if (!currentData) return;
      
      // Instantly open the panel to show the "LOADING..." UI
      setShowHistorical(true); 

      const queryParams = new URLSearchParams({
          speed: currentData.speed,
          density: currentData.density,
          bz: currentData.bz,
          kp: currentData.kp_pred
      });
      
      fetch(`http://localhost:8000/telemetry/historical_match?${queryParams.toString()}`)
          .then(res => res.json())
          .then(historyData => {
              setHistoricalData(historyData);
          })
          .catch(e => console.error("History Fetch Error:", e));
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

  const getSystemStatus = (data) => {
    if (!data) return { status: "OFFLINE", subtext: "WAITING FOR DATA STREAM...", color: "text-gray-500" };
    const kp = Number(data.kp) || 0;
    const speed = Number(data.speed) || 0;

    if (speed < 450 && kp >= 5) {
      return {
        title: "MAGNETIC BREACH",
        subtext: "LOW PRESSURE / HIGH INSTABILITY",
        desc: "ML WARNING: Solar wind is slow, but magnetic alignment is causing shield failure. Invisible threat detected.",
        color: "text-red-500 animate-pulse",
        borderColor: "border-red-600"
      };
    }
    if (speed > 600 && kp < 5) {
      return {
        title: "COMPRESSION ALERT",
        subtext: "HIGH PRESSURE / INTEGRITY STABLE",
        desc: "Shield is physically compressed by high-speed wind, but defenses are holding. No breach.",
        color: "text-orange-400",
        borderColor: "border-orange-500"
      };
    }
    if (kp >= 6) {
      return {
        title: "CRITICAL FAILURE",
        subtext: "EXTREME PRESSURE & INSTABILITY",
        desc: "Severe storm conditions. Shield collapse imminent. Grid warning issued.",
        color: "text-red-600 animate-pulse",
        borderColor: "border-red-600"
      };
    }
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
        <style>{`
            .no-scrollbar::-webkit-scrollbar { display: none; }
            .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>

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

          const myStorm = currentData;
          
          if (!myStorm) {
              if (d.type === 'particle') obj.visible = false;
              return;
          }

          // Calculate Impact Vector using Timestamp as Seed
          const seed = new Date(myStorm.timestamp).getTime(); 
          const randomY = Math.sin(seed * 0.0001); 
          const randomZ = Math.cos(seed * 0.0001); 
          const stormY = randomY * 30; 
          const stormZ = randomZ * 30; 

          // 1. UPDATE SHIELD
          if (d.type === 'shield') {
             obj.lookAt(sunPos.x, sunPos.y, sunPos.z);
             
             const pressure = (myStorm.density * myStorm.speed) / 6000;
             const compression = Math.max(0.87, 1.0 - pressure);
             obj.scale.set(1, 1, compression); 

             if (myStorm.kp_pred > 6) {
                obj.material.color.setHex(0xff0000);
                obj.material.opacity = 0.4 + Math.sin(currentTimeMs / 50) * 0.2; 
             } else if (myStorm.kp_pred > 4) {
                 obj.material.color.setHex(0xffaa00);
                 obj.material.opacity = 0.3;
             } else {
                 obj.material.color.setHex(0x44aaff);
                 obj.material.opacity = 0.25; 
             }
             return;
          }

          if (d.type === 'storm1' || d.type === 'storm2') {
             obj.lookAt(-sunPos.x, -sunPos.y, -sunPos.z);
             return;
          }

          // 2. PARTICLE LOGIC (Refined for Impact Simulation)
          // 2. PARTICLE LOGIC (Refined for Impact Simulation)
          if (d.type === 'particle') {
              obj.visible = true;

              // --- A. INFINITE LOOP LOGIC ---
              const t = Date.now() / 1000; 
              const speedFactor = myStorm.speed / 400; 
              // Loop progress from 0.8 (Approaching Storms) to 1.0 (Hitting Shield)
              const progress = 0.2 + ((t * speedFactor + d.id * 0.07) % 0.8);

              // ... (Keep your existing Color/Size/Opacity logic here) ...
              // VISUALS
              const intensity = Math.max(0, Math.min(1, (myStorm.speed - 300) / 500));
              const hue = 0.6 - (intensity * 0.6); 
              obj.material.color.setHSL(hue, 1.0, 0.5);

              const baseSize = 5 + (intensity * 15); 
              const size = baseSize * d.scaleVar;
              obj.scale.set(size, size, 1);

              const density = myStorm.density || 3.0;
              const baseOpacity = Math.min(0.5, 0.8 + (density / 5.0));
              obj.material.opacity = baseOpacity;

              // --- B. POSITION LOGIC (FIXED) ---
              
              // 1. Calculate Vector from Sun to Earth
              const sunPosAtBirth = getSunPosition(simulationTime);
              const sunDist = Math.sqrt(sunPosAtBirth.x**2 + sunPosAtBirth.y**2 + sunPosAtBirth.z**2);
              const dirX = -sunPosAtBirth.x / sunDist; // Direction towards Earth
              const dirZ = -sunPosAtBirth.z / sunDist;

              // 2. Calculate Travel Distance
              // STOP at the shield, don't go into the planet.
              // Sun is at ~750. Shield Radius is ~130. Storms are ~200.
              // We want particles to flow from Radius 250 (Outer Storm) down to Radius 140 (Shield Surface).
              
              const shieldSurface = 140;  // Where we want to stop (130 is shield geo radius)
              
              // Total distance available to travel from Sun to Shield Surface
              const maxTravelDistance = sunDist - shieldSurface; 

              // Apply progress to this CLAMPED distance
              const travelDist = 750 * progress;

              // 3. Spread Logic
              const coneWidth = 0.5 + (progress * 2.7);   
              const density_spread = 5.0 / (density + 2.0); 
              const spread = coneWidth + density_spread; 

              // 4. Final Position
              const px = sunPosAtBirth.x + (dirX * travelDist) + (d.offsetX * spread);
              const py = (d.offsetY * spread) + (stormY * progress); 
              const pz = sunPosAtBirth.z + (dirZ * travelDist) + (d.offsetZ * spread) + (stormZ * progress);

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
        }
      />


      {/* ================================================================================== */}
      {/* LEFT PANEL: SATELLITE SOURCE DATA (The "Input")                                  */}
      {/* ================================================================================== */}
        <div className="absolute top-0 left-0 p-6 z-20 pointer-events-none max-w-sm w-full">
                
            {!showHistorical ? (   
            /* --- STATE 1: LIVE SATELLITE FEED (Your Existing Code) --- */ 
            <div className="bg-black/80 backdrop-blur-md border-l-4 border-cyan-500 p-4 shadow-2xl rounded-r-lg">
              
                {/* Header: Detection Time */}
                <div className="mb-3 border-b border-gray-700 pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <h2 className="text-[10px] font-mono text-cyan-400 tracking-widest">LIVE SATELLITE FEED</h2>
                     </div>
                    <h1 className="text-xl text-white font-mono font-bold">
                        <span className="text-xs text-gray-400">DETECTED AT </span> {currentData ? new Date(currentData.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "--:--"}
                    </h1>
                </div>

              <div className="grid grid-cols-2 gap-4">

                {/* Metric: Speed (Incoming Pressure) */}
                <div className="bg-white/5 p-3 rounded border border-white/10">
                    <div className="text-[10px] text-gray-400 font-mono mb-1">INCOMING SOLAR WIND</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-white font-mono">
                            {currentData ? currentData.speed : 0}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">km/s</span>
                    </div>
                    {/* Speed Bar */}
                    <div className="w-full h-1 bg-gray-800 mt-2 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-cyan-500 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((currentData?.speed || 0) / 800) * 100)}%` }}
                        ></div>
                    </div>
                </div>

                {/* Metric: Density */}
                <div className="bg-white/5 p-3 rounded border border-white/10">
                    <div className="text-[10px] text-gray-400 font-mono mb-1">PROTON DENSITY</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-white font-mono">
                            {currentData ? currentData.density : 0}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">p/cm<sup>3</sup></span>
                    </div>
                    {/* Density Bar */}
                    <div className="w-full h-1 bg-gray-800 mt-2 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-cyan-500 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((currentData?.density || 0) / 50) * 100)}%` }}
                        ></div>
                    </div>
                </div>
              
                {/* Metric: Pressure */}
                <div className="bg-white/5 p-3 rounded border border-white/10">
                    <div className="text-[10px] text-gray-400 font-mono mb-1">PRESSURE</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-white font-mono">
                            {currentData ? (1.6726e-6 * currentData.density * currentData.speed * currentData.speed).toFixed(2) : 0}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">npa</span>
                    </div>
                    {/* Density Bar */}
                    <div className="w-full h-1 bg-gray-800 mt-2 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-cyan-500 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((currentData?.density || 0) / 20) * 100)}%` }}
                        ></div>
                    </div>
                </div>

                {/* Metric: Bz */}
                <div className="bg-white/5 p-3 rounded border border-white/10">
                    <div className="text-[10px] text-gray-400 font-mono mb-1">INTERPLANETARY MAGNETIC FIELD</div>
                    <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-white font-mono">
                            {currentData ? currentData.bz : 0}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">nT</span>
                    </div>
                    {/* Density Bar */}
                    <div className="w-full h-1 bg-gray-800 mt-2 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-cyan-500 transition-all duration-500"
                            style={{ width: `${Math.min(100, ((currentData?.density || 0) / 20) * 100)}%` }}
                        ></div>
                    </div>
                </div>

            </div>
         </div>

            ) : !historicalData ? (
            /* --- LOADING STATE --- */
            <div className="bg-black/80 backdrop-blur-md border-l-4 border-slate-500 p-6 shadow-2xl rounded-r-lg pointer-events-auto">
                <h2 className="text-cyan-400 font-mono text-sm animate-pulse">CALCULATING HISTORICAL MATCH...</h2>
            </div>

            ) : (
            /* --- STATE 2: HISTORICAL ANALOG VIEW --- */
            <div className="bg-black/80 backdrop-blur-md border-l-4 border-slate-500 p-4 shadow-2xl rounded-r-lg pointer-events-auto max-h-[80vh] flex flex-col">
                
                {/* Header & Back Button */}
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                    <h2 className="text-[10px] font-mono text-slate-400 tracking-widest">HISTORICAL CONTEXT</h2>
                    <button 
                        onClick={() => setShowHistorical(false)} 
                        className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                        <span>← BACK TO LIVE DATA</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 no-scrollbar">
                    {/* --- ML FAILSAFE WARNING BANNER --- */}
                    {showFailsafeWarning && (
                        <div className="bg-red-900/40 border border-red-500 p-3 rounded mb-4 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-red-500 font-bold text-xs font-mono animate-pulse">⚠️ ML DISCREPANCY DETECTED</span>
                            </div>
                            <p className="text-[10px] text-red-200 font-mono leading-tight">
                                Model predicts Kp {mlKp.toFixed(1)}, but raw physical telemetry is a {simScore}% match for a historical Kp {histKp.toFixed(1)} event. Possible ML false negative. <strong className="text-white">Prioritize deterministic physics.</strong>
                            </p>
                        </div>
                    )}

                    {/* Primary Match */}
                    <div className="mb-4 ">
                        <h1 className="text-3xl font-bold font-mono text-green-400 tracking-tighter mb-1">
                            {historicalData.primary_match.similarity_percentage}% MATCH
                        </h1>
                        <h2 className="text-xl font-bold text-white font-mono">{historicalData.primary_match.storm_name}</h2>
                        <p className="text-xs text-gray-400 font-mono mb-3">{historicalData.primary_match.date}</p>
                        
                        <div className="bg-white/5 p-3 border border-white/10 rounded mb-3">
                            <p className="text-[11px] text-gray-300 font-mono leading-relaxed">
                                {historicalData.primary_match.impact_summary}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {historicalData.primary_match.affected_sectors.map(sector => (
                                <span key={sector} className="text-[9px] border border-slate-500 text-slate-300 px-2 py-1 rounded">
                                    {sector}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* parameters of the primary match */}
                    <div className="grid grid-cols-2 gap-4 pr-2 mt-2 mb-4 border-t border-gray-700 pt-3 ">
                        <h3 className="text-l font-bold text-white font-mono col-span-2">Primary match's parameters</h3>

                        {/* Metric: Speed (Incoming Pressure) */}
                        <div className="bg-white/5 p-3 rounded border border-white/10">
                            <div className="text-[10px] text-gray-400 font-mono mb-1">INCOMING SOLAR WIND</div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-white font-mono">
                                    {historicalData.primary_match.avg_speed ? historicalData.primary_match.avg_speed : 0}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">km/s</span>
                            </div>
                        </div>

                        {/* Metric: Density */}
                        <div className="bg-white/5 p-3 rounded border border-white/10">
                            <div className="text-[10px] text-gray-400 font-mono mb-1">PROTON DENSITY</div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-white font-mono">
                                    {historicalData.primary_match.avg_density ? historicalData.primary_match.avg_density : 0}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">p/cm<sup>3</sup></span>
                            </div>
                        </div>
                    
                        {/* Metric: Pressure */}
                        <div className="bg-white/5 p-3 rounded border border-white/10">
                            <div className="text-[10px] text-gray-400 font-mono mb-1">PRESSURE</div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-white font-mono">
                                    {historicalData.primary_match.avg_speed && historicalData.primary_match.avg_density ? (1.6726e-6 * historicalData.primary_match.avg_density * historicalData.primary_match.avg_speed * historicalData.primary_match.avg_speed).toFixed(2) : 0}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">npa</span>
                            </div>
                        </div>

                        {/* Metric: Bz */}
                        <div className="bg-white/5 p-3 rounded border border-white/10">
                            <div className="text-[10px] text-gray-400 font-mono mb-1">INTERPLANETARY MAGNETIC FIELD</div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-bold text-white font-mono">
                                    {historicalData.primary_match.min_bz ? historicalData.primary_match.min_bz : 0}
                                </span>
                                <span className="text-xs text-gray-500 font-mono">nT</span>
                            </div>
                        </div>
                    </div>

                    {/* Comparison List (Scrollable) */}
                    <div className="pr-2 mt-2 border-t border-gray-700 pt-3">
                        <h3 className="text-l font-bold text-white mb-4">Database Comparisons</h3>
                        <div className="flex flex-col gap-2">
                            {historicalData.all_historical_storms.map((storm, idx) => (
                                <div key={idx} className="flex justify-between items-center bg-white/5 p-2 rounded border border-white/10 hover:bg-white/10 transition-colors cursor-default">
                                    <div>
                                        <div className="text-xs text-white font-mono">{storm.storm_name}</div>
                                        <div className="text-[9px] text-gray-500 font-mono">Max Kp: {storm.max_kp.toFixed(1)}</div>
                                    </div>
                                    <div className="text-sm font-bold text-green-400 font-mono">{storm.similarity_percentage}%</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </div>

      {/* ================================================================================== */}
      {/* RIGHT PANEL: GEOSPACE IMPACT SIMULATION (The "Output")                           */}
      {/* ================================================================================== */}
      <div className="absolute top-0 right-0 p-6 z-20 pointer-events-none max-w-sm w-full text-right">
          <div className={`bg-black/80 backdrop-blur-md border-r-4 ${status.borderColor} p-4 shadow-2xl rounded-l-lg `}>
              
              {/* Header: Impact Time */}
              <div className="mb-3 border-b border-gray-700 pb-2 flex flex-col items-end">
                  <h2 className="text-[10px] font-mono font-bold text-gray-400 tracking-widest mb-1">ESTIMATED IMPACT TIME</h2>
                  <h1 className={`text-xl font-mono font-bold ${status.color}`}>
                     {currentData ? new Date(currentData.impact_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "--:--"} <span className="text-xs text-gray-400"></span>
                  </h1>
              </div>

              {/* Status Text */}
              <div className="mb-4">
                  <h1 className={`text-2xl font-black font-mono tracking-tight ${status.color}`}>
                      {status.title}
                  </h1>
                  <p className="text-xs font-mono text-gray-300 mt-1 opacity-80">
                      {status.desc}
                  </p>
              </div>

              {/* Metric: Kp Prediction (The ML Score) */}
            <div className="border-b border-gray-700 pb-4">
              <div className={`bg-white/10 p-3 rounded border ${status.borderColor} relative overflow-hidden`}>
                  <div className={`absolute inset-0 opacity-10 ${status.color.replace('text-', 'bg-')}`}></div>
                  
                  <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] border border-white/20 px-1 rounded text-gray-300">ML MODEL V2</span>
                      <span className="text-[10px] text-cyan-300 font-mono">INTEGRITY SCORE</span>
                  </div>

                  <div className="flex items-baseline justify-end gap-2 relative z-10">
                      <span className={`text-2xl font-bold font-mono ${status.color}`}>
                          Kp Index: {currentData ? currentData.kp_pred : 0}
                      </span>
                  </div>
                  
                  {/* Kp Bar */}
                  <div className="w-full h-1 bg-gray-800 mt-2 rounded-full overflow-hidden relative z-10">
                      <div 
                          className={`h-full transition-all duration-500 ${
                              (currentData?.kp_pred || 0) > 5 ? 'bg-red-500' : 'bg-cyan-400'
                          }`}
                          style={{ width: `${Math.min(100, ((currentData?.kp_pred || 0) / 9) * 100)}%` }}
                      ></div>
                  </div>
              </div>
            </div>
            
            {/* DEFENSE TELEMETRY (Simple & Direct) */}
            <div className="mt-4 bg-black/40 border border-gray-800 rounded p-3">
              <div className="text-xl font-black font-mono tracking-tight text-cyan-400 justify-items-center">
                <h1> GEOSPACE CONDITIONS</h1>
              </div>
                {/* 1. SHIELD COMPRESSION STATUS */}
                {/* Directly explains why the shield might be shrinking */}
                <div className="mt-3 flex justify-between items-center mb-2 border-b border-gray-800 pb-2">
                    <span className="text-[10px] text-gray-400 font-mono">SHIELD INTEGRITY</span>
                    <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            (currentData?.speed * currentData?.density * 1.67e-6) > 4 ? 'bg-red-500 animate-pulse' : 
                            (currentData?.speed * currentData?.density * 1.67e-6) > 2 ? 'bg-orange-400' : 'bg-green-500'
                        }`}></div>
                        <span className={`text-[11px] font-bold font-mono ${
                            (currentData?.speed * currentData?.density * 1.67e-6) > 4 ? 'text-red-500' : 
                            (currentData?.speed * currentData?.density * 1.67e-6) > 2 ? 'text-orange-400' : 'text-green-400'
                        }`}>
                            {(currentData?.speed * currentData?.density * 1.67e-6) > 4 ? "CRITICAL (COMPRESSED)" : 
                            (currentData?.speed * currentData?.density * 1.67e-6) > 2 ? "MODERATE PRESSURE" : "NOMINAL"}
                        </span>
                    </div>
                </div>

                {/* 2. GEOMAGNETIC STORM STATUS */}
                {/* Directly explains the Kp Index Number */}
                <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400 font-mono">STORM LEVEL</span>
                    <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold font-mono ${
                            (currentData?.kp_pred || 0) >= 6 ? 'text-red-500' : 
                            (currentData?.kp_pred || 0) >= 4 ? 'text-yellow-400' : 'text-cyan-400'
                        }`}>
                            {(currentData?.kp_pred || 0) >= 8 ? "G4 (SEVERE)" :
                            (currentData?.kp_pred || 0) >= 6 ? "G2 (MODERATE)" :
                            (currentData?.kp_pred || 0) >= 4 ? "G1 (MINOR)" : "G0 (QUIET)"}
                        </span>
                    </div>
                </div>

            </div>
            {/* HISTORICAL ANALOG TRIGGER BUTTON */}
            <div className="pointer-events-auto">
                <button 
                    onClick={() => {handleViewHistoricalClick();}}
                    className={`mt-4 w-full bg-transparent border border-gray-600 hover:bg-cyan-500/10 hover:border-cyan-400 transition-all py-2 rounded flex items-center justify-center gap-2 ${showHistorical ? 'hidden' : ''}`}
                >
                    <span className="text-xs font-bold font-mono text-cyan-400 tracking-widest">VIEW HISTORICAL ANALOG</span>
                </button>
            </div>

          </div>
      </div>

      {/* ================================================================================== */}
      {/* BOTTOM SLIDER: TIMELINE CONTROL                                                  */}
      {/* ================================================================================== */}
      <div className="absolute bottom-0 w-full p-8 bg-gradient-to-t from-black via-black/80 to-transparent z-10">
         <div className="flex justify-between items-end mb-2 font-mono text-xs">
             <div className="text-gray-500">
                PAST (24h)
             </div>
             
             {/* CENTER LABEL: Shows the IMPACT time, clarifying the visualization */}
             <div className="text-center">
                 <div className="text-gray-400 text-[10px] mb-1">VISUALIZATION TIME</div>
                 <div className="text-xl text-white font-bold">
                    {currentData ? currentData.impact_time.toString().replace("T", " ").split(".")[0] : "LOADING..."}
                 </div>
             </div>

             <div className="text-cyan-400">
                NOW
             </div>
         </div>

         <input 
            type="range" min="0" max={Math.max(0, processedData.length - 1)} step="1"
            value={sliderIndex}
            onChange={handleSliderChange}
            className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-300 transition-all"
         />
      </div>

              
          
      
    </div>
  );
}

export default App;