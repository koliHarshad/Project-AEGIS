import React, { useRef, useEffect } from 'react';
import Globe from 'react-globe.gl';

function App() {
  // 1. Create a reference to the globe so we can control it later (spin/zoom)
  const globeEl = useRef();

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      
      {/* --- LAYER 1: THE 3D SCENE --- */}
      <div className="absolute inset-0 z-0">
        <Globe
          ref={globeEl}
          // The "Skin" (Blue Marble)
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
          
          // The "Texture" (Mountains look 3D)
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          
          // The "Space" (Starfield)
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          
          // The "Glow" (Atmosphere)
          atmosphereColor="#3a228a" // Sci-fi Blue/Purple
          atmosphereAltitude={0.2}  // How high the glow extends
        />
      </div>

      {/* --- LAYER 2: THE UI / HUD --- */}
      <div className="absolute z-10 top-0 left-0 w-full h-full p-6 pointer-events-none flex flex-col justify-between">
        
        {/* Header */}
        <header className="border-l-4 border-cyan-500 pl-4">
          <h1 className="text-4xl text-white font-bold tracking-widest font-mono">
            SOLAR SENTINEL
          </h1>
          <p className="text-cyan-400 text-sm font-mono">
            PLANETARY DEFENSE CONSOLE // v1.0
          </p>
        </header>

        {/* Footer */}
        <footer className="text-gray-500 text-xs font-mono">
          SYSTEM STATUS: ONLINE
        </footer>
      </div>
    </div>
  );
}

export default App;