import { useState, useEffect, useRef, useCallback } from 'react';
import {
  SimulationParams,
  SimulationState,
  DEFAULT_PARAMS,
  createInitialState,
  advanceSimulation,
  computeGainCoefficient,
} from './simulation';

// Color interpolation for heatmap: dark blue -> cyan -> yellow -> red -> white
function energyToColor(energy: number, maxEnergy: number): string {
  const normalized = Math.min(energy / Math.max(maxEnergy, 1e-10), 1.0);
  const t = Math.pow(normalized, 0.5);

  let r: number, g: number, b: number;

  if (t < 0.2) {
    const s = t / 0.2;
    r = Math.floor(5 + 10 * s);
    g = Math.floor(5 + 20 * s);
    b = Math.floor(40 + 120 * s);
  } else if (t < 0.4) {
    const s = (t - 0.2) / 0.2;
    r = Math.floor(15 + 10 * s);
    g = Math.floor(25 + 100 * s);
    b = Math.floor(160 + 95 * s);
  } else if (t < 0.6) {
    const s = (t - 0.4) / 0.2;
    r = Math.floor(25 + 100 * s);
    g = Math.floor(125 + 105 * s);
    b = Math.floor(255 - 55 * s);
  } else if (t < 0.8) {
    const s = (t - 0.6) / 0.2;
    r = Math.floor(125 + 130 * s);
    g = Math.floor(230 - 30 * s);
    b = Math.floor(200 - 150 * s);
  } else {
    const s = (t - 0.8) / 0.2;
    r = 255;
    g = Math.floor(200 + 55 * s);
    b = Math.floor(50 + 205 * s);
  }

  return `rgb(${r},${g},${b})`;
}

// Waveform Canvas Component
function WaveformCanvas({ state, params }: { state: SimulationState; params: SimulationParams }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const N = params.N;

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const y = (i / 10) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#333366';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Find max voltage for scaling
    const maxV = Math.max(...Array.from(state.voltages).map(Math.abs), 0.01);

    // Draw voltage waveform
    ctx.beginPath();
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 4;

    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = h / 2 - (state.voltages[i] / maxV) * (h / 2 - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw energy density as filled area
    ctx.beginPath();
    const maxE = Math.max(...Array.from(state.energies), 1e-10);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = h - (state.energies[i] / maxE) * (h * 0.3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
    ctx.fill();

    // Energy line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 100, 50, 0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * w;
      const y = h - (state.energies[i] / maxE) * (h * 0.3);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Center markers
    const cx1 = (9 / (N - 1)) * w;
    const cx2 = (10 / (N - 1)) * w;
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx1, 0);
    ctx.lineTo(cx1, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx2, 0);
    ctx.lineTo(cx2, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = '#00ffcc';
    ctx.font = '10px monospace';
    ctx.fillText('V(t)', 4, 12);
    ctx.fillStyle = 'rgba(255, 100, 50, 0.8)';
    ctx.fillText('E(t)', 4, h - 4);
    ctx.fillStyle = 'rgba(255, 200, 0, 0.6)';
    ctx.fillText('FOCUS', cx1 - 12, 12);

  }, [state, params]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={200}
      className="w-full h-48 rounded-lg border border-gray-800"
    />
  );
}

export default function App() {
  const [params, setParams] = useState<SimulationParams>({ ...DEFAULT_PARAMS });
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<SimulationState>(() => createInitialState(DEFAULT_PARAMS));
  const [gainCoeff, setGainCoeff] = useState(1.0);
  const [maxEnergyHistory, setMaxEnergyHistory] = useState<{ t: number; e: number }[]>([]);
  const [frameCount, setFrameCount] = useState(0);

  const stateRef = useRef(state);
  const paramsRef = useRef(params);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const runningRef = useRef(isRunning);
  const accumulatorRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  const SIM_DT = 0.003; // Fixed simulation timestep (CFL: dt < 1/ω_max = 0.005)
  const SUB_STEPS = 5;

  const simulationLoop = useCallback(() => {
    if (!runningRef.current) return;

    const now = performance.now();
    const realDt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = now;

    // Accumulate real time, simulate in fixed steps
    accumulatorRef.current += Math.min(realDt, 0.05);

    let currentState = stateRef.current;
    let stepsThisFrame = 0;
    const maxStepsPerFrame = 50;

    while (accumulatorRef.current >= SIM_DT && stepsThisFrame < maxStepsPerFrame) {
      currentState = advanceSimulation(currentState, SIM_DT, paramsRef.current, SUB_STEPS);
      accumulatorRef.current -= SIM_DT;
      stepsThisFrame++;
    }

    if (stepsThisFrame > 0) {
      const gain = computeGainCoefficient(currentState.energies, paramsRef.current.N);
      setState(currentState);
      setGainCoeff(gain);
      stateRef.current = currentState;

      setFrameCount(prev => {
        const newCount = prev + 1;
        // Update history every 5 frames
        if (newCount % 5 === 0) {
          setMaxEnergyHistory(hist => {
            const maxE = Math.max(...Array.from(currentState.energies));
            const newHistory = [...hist, { t: currentState.time, e: maxE }];
            if (newHistory.length > 300) newHistory.shift();
            return newHistory;
          });
        }
        return newCount;
      });
    }

    animFrameRef.current = requestAnimationFrame(simulationLoop);
  }, []);

  useEffect(() => {
    if (isRunning) {
      lastTimeRef.current = performance.now();
      accumulatorRef.current = 0;
      animFrameRef.current = requestAnimationFrame(simulationLoop);
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRunning, simulationLoop]);

  const handleReset = () => {
    setIsRunning(false);
    const newState = createInitialState(params);
    setState(newState);
    setGainCoeff(1.0);
    setMaxEnergyHistory([]);
    setFrameCount(0);
    stateRef.current = newState;
    accumulatorRef.current = 0;
  };

  const handleModeChange = (mode: 'irrational' | 'harmonic') => {
    setParams(prev => ({ ...prev, mode }));
  };

  const localizationActive = gainCoeff > 2.0;
  const maxEnergy = Math.max(...Array.from(state.energies));
  const omega2 = params.mode === 'irrational' ? params.R * params.omega1 : 2.0 * params.omega1;

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-x-hidden">
      {/* Header */}
      <header className="border-b border-gray-800/50 px-4 sm:px-6 py-3 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⚡ LC-Chain EM Simulator
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
              Discrete electromagnetic line • Irrational spectral pumping • Energy localization
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`hidden sm:block px-2 py-1 rounded text-[10px] font-bold ${
              isRunning ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
            }`}>
              {isRunning ? '● RUNNING' : '○ STOPPED'}
            </div>
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-bold text-xs transition-all ${
                isRunning
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-black shadow-lg shadow-yellow-600/20'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20'
              }`}
            >
              {isRunning ? '⏸ Pause' : '▶ Start'}
            </button>
            <button
              onClick={handleReset}
              className="px-3 sm:px-4 py-2 rounded-lg font-bold text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all"
            >
              ↺ Reset
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Waveform Visualization */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Voltage & Energy Waveform
            </h2>
            <span className="text-[10px] text-gray-600">
              t = {state.time.toFixed(3)}s
            </span>
          </div>
          <WaveformCanvas state={state} params={params} />
        </section>

        {/* Node Visualization */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            Electromagnetic Profile — {params.N} Nodes
          </h2>

          <div className="relative overflow-x-auto">
            {/* Nodes */}
            <div className="relative flex items-end justify-between gap-0.5 px-2 py-4 min-w-[600px]">
              {Array.from(state.voltages).map((_, i) => {
                const isCenter = i === 9 || i === 10;
                const isEdge = i <= 2 || i >= params.N - 3;
                const energy = state.energies[i];
                const color = energyToColor(energy, maxEnergy);
                const barHeight = 10 + (energy / Math.max(maxEnergy, 1e-10)) * 120;

                return (
                  <div key={i} className="flex flex-col items-center flex-1">
                    {/* Energy bar */}
                    <div
                      className="w-full max-w-[28px] rounded-t transition-all duration-100"
                      style={{
                        height: `${barHeight}px`,
                        backgroundColor: color,
                        boxShadow: energy / maxEnergy > 0.5
                          ? `0 0 ${8 + 20 * (energy / maxEnergy)}px ${color}`
                          : 'none',
                      }}
                    />
                    {/* Node dot */}
                    <div
                      className={`w-3 h-3 rounded-full mt-1 transition-all duration-100 ${
                        isCenter ? 'ring-2 ring-yellow-400/60' : ''
                      }`}
                      style={{
                        backgroundColor: color,
                        boxShadow: energy / maxEnergy > 0.7
                          ? `0 0 12px ${color}`
                          : 'none',
                      }}
                    />
                    {/* Label */}
                    <span className={`text-[8px] mt-0.5 ${
                      isCenter ? 'text-yellow-400 font-bold' :
                      isEdge ? 'text-purple-400' : 'text-gray-600'
                    }`}>
                      {i}
                    </span>
                    {isCenter && (
                      <span className="text-[7px] text-yellow-500 font-bold">▼</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Boundary labels */}
            <div className="flex justify-between px-2 mt-1 min-w-[600px]">
              <div className="text-[9px] text-cyan-500 font-bold">
                ◀ L-PUMP
              </div>
              <div className="text-[9px] text-yellow-500 font-bold">
                ▼ FOCUS ZONE
              </div>
              <div className="text-[9px] text-purple-500 font-bold">
                R-PUMP ▶
              </div>
            </div>
          </div>

          {/* Heatmap strip */}
          <div className="mt-4">
            <div className="text-[9px] text-gray-500 mb-1">Energy Density Heatmap</div>
            <div className="flex h-6 rounded overflow-hidden border border-gray-800/50">
              {Array.from(state.energies).map((e, i) => (
                <div
                  key={i}
                  className="flex-1 transition-colors duration-100"
                  style={{ backgroundColor: energyToColor(e, maxEnergy) }}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Controls and Dashboard */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Control Panel */}
          <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
              ⚙ Control Panel
            </h2>

            <div className="space-y-4">
              {/* Frequency slider */}
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Base Frequency ω₁</span>
                  <span className="text-cyan-400 font-bold">{params.omega1.toFixed(1)} rad/s</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="0.5"
                  value={params.omega1}
                  onChange={(e) => setParams(prev => ({ ...prev, omega1: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                  <span>5 rad/s</span>
                  <span>100 rad/s</span>
                </div>
              </div>

              {/* Mode toggle */}
              <div>
                <label className="text-xs text-gray-400 mb-2 block">Pumping Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleModeChange('irrational')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                      params.mode === 'irrational'
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600 shadow-lg shadow-cyan-900/30'
                        : 'bg-gray-900 text-gray-500 border-gray-700 hover:bg-gray-800'
                    }`}
                  >
                    <div>⚡ Irrational</div>
                    <div className="text-[9px] opacity-70 mt-0.5">R = 1.47548...</div>
                  </button>
                  <button
                    onClick={() => handleModeChange('harmonic')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                      params.mode === 'harmonic'
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600 shadow-lg shadow-purple-900/30'
                        : 'bg-gray-900 text-gray-500 border-gray-700 hover:bg-gray-800'
                    }`}
                  >
                    <div>∿ Harmonic</div>
                    <div className="text-[9px] opacity-70 mt-0.5">R = 2.0</div>
                  </button>
                </div>
                <div className="text-[9px] text-gray-600 mt-2 bg-gray-900/50 rounded px-2 py-1">
                  ω₂ = <span className="text-gray-300">{omega2.toFixed(2)}</span> rad/s
                  {params.mode === 'irrational' && (
                    <span className="text-cyan-600 ml-2">• ω₂/ω₁ = {params.R} (irrational)</span>
                  )}
                  {params.mode === 'harmonic' && (
                    <span className="text-purple-600 ml-2">• ω₂/ω₁ = 2.0 (rational)</span>
                  )}
                </div>
              </div>

              {/* Dissipation slider */}
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Dissipation G</span>
                  <span className="text-orange-400 font-bold">{params.G.toFixed(3)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.001"
                  value={params.G}
                  onChange={(e) => setParams(prev => ({ ...prev, G: parseFloat(e.target.value) }))}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
                  <span>0 (lossless)</span>
                  <span>0.5 (heavy loss)</span>
                </div>
              </div>

              {/* Amplitude slider */}
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Pump Amplitude A</span>
                  <span className="text-green-400 font-bold">{params.amplitude.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="3.0"
                  step="0.05"
                  value={params.amplitude}
                  onChange={(e) => setParams(prev => ({ ...prev, amplitude: parseFloat(e.target.value) }))}
                  className="w-full"
                />
              </div>

              {/* System parameters */}
              <div className="bg-gray-900/50 rounded-lg p-3 text-[10px] text-gray-500 space-y-1.5 border border-gray-800/30">
                <div className="text-gray-400 font-bold mb-1">System Parameters</div>
                <div className="flex justify-between"><span>Nodes N</span><span className="text-gray-300">{params.N}</span></div>
                <div className="flex justify-between"><span>Inductance L</span><span className="text-gray-300">{params.L} H</span></div>
                <div className="flex justify-between"><span>Capacitance C</span><span className="text-gray-300">{params.C} F</span></div>
                <div className="flex justify-between"><span>Wave speed c = 1/√(LC)</span><span className="text-gray-300">{(1 / Math.sqrt(params.L * params.C)).toFixed(3)}</span></div>
                <div className="flex justify-between"><span>Integration</span><span className="text-gray-300">RK4, dt={SIM_DT}</span></div>
              </div>
            </div>
          </section>

          {/* Analytics Dashboard */}
          <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
              📊 Analytics Dashboard
            </h2>

            {/* Gain coefficient */}
            <div className="mb-4">
              <div className="text-[10px] text-gray-500 mb-1">Gain Coefficient K_gain = E_center / E_edge</div>
              <div className="flex items-end gap-2">
                <span className={`text-5xl font-black tabular-nums ${
                  localizationActive ? 'text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-yellow-400' : 'text-gray-500'
                }`}>
                  {gainCoeff.toFixed(2)}
                </span>
                <span className="text-xs text-gray-600 pb-2">×</span>
              </div>

              {/* Status indicator */}
              <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                localizationActive
                  ? 'bg-gradient-to-r from-red-900/50 to-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                  : 'bg-gray-900/50 text-gray-500 border border-gray-800/50'
              }`}>
                {localizationActive ? (
                  <>
                    <span className="animate-pulse">⚡</span>
                    <span>LOCALIZATION ACTIVE — Energy concentrated at center nodes</span>
                  </>
                ) : (
                  <>
                    <span>○</span>
                    <span>No significant localization — energy distributed uniformly</span>
                  </>
                )}
              </div>
            </div>

            {/* Energy metrics */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Center Energy (i=9,10)</div>
                <div className="text-base font-bold text-yellow-400 tabular-nums">
                  {Math.max(state.energies[9], state.energies[10]).toExponential(2)}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Max Energy (any node)</div>
                <div className="text-base font-bold text-red-400 tabular-nums">
                  {maxEnergy.toExponential(2)}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Total Energy ΣEᵢ</div>
                <div className="text-base font-bold text-cyan-400 tabular-nums">
                  {Array.from(state.energies).reduce((a, b) => a + b, 0).toExponential(2)}
                </div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Avg Edge Energy</div>
                <div className="text-base font-bold text-purple-400 tabular-nums">
                  {(() => {
                    const edgeNodes = [0, 1, 2, params.N - 3, params.N - 2, params.N - 1];
                    const avg = edgeNodes.reduce((s, i) => s + state.energies[i], 0) / edgeNodes.length;
                    return avg.toExponential(2);
                  })()}
                </div>
              </div>
            </div>

            {/* Energy history chart */}
            <div>
              <div className="text-[9px] text-gray-500 mb-1">Max Energy vs Time</div>
              <div className="bg-gray-900/50 rounded-lg p-2 h-28 relative overflow-hidden border border-gray-800/30">
                {maxEnergyHistory.length > 2 ? (
                  <svg className="w-full h-full" viewBox={`0 0 ${maxEnergyHistory.length} 100`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(239, 68, 68, 0.4)" />
                        <stop offset="100%" stopColor="rgba(239, 68, 68, 0.0)" />
                      </linearGradient>
                    </defs>
                    <polyline
                      fill="url(#energyGrad)"
                      stroke="none"
                      points={`0,100 ${maxEnergyHistory.map((item, i) => {
                        const maxH = Math.max(...maxEnergyHistory.map(h => h.e), 1e-10);
                        const y = 100 - (item.e / maxH) * 90;
                        return `${i},${y}`;
                      }).join(' ')} ${maxEnergyHistory.length - 1},100`}
                    />
                    <polyline
                      fill="none"
                      stroke="rgb(239, 68, 68)"
                      strokeWidth="1.5"
                      points={maxEnergyHistory.map((item, i) => {
                        const maxH = Math.max(...maxEnergyHistory.map(h => h.e), 1e-10);
                        const y = 100 - (item.e / maxH) * 90;
                        return `${i},${y}`;
                      }).join(' ')}
                    />
                  </svg>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-xs">
                    Start simulation to see energy evolution
                  </div>
                )}
              </div>
            </div>

            {/* Node energy distribution */}
            <div className="mt-3">
              <div className="text-[9px] text-gray-500 mb-1">Energy Distribution</div>
              <div className="flex items-end gap-px h-14 bg-gray-900/50 rounded-lg p-1.5 border border-gray-800/30">
                {Array.from(state.energies).map((e, i) => {
                  const h = (e / Math.max(maxEnergy, 1e-10)) * 100;
                  const isCenter = i === 9 || i === 10;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm transition-all duration-100"
                      style={{
                        height: `${Math.max(h, 3)}%`,
                        backgroundColor: isCenter ? '#fbbf24' : energyToColor(e, maxEnergy),
                        boxShadow: isCenter && h > 50 ? '0 0 6px #fbbf24' : 'none',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {/* Physics Model Info */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            📐 Physics Model
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-400">
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-cyan-400 font-bold mb-1.5 text-[11px]">Discrete Telegraph Equation</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                C·dVᵢ/dt = (Vᵢ₋₁ − Vᵢ)/L<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ (Vᵢ₊₁ − Vᵢ)/L − G·Vᵢ
              </div>
              <div className="mt-2 text-[9px] text-gray-600">
                Internal nodes i = 1...N−2
              </div>
            </div>
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-purple-400 font-bold mb-1.5 text-[11px]">Boundary Pumping (anti-phase)</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                V₀(t) = (A/2)·[sin(ω₁t) + sin(ω₂t)]<br/>
                V_{`N−1`}(t) = (A/2)·[sin(ω₁t+π)<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ sin(ω₂t+π)]
              </div>
              <div className="mt-2 text-[9px] text-gray-600">
                Dual-frequency drive from both ends
              </div>
            </div>
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-yellow-400 font-bold mb-1.5 text-[11px]">Irrational Frequency Ratio</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                ω₂/ω₁ = R<br/>
                &nbsp;&nbsp;= 1.475482818459...
              </div>
              <div className="mt-2 text-[9px] text-gray-600">
                Non-periodic interference → constructive accumulation at center via quasi-phase-matching
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800/30 px-6 py-3 mt-4">
        <div className="max-w-7xl mx-auto text-[10px] text-gray-700 text-center">
          LC-Chain Electromagnetic Simulator • RK4 Integration • {params.N}-node discrete line • Real-time visualization
        </div>
      </footer>
    </div>
  );
}
