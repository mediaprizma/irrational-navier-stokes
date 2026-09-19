import { useState, useEffect, useRef, useCallback } from 'react';
import {
  SimulationParams,
  SimulationState,
  DEFAULT_PARAMS,
  createInitialState,
  advanceSimulation,
  getCenterPeak,
  omegaToGHz,
} from './simulation';
import CollisionView from './CollisionView';
import PeakComparisonChart from './PeakComparisonChart';

function fmtSci(v: number): string { return Number.isFinite(v) ? v.toExponential(2) : '0.00e+0'; }
function fmtFixed(v: number, d = 2): string { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

const SIM_DT = 0.003;
const SUB_STEPS = 5;

export default function App() {
  // Irrational: R = 1.475482818459
  const [irrParams, setIrrParams] = useState<SimulationParams>({
    N: 160,
    L: 0.01,
    C: 0.01,
    G: 0.0,
    omega1: 31.0,
    R: 1.475482818459,
    amplitude: 5.0,
    mode: 'irrational',
  });
  
  // Harmonic: R = 2.0
  const [harmParams, setHarmParams] = useState<SimulationParams>({
    N: 160,
    L: 0.01,
    C: 0.01,
    G: 0.0,
    omega1: 31.0,
    R: 2.0,
    amplitude: 5.0,
    mode: 'harmonic',
  });

  const [isRunning, setIsRunning] = useState(false);
  const [irrState, setIrrState] = useState<SimulationState>(() => createInitialState(irrParams));
  const [harmState, setHarmState] = useState<SimulationState>(() => createInitialState(harmParams));
  
  const [irrPeakHistory, setIrrPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [harmPeakHistory, setHarmPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [irrMaxPeak, setIrrMaxPeak] = useState(0);
  const [harmMaxPeak, setHarmMaxPeak] = useState(0);

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
      setIrrState(irrCurrent);
      setHarmState(harmCurrent);
      irrStateRef.current = irrCurrent;
      harmStateRef.current = harmCurrent;

      frameTickRef.current++;
      if (frameTickRef.current % 5 === 0) {
        const irrPeak = getCenterPeak(irrCurrent);
        const harmPeak = getCenterPeak(harmCurrent);

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
      }
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
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isRunning, simulationLoop]);

  const handleReset = () => {
    setIsRunning(false);
    const resetIrr = { ...irrParams, N: 160, G: 0.0, omega1: 31.0, amplitude: 5.0 };
    const resetHarm = { ...harmParams, N: 160, G: 0.0, omega1: 31.0, amplitude: 5.0 };
    setIrrParams(resetIrr);
    setHarmParams(resetHarm);
    const irrNew = createInitialState(resetIrr);
    const harmNew = createInitialState(resetHarm);
    setIrrState(irrNew);
    setHarmState(harmNew);
    setIrrPeakHistory([]);
    setHarmPeakHistory([]);
    setIrrMaxPeak(0);
    setHarmMaxPeak(0);
    frameTickRef.current = 0;
    irrStateRef.current = irrNew;
    harmStateRef.current = harmNew;
    accumulatorRef.current = 0;
  };

  const irrOmega2 = irrParams.R * irrParams.omega1;
  const harmOmega2 = harmParams.R * harmParams.omega1;

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-hidden">
      <header className="border-b border-gray-800/50 px-4 py-2 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⚡ Two Speakers Facing Each Other — Irrational vs Harmonic
            </h1>
            <p className="text-[9px] text-gray-500 mt-0.5">
              Left speaker emits f₁+f₂ → ← f₁+f₂ Right speaker | Waves collide at center
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`px-2 py-1 rounded text-[10px] font-bold ${
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
        {/* Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#0a0a1a] rounded-lg border border-cyan-900/30 p-3">
            <div className="text-[10px] text-cyan-400 font-bold mb-2">IRRATIONAL — Base Frequency f₁</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="10" max="100" step="0.5"
                value={irrParams.omega1}
                onChange={(e) => setIrrParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-20">{fmtFixed(omegaToGHz(irrParams.omega1), 2)} GHz</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              f₁ = {fmtFixed(omegaToGHz(irrParams.omega1), 2)} GHz | f₂ = {fmtFixed(omegaToGHz(irrOmega2), 2)} GHz | R = {irrParams.R.toFixed(4)}
            </div>
            <div className="text-[9px] text-cyan-600 mt-1">
              Resonance: ω₁=31 (k=4), ω₁=47 (k=6) | N={irrParams.N} nodes
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">NODES (N)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="40" max="320" step="40"
                value={irrParams.N}
                onChange={(e) => setIrrParams(p => ({ ...p, N: parseInt(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-16">N = {irrParams.N}</span>
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">DISSIPATION (G)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0" max="0.01" step="0.0001"
                value={irrParams.G}
                onChange={(e) => setIrrParams(p => ({ ...p, G: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-16">G = {fmtFixed(irrParams.G, 4)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              Set G=0 for maximum energy accumulation
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">AMPLITUDE (Power)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.1" max="5.0" step="0.1"
                value={irrParams.amplitude}
                onChange={(e) => setIrrParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-16">A = {fmtFixed(irrParams.amplitude, 1)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              Increase amplitude to drive stronger waves toward center collapse
            </div>
          </div>
          
          <div className="bg-[#0a0a1a] rounded-lg border border-purple-900/30 p-3">
            <div className="text-[10px] text-purple-400 font-bold mb-2">HARMONIC — Base Frequency f₁</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="10" max="100" step="0.5"
                value={harmParams.omega1}
                onChange={(e) => setHarmParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-20">{fmtFixed(omegaToGHz(harmParams.omega1), 2)} GHz</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              f₁ = {fmtFixed(omegaToGHz(harmParams.omega1), 2)} GHz | f₂ = {fmtFixed(omegaToGHz(harmOmega2), 2)} GHz | R = 2.0
            </div>
            <div className="text-[9px] text-purple-600 mt-1">
              Resonance: ω₁=31 (k=4), ω₁=47 (k=6) | N={harmParams.N} nodes
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">NODES (N)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="40" max="320" step="40"
                value={harmParams.N}
                onChange={(e) => setHarmParams(p => ({ ...p, N: parseInt(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-16">N = {harmParams.N}</span>
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">DISSIPATION (G)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0" max="0.01" step="0.0001"
                value={harmParams.G}
                onChange={(e) => setHarmParams(p => ({ ...p, G: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-16">G = {fmtFixed(harmParams.G, 4)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              Set G=0 for maximum energy accumulation
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">AMPLITUDE (Power)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.1" max="5.0" step="0.1"
                value={harmParams.amplitude}
                onChange={(e) => setHarmParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-16">A = {fmtFixed(harmParams.amplitude, 1)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              Increase amplitude to drive stronger waves toward center collapse
            </div>
          </div>
        </div>

        {/* Collision Views */}
        <div className="grid grid-cols-2 gap-3">
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-cyan-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-cyan-400">⚡ IRRATIONAL — R = {irrParams.R.toFixed(4)}</h2>
              <div className="text-[10px] text-gray-500">Peak: {fmtSci(irrMaxPeak)}</div>
            </div>
            <div className="text-[9px] text-gray-500 mb-1">
              Left speaker: f₁+f₂ → ← f₁+f₂ Right speaker
            </div>
            <CollisionView vRight={irrState.vRight} vLeft={irrState.vLeft} N={irrParams.N} time={irrState.time} />
          </section>

          <section className="bg-[#0a0a1a] rounded-lg border-2 border-purple-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-purple-400">∿ HARMONIC — R = 2.0</h2>
              <div className="text-[10px] text-gray-500">Peak: {fmtSci(harmMaxPeak)}</div>
            </div>
            <div className="text-[9px] text-gray-500 mb-1">
              Left speaker: f₁+f₂ → ← f₁+f₂ Right speaker
            </div>
            <CollisionView vRight={harmState.vRight} vLeft={harmState.vLeft} N={harmParams.N} time={harmState.time} />
          </section>
        </div>

        {/* Peak Comparison */}
        <section className="bg-[#0a0a1a] rounded-lg border-2 border-yellow-900/50 p-3">
          <h2 className="text-sm font-bold text-yellow-400 mb-2">📊 Center Peak Comparison</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] text-cyan-400 font-bold mb-1">IRRATIONAL Peak History</div>
              <div className="h-24 bg-gray-900/50 rounded p-1 border border-cyan-900/30">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {irrPeakHistory.length > 1 && (() => {
                    const maxP = Math.max(...irrPeakHistory.map(h => h.peak), 1e-10);
                    const points = irrPeakHistory.map((h, i) => {
                      const x = (i / (irrPeakHistory.length - 1)) * 100;
                      const y = 100 - (h.peak / maxP) * 90;
                      return `${x},${y}`;
                    }).join(' ');
                    return <polyline points={points} fill="none" stroke="rgb(0, 220, 255)" strokeWidth="1.5" />;
                  })()}
                </svg>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-purple-400 font-bold mb-1">HARMONIC Peak History</div>
              <div className="h-24 bg-gray-900/50 rounded p-1 border border-purple-900/30">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {harmPeakHistory.length > 1 && (() => {
                    const maxP = Math.max(...harmPeakHistory.map(h => h.peak), 1e-10);
                    const points = harmPeakHistory.map((h, i) => {
                      const x = (i / (harmPeakHistory.length - 1)) * 100;
                      const y = 100 - (h.peak / maxP) * 90;
                      return `${x},${y}`;
                    }).join(' ');
                    return <polyline points={points} fill="none" stroke="rgb(200, 100, 255)" strokeWidth="1.5" />;
                  })()}
                </svg>
              </div>
            </div>
          </div>

          <div className="mt-3 text-center">
            {(() => {
              const ratio = harmMaxPeak > 1e-15 ? irrMaxPeak / harmMaxPeak : 1;
              const irrWins = ratio > 1.2;
              const harmWins = ratio < 0.8;
              return (
                <div className={`inline-block px-4 py-2 rounded-lg text-sm font-bold ${
                  irrWins ? 'bg-cyan-900/50 text-cyan-300 border-2 border-cyan-600' :
                  harmWins ? 'bg-purple-900/50 text-purple-300 border-2 border-purple-600' :
                  'bg-gray-800 text-gray-400 border border-gray-700'
                }`}>
                  {irrWins ? `⚡ IRRATIONAL WINS — ${fmtFixed(ratio, 2)}× higher peaks` :
                   harmWins ? `∿ HARMONIC WINS — ${fmtFixed(1/ratio, 2)}× higher peaks` :
                   `○ TIED — ${fmtFixed(ratio, 2)}× ratio`}
                </div>
              );
            })()}
          </div>
        </section>

        {/* Combined Peak Comparison Chart */}
        <section className="bg-[#0a0a1a] rounded-lg border-2 border-gray-700/50 p-3">
          <h2 className="text-sm font-bold text-gray-300 mb-2">📈 Combined Peak Comparison</h2>
          <PeakComparisonChart
            irrHistory={irrPeakHistory}
            harmHistory={harmPeakHistory}
            irrMax={irrMaxPeak}
            harmMax={harmMaxPeak}
          />
        </section>
      </main>
    </div>
  );
}
