import { useState, useEffect, useRef, useCallback } from 'react';
import {
  SimulationParams,
  SimulationState,
  DEFAULT_PARAMS,
  createInitialState,
  advanceSimulation,
  computeGainCoefficient,
  safeMax,
  omegaToGHz,
  checkMatterDestruction,
} from './simulation';
import CollisionView from './CollisionView';
import PeakComparison from './PeakComparison';

// ─── Color mapping ───────────────────────────────────────────────────────────

function energyToColor(energy: number, maxEnergy: number): string {
  if (!Number.isFinite(energy) || !Number.isFinite(maxEnergy) || maxEnergy <= 0) return 'rgb(5,5,40)';
  const t = Math.min(Math.pow(energy / maxEnergy, 0.5), 1.0);
  let r: number, g: number, b: number;
  if (t < 0.2) { const s = t / 0.2; r = 5 + 10 * s; g = 5 + 20 * s; b = 40 + 120 * s; }
  else if (t < 0.4) { const s = (t - 0.2) / 0.2; r = 15 + 10 * s; g = 25 + 100 * s; b = 160 + 95 * s; }
  else if (t < 0.6) { const s = (t - 0.4) / 0.2; r = 25 + 100 * s; g = 125 + 105 * s; b = 255 - 55 * s; }
  else if (t < 0.8) { const s = (t - 0.6) / 0.2; r = 125 + 130 * s; g = 230 - 30 * s; b = 200 - 150 * s; }
  else { const s = (t - 0.8) / 0.2; r = 255; g = 200 + 55 * s; b = 50 + 205 * s; }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function fmtSci(v: number): string { return Number.isFinite(v) ? v.toExponential(2) : '0.00e+0'; }
function fmtFixed(v: number, d = 2): string { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

// ─── Constants ───────────────────────────────────────────────────────────────

const SIM_DT = 0.003;
const SUB_STEPS = 5;

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  // Separate params for each simulation
  const [irrParams, setIrrParams] = useState<SimulationParams>({
    ...DEFAULT_PARAMS,
    mode: 'irrational',
    leftFreq1Enabled: true,
    leftFreq2Enabled: true,
    rightFreq1Enabled: true,
    rightFreq2Enabled: true,
  });
  const [harmParams, setHarmParams] = useState<SimulationParams>({
    ...DEFAULT_PARAMS,
    mode: 'harmonic',
    leftFreq1Enabled: true,
    leftFreq2Enabled: true,
    rightFreq1Enabled: true,
    rightFreq2Enabled: true,
  });

  const [isRunning, setIsRunning] = useState(false);

  // Two parallel simulations
  const [irrState, setIrrState] = useState<SimulationState>(() =>
    createInitialState(irrParams)
  );
  const [harmState, setHarmState] = useState<SimulationState>(() =>
    createInitialState(harmParams)
  );

  const [irrGain, setIrrGain] = useState(1.0);
  const [harmGain, setHarmGain] = useState(1.0);

  // Peak tracking histories
  const [irrPeakHistory, setIrrPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [harmPeakHistory, setHarmPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [irrMaxPeak, setIrrMaxPeak] = useState(0);
  const [harmMaxPeak, setHarmMaxPeak] = useState(0);
  
  // Matter destruction tracking
  const [irrDestructionReached, setIrrDestructionReached] = useState(false);
  const [harmDestructionReached, setHarmDestructionReached] = useState(false);

  const irrStateRef = useRef(irrState);
  const harmStateRef = useRef(harmState);
  const irrParamsRef = useRef(irrParams);
  const harmParamsRef = useRef(harmParams);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const runningRef = useRef(isRunning);
  const accumulatorRef = useRef(0);
  const frameTickRef = useRef(0);

  useEffect(() => { irrStateRef.current = irrState; }, [irrState]);
  useEffect(() => { harmStateRef.current = harmState; }, [harmState]);
  useEffect(() => { irrParamsRef.current = irrParams; }, [irrParams]);
  useEffect(() => { harmParamsRef.current = harmParams; }, [harmParams]);
  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  // Get center peak energy for a state
  const getCenterPeak = (state: SimulationState, N: number): number => {
    const cIdx1 = Math.floor(N / 2) - 1;
    const cIdx2 = Math.floor(N / 2);
    return Math.max(
      Number.isFinite(state.energies[cIdx1]) ? state.energies[cIdx1] : 0,
      Number.isFinite(state.energies[cIdx2]) ? state.energies[cIdx2] : 0
    );
  };

  const simulationLoop = useCallback(() => {
    if (!runningRef.current) return;

    const now = performance.now();
    const realDt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = now;
    accumulatorRef.current += Math.min(realDt, 0.05);

    let irrCurrent = irrStateRef.current;
    let harmCurrent = harmStateRef.current;
    let stepsThisFrame = 0;
    const maxStepsPerFrame = 50;

    while (accumulatorRef.current >= SIM_DT && stepsThisFrame < maxStepsPerFrame) {
      irrCurrent = advanceSimulation(irrCurrent, SIM_DT, irrParamsRef.current, SUB_STEPS);
      harmCurrent = advanceSimulation(harmCurrent, SIM_DT, harmParamsRef.current, SUB_STEPS);
      accumulatorRef.current -= SIM_DT;
      stepsThisFrame++;
    }

    if (stepsThisFrame > 0) {
      const irrG = computeGainCoefficient(irrCurrent.energies, irrParamsRef.current.N);
      const harmG = computeGainCoefficient(harmCurrent.energies, harmParamsRef.current.N);
      setIrrState(irrCurrent);
      setHarmState(harmCurrent);
      setIrrGain(Number.isFinite(irrG) ? irrG : 1.0);
      setHarmGain(Number.isFinite(harmG) ? harmG : 1.0);
      irrStateRef.current = irrCurrent;
      harmStateRef.current = harmCurrent;

      frameTickRef.current++;
      if (frameTickRef.current % 5 === 0) {
        const irrPeak = getCenterPeak(irrCurrent, irrParamsRef.current.N);
        const harmPeak = getCenterPeak(harmCurrent, harmParamsRef.current.N);

        setIrrPeakHistory(hist => {
          const next = [...hist, { t: irrCurrent.time, peak: irrPeak }];
          if (next.length > 500) next.shift();
          return next;
        });
        setHarmPeakHistory(hist => {
          const next = [...hist, { t: harmCurrent.time, peak: harmPeak }];
          if (next.length > 500) next.shift();
          return next;
        });

        setIrrMaxPeak(prev => Math.max(prev, irrPeak));
        setHarmMaxPeak(prev => Math.max(prev, harmPeak));
        
        // Check matter destruction threshold
        const irrDestruction = checkMatterDestruction(irrCurrent.energies, irrParamsRef.current.criticalEnergy || 100.0);
        const harmDestruction = checkMatterDestruction(harmCurrent.energies, harmParamsRef.current.criticalEnergy || 100.0);
        if (irrDestruction.reached && !irrDestructionReached) {
          setIrrDestructionReached(true);
        }
        if (harmDestruction.reached && !harmDestructionReached) {
          setHarmDestructionReached(true);
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(simulationLoop);
  }, [irrDestructionReached, harmDestructionReached]);

  useEffect(() => {
    if (isRunning) {
      lastTimeRef.current = performance.now();
      accumulatorRef.current = 0;
      animFrameRef.current = requestAnimationFrame(simulationLoop);
    } else {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isRunning, simulationLoop]);

  const handleReset = () => {
    setIsRunning(false);
    // Reset both simulations with all frequencies enabled
    const resetIrr = { ...irrParams, leftFreq1Enabled: true, leftFreq2Enabled: true, rightFreq1Enabled: true, rightFreq2Enabled: true };
    const resetHarm = { ...harmParams, leftFreq1Enabled: true, leftFreq2Enabled: true, rightFreq1Enabled: true, rightFreq2Enabled: true };
    setIrrParams(resetIrr);
    setHarmParams(resetHarm);
    
    const irrNew = createInitialState(resetIrr);
    const harmNew = createInitialState(resetHarm);
    setIrrState(irrNew);
    setHarmState(harmNew);
    setIrrGain(1.0);
    setHarmGain(1.0);
    setIrrPeakHistory([]);
    setHarmPeakHistory([]);
    setIrrMaxPeak(0);
    setHarmMaxPeak(0);
    setIrrDestructionReached(false);
    setHarmDestructionReached(false);
    frameTickRef.current = 0;
    irrStateRef.current = irrNew;
    harmStateRef.current = harmNew;
    accumulatorRef.current = 0;
  };

  const irrOmega2 = irrParams.R * irrParams.omega1;
  const harmOmega2 = harmParams.R * harmParams.omega1;

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-hidden">
      {/* ── Header ── */}
      <header className="border-b border-gray-800/50 px-4 py-2 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⚡ LC-Chain: Irrational vs Harmonic — Peak Comparison
            </h1>
            <p className="text-[9px] text-gray-500 mt-0.5">
              Independent frequency control for each source on each simulation
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`hidden sm:block px-2 py-1 rounded text-[10px] font-bold ${
              isRunning ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
            }`}>{isRunning ? '● RUNNING' : '○ STOPPED'}</div>
            <button onClick={() => setIsRunning(!isRunning)}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                isRunning ? 'bg-yellow-600 hover:bg-yellow-500 text-black' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}>{isRunning ? '⏸ Pause' : '▶ Start'}</button>
            <button onClick={handleReset}
              className="px-3 py-1.5 rounded-lg font-bold text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700">↺ Reset</button>
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-4 py-3 space-y-3">
        {/* ── Collision Views side by side ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Irrational */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-cyan-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-cyan-400">
                ⚡ IRRATIONAL — R = {irrParams.R}
              </h2>
              <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                irrGain > 1.5 ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-800 text-gray-500'
              }`}>
                K = {fmtFixed(irrGain, 2)}×
              </div>
            </div>
            
            {/* Frequency controls for Irrational */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <div className="text-[9px] text-cyan-400 font-bold mb-1">LEFT SOURCE</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, leftFreq1Enabled: !p.leftFreq1Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      irrParams.leftFreq1Enabled !== false
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₁ {fmtFixed(omegaToGHz(irrParams.omega1), 1)}GHz
                  </button>
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, leftFreq2Enabled: !p.leftFreq2Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      irrParams.leftFreq2Enabled !== false
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₂ {fmtFixed(omegaToGHz(irrOmega2), 1)}GHz
                  </button>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <div className="text-[9px] text-cyan-400 font-bold mb-1">RIGHT SOURCE</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, rightFreq1Enabled: !p.rightFreq1Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      irrParams.rightFreq1Enabled !== false
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₁ {fmtFixed(omegaToGHz(irrParams.omega1), 1)}GHz
                  </button>
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, rightFreq2Enabled: !p.rightFreq2Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      irrParams.rightFreq2Enabled !== false
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₂ {fmtFixed(omegaToGHz(irrOmega2), 1)}GHz
                  </button>
                </div>
              </div>
            </div>

            {/* Geometry & Nonlinear controls for Irrational */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <div className="text-[9px] text-cyan-400 font-bold mb-1">GEOMETRY</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, geometry: 'linear' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      irrParams.geometry === 'linear'
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    LINEAR
                  </button>
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, geometry: 'cylindrical' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      irrParams.geometry === 'cylindrical'
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    CYL
                  </button>
                  <button
                    onClick={() => setIrrParams(p => ({ ...p, geometry: 'spherical' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      irrParams.geometry === 'spherical'
                        ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    SPH
                  </button>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <div className="text-[9px] text-cyan-400 font-bold mb-1">NONLINEAR η</div>
                <button
                  onClick={() => setIrrParams(p => ({ ...p, nonlinearViscosity: !p.nonlinearViscosity }))}
                  className={`w-full px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                    irrParams.nonlinearViscosity
                      ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600'
                      : 'bg-gray-900 text-gray-600 border-gray-700'
                  }`}
                >
                  {irrParams.nonlinearViscosity ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <div className="text-[9px] text-cyan-400 font-bold mb-1">CRITICAL E</div>
                <input
                  type="number"
                  value={irrParams.criticalEnergy || 100}
                  onChange={(e) => setIrrParams(p => ({ ...p, criticalEnergy: parseFloat(e.target.value) || 100 }))}
                  className="w-full px-1 py-1 rounded text-[9px] bg-gray-900 text-cyan-300 border border-gray-700"
                  step="10"
                  min="1"
                />
              </div>
            </div>

            {/* Matter destruction indicator for Irrational */}
            {irrDestructionReached && (
              <div className="mb-2 px-3 py-2 rounded-lg bg-red-900/50 border-2 border-red-500 text-red-300 text-[10px] font-bold animate-pulse">
                💥 MATTER DESTRUCTION THRESHOLD REACHED — Energy exceeded critical limit!
              </div>
            )}

            <CollisionView vRight={irrState.vRight} vLeft={irrState.vLeft} N={irrParams.N} time={irrState.time} />
          </section>

          {/* Harmonic */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-purple-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-purple-400">
                ∿ HARMONIC — R = 2.0
              </h2>
              <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                harmGain > 1.5 ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-800 text-gray-500'
              }`}>
                K = {fmtFixed(harmGain, 2)}×
              </div>
            </div>

            {/* Frequency controls for Harmonic */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <div className="text-[9px] text-purple-400 font-bold mb-1">LEFT SOURCE</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, leftFreq1Enabled: !p.leftFreq1Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      harmParams.leftFreq1Enabled !== false
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₁ {fmtFixed(omegaToGHz(harmParams.omega1), 1)}GHz
                  </button>
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, leftFreq2Enabled: !p.leftFreq2Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      harmParams.leftFreq2Enabled !== false
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₂ {fmtFixed(omegaToGHz(harmOmega2), 1)}GHz
                  </button>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <div className="text-[9px] text-purple-400 font-bold mb-1">RIGHT SOURCE</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, rightFreq1Enabled: !p.rightFreq1Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      harmParams.rightFreq1Enabled !== false
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₁ {fmtFixed(omegaToGHz(harmParams.omega1), 1)}GHz
                  </button>
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, rightFreq2Enabled: !p.rightFreq2Enabled }))}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                      harmParams.rightFreq2Enabled !== false
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    f₂ {fmtFixed(omegaToGHz(harmOmega2), 1)}GHz
                  </button>
                </div>
              </div>
            </div>

            {/* Geometry & Nonlinear controls for Harmonic */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <div className="text-[9px] text-purple-400 font-bold mb-1">GEOMETRY</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, geometry: 'linear' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      harmParams.geometry === 'linear'
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    LINEAR
                  </button>
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, geometry: 'cylindrical' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      harmParams.geometry === 'cylindrical'
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    CYL
                  </button>
                  <button
                    onClick={() => setHarmParams(p => ({ ...p, geometry: 'spherical' }))}
                    className={`flex-1 px-1 py-1 rounded text-[8px] font-bold transition-all border ${
                      harmParams.geometry === 'spherical'
                        ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                        : 'bg-gray-900 text-gray-600 border-gray-700'
                    }`}
                  >
                    SPH
                  </button>
                </div>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <div className="text-[9px] text-purple-400 font-bold mb-1">NONLINEAR η</div>
                <button
                  onClick={() => setHarmParams(p => ({ ...p, nonlinearViscosity: !p.nonlinearViscosity }))}
                  className={`w-full px-1 py-1 rounded text-[9px] font-bold transition-all border ${
                    harmParams.nonlinearViscosity
                      ? 'bg-purple-900/50 text-purple-300 border-purple-600'
                      : 'bg-gray-900 text-gray-600 border-gray-700'
                  }`}
                >
                  {harmParams.nonlinearViscosity ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <div className="text-[9px] text-purple-400 font-bold mb-1">CRITICAL E</div>
                <input
                  type="number"
                  value={harmParams.criticalEnergy || 100}
                  onChange={(e) => setHarmParams(p => ({ ...p, criticalEnergy: parseFloat(e.target.value) || 100 }))}
                  className="w-full px-1 py-1 rounded text-[9px] bg-gray-900 text-purple-300 border border-gray-700"
                  step="10"
                  min="1"
                />
              </div>
            </div>

            {/* Matter destruction indicator for Harmonic */}
            {harmDestructionReached && (
              <div className="mb-2 px-3 py-2 rounded-lg bg-red-900/50 border-2 border-red-500 text-red-300 text-[10px] font-bold animate-pulse">
                💥 MATTER DESTRUCTION THRESHOLD REACHED — Energy exceeded critical limit!
              </div>
            )}

            <CollisionView vRight={harmState.vRight} vLeft={harmState.vLeft} N={harmParams.N} time={harmState.time} />
          </section>
        </div>

        {/* ── Peak Comparison ── */}
        <section className="bg-[#0a0a1a] rounded-lg border-2 border-yellow-900/50 p-3 shadow-2xl shadow-yellow-900/20">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-yellow-400">
              📊 Center Peak Comparison — Who Creates Higher Peaks?
            </h2>
            {(() => {
              const ratio = harmMaxPeak > 1e-15 ? irrMaxPeak / harmMaxPeak : 1;
              const irrWins = ratio > 1.2;
              const harmWins = ratio < 0.8;
              return (
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  irrWins ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700' :
                  harmWins ? 'bg-purple-900/50 text-purple-300 border border-purple-700' :
                  'bg-gray-800 text-gray-400 border border-gray-700'
                }`}>
                  {irrWins ? `⚡ IRRATIONAL WINS — ${fmtFixed(ratio, 2)}× higher` :
                   harmWins ? `∿ HARMONIC WINS — ${fmtFixed(1/ratio, 2)}× higher` :
                   `○ TIED — ${fmtFixed(ratio, 2)}×`}
                </div>
              );
            })()}
          </div>
          <p className="text-[10px] text-gray-500 mb-2">
            <span className="text-cyan-400 font-bold">Cyan</span> = max peak energy at center (irrational) &nbsp;|&nbsp;
            <span className="text-purple-400 font-bold">Purple</span> = max peak energy at center (harmonic)<br/>
            Higher curve = stronger energy concentration at center nodes
          </p>
          <PeakComparison
            irrHistory={irrPeakHistory}
            harmHistory={harmPeakHistory}
            irrMax={irrMaxPeak}
            harmMax={harmMaxPeak}
            height={200}
          />
          <div className="grid grid-cols-4 gap-2 mt-2 text-[10px]">
            <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
              <span className="text-gray-500">Irr Peak (current)</span>
              <span className="text-cyan-400 font-bold ml-1">
                {irrPeakHistory.length > 0 ? fmtSci(irrPeakHistory[irrPeakHistory.length - 1].peak) : '0.00e+0'}
              </span>
            </div>
            <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
              <span className="text-gray-500">Irr Peak (max)</span>
              <span className="text-cyan-400 font-bold ml-1">{fmtSci(irrMaxPeak)}</span>
            </div>
            <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
              <span className="text-gray-500">Harm Peak (current)</span>
              <span className="text-purple-400 font-bold ml-1">
                {harmPeakHistory.length > 0 ? fmtSci(harmPeakHistory[harmPeakHistory.length - 1].peak) : '0.00e+0'}
              </span>
            </div>
            <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
              <span className="text-gray-500">Harm Peak (max)</span>
              <span className="text-purple-400 font-bold ml-1">{fmtSci(harmMaxPeak)}</span>
            </div>
          </div>
        </section>

        {/* ── Energy Profile bars ── */}
        <div className="grid grid-cols-2 gap-3">
          <section className="bg-[#0a0a1a] rounded-lg border border-cyan-900/30 p-2">
            <h3 className="text-[9px] font-bold text-cyan-400 mb-1">Energy Profile — Irrational</h3>
            <div className="flex items-end gap-px h-16 bg-gray-900/50 rounded p-1 border border-gray-800/30">
              {Array.from(irrState.energies).map((e, i) => {
                const N = irrParams.N;
                const cIdx1 = Math.floor(N / 2) - 1;
                const cIdx2 = Math.floor(N / 2);
                const energy = Number.isFinite(e) ? e : 0;
                const maxE = safeMax(irrState.energies);
                const h = (energy / Math.max(maxE, 1e-10)) * 100;
                const isCenter = i === cIdx1 || i === cIdx2;
                return <div key={i} className="flex-1 rounded-t-sm transition-all duration-100"
                  style={{ height: `${Math.max(h, 2)}%`, backgroundColor: isCenter ? '#fbbf24' : energyToColor(energy, maxE) }} />;
              })}
            </div>
          </section>
          <section className="bg-[#0a0a1a] rounded-lg border border-purple-900/30 p-2">
            <h3 className="text-[9px] font-bold text-purple-400 mb-1">Energy Profile — Harmonic</h3>
            <div className="flex items-end gap-px h-16 bg-gray-900/50 rounded p-1 border border-gray-800/30">
              {Array.from(harmState.energies).map((e, i) => {
                const N = harmParams.N;
                const cIdx1 = Math.floor(N / 2) - 1;
                const cIdx2 = Math.floor(N / 2);
                const energy = Number.isFinite(e) ? e : 0;
                const maxE = safeMax(harmState.energies);
                const h = (energy / Math.max(maxE, 1e-10)) * 100;
                const isCenter = i === cIdx1 || i === cIdx2;
                return <div key={i} className="flex-1 rounded-t-sm transition-all duration-100"
                  style={{ height: `${Math.max(h, 2)}%`, backgroundColor: isCenter ? '#fbbf24' : energyToColor(energy, maxE) }} />;
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
