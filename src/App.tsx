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
  const [params, setParams] = useState<SimulationParams>({ ...DEFAULT_PARAMS });
  const [isRunning, setIsRunning] = useState(false);

  // Two parallel simulations
  const [irrState, setIrrState] = useState<SimulationState>(() =>
    createInitialState({ ...DEFAULT_PARAMS, mode: 'irrational' })
  );
  const [harmState, setHarmState] = useState<SimulationState>(() =>
    createInitialState({ ...DEFAULT_PARAMS, mode: 'harmonic' })
  );

  const [irrGain, setIrrGain] = useState(1.0);
  const [harmGain, setHarmGain] = useState(1.0);

  // Peak tracking histories
  const [irrPeakHistory, setIrrPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [harmPeakHistory, setHarmPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [irrMaxPeak, setIrrMaxPeak] = useState(0);
  const [harmMaxPeak, setHarmMaxPeak] = useState(0);

  const irrStateRef = useRef(irrState);
  const harmStateRef = useRef(harmState);
  const paramsRef = useRef(params);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const runningRef = useRef(isRunning);
  const accumulatorRef = useRef(0);
  const frameTickRef = useRef(0);

  useEffect(() => { irrStateRef.current = irrState; }, [irrState]);
  useEffect(() => { harmStateRef.current = harmState; }, [harmState]);
  useEffect(() => { paramsRef.current = params; }, [params]);
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
      irrCurrent = advanceSimulation(irrCurrent, SIM_DT, { ...paramsRef.current, mode: 'irrational' }, SUB_STEPS);
      harmCurrent = advanceSimulation(harmCurrent, SIM_DT, { ...paramsRef.current, mode: 'harmonic' }, SUB_STEPS);
      accumulatorRef.current -= SIM_DT;
      stepsThisFrame++;
    }

    if (stepsThisFrame > 0) {
      const irrG = computeGainCoefficient(irrCurrent.energies, paramsRef.current.N);
      const harmG = computeGainCoefficient(harmCurrent.energies, paramsRef.current.N);
      setIrrState(irrCurrent);
      setHarmState(harmCurrent);
      setIrrGain(Number.isFinite(irrG) ? irrG : 1.0);
      setHarmGain(Number.isFinite(harmG) ? harmG : 1.0);
      irrStateRef.current = irrCurrent;
      harmStateRef.current = harmCurrent;

      frameTickRef.current++;
      if (frameTickRef.current % 5 === 0) {
        const irrPeak = getCenterPeak(irrCurrent, paramsRef.current.N);
        const harmPeak = getCenterPeak(harmCurrent, paramsRef.current.N);

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
    const irrNew = createInitialState({ ...params, mode: 'irrational' });
    const harmNew = createInitialState({ ...params, mode: 'harmonic' });
    setIrrState(irrNew);
    setHarmState(harmNew);
    setIrrGain(1.0);
    setHarmGain(1.0);
    setIrrPeakHistory([]);
    setHarmPeakHistory([]);
    setIrrMaxPeak(0);
    setHarmMaxPeak(0);
    frameTickRef.current = 0;
    irrStateRef.current = irrNew;
    harmStateRef.current = harmNew;
    accumulatorRef.current = 0;
  };

  const omega2 = params.R * params.omega1;

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
              f₁ = {fmtFixed(omegaToGHz(params.omega1), 2)} GHz | f₂ = {fmtFixed(omegaToGHz(omega2), 2)} GHz | N = {params.N} nodes | Reflective boundaries
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
        {/* ── Controls ── */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#0a0a1a] rounded-lg border border-gray-800/50 p-3">
            <label className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-400">Frequency f₁</span>
              <span className="text-cyan-400 font-bold">{fmtFixed(omegaToGHz(params.omega1), 2)} GHz</span>
            </label>
            <input type="range" min="5" max="100" step="0.5" value={params.omega1}
              onChange={e => setParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="bg-[#0a0a1a] rounded-lg border border-gray-800/50 p-3">
            <label className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-400">Amplitude A</span>
              <span className="text-green-400 font-bold">{fmtFixed(params.amplitude, 2)}</span>
            </label>
            <input type="range" min="0.1" max="3.0" step="0.05" value={params.amplitude}
              onChange={e => setParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="bg-[#0a0a1a] rounded-lg border border-gray-800/50 p-3">
            <label className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-400">Dissipation G</span>
              <span className="text-orange-400 font-bold">{fmtFixed(params.G, 4)}</span>
            </label>
            <input type="range" min="0" max="0.01" step="0.0001" value={params.G}
              onChange={e => setParams(p => ({ ...p, G: parseFloat(e.target.value) }))} className="w-full" />
          </div>
          <div className="bg-[#0a0a1a] rounded-lg border border-gray-800/50 p-3">
            <label className="flex justify-between text-[10px] mb-1">
              <span className="text-gray-400">Reflection coeff</span>
              <span className="text-yellow-400 font-bold">0.85</span>
            </label>
            <div className="text-[9px] text-gray-600 mt-1">
              λ₁ = {fmtFixed(2 * Math.PI / params.omega1 * (1 / Math.sqrt(params.L * params.C)), 1)} nodes |
              λ₂ = {fmtFixed(2 * Math.PI / omega2 * (1 / Math.sqrt(params.L * params.C)), 1)} nodes
            </div>
          </div>
        </div>

        {/* ── Collision Views side by side ── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Irrational */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-cyan-900/50 p-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-bold text-cyan-400">
                ⚡ IRRATIONAL — R = {params.R}
              </h2>
              <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                irrGain > 1.5 ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-800 text-gray-500'
              }`}>
                K = {fmtFixed(irrGain, 2)}×
              </div>
            </div>
            <CollisionView vRight={irrState.vRight} vLeft={irrState.vLeft} N={params.N} time={irrState.time} />
          </section>

          {/* Harmonic */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-purple-900/50 p-3">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-bold text-purple-400">
                ∿ HARMONIC — R = 2.0
              </h2>
              <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                harmGain > 1.5 ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-800 text-gray-500'
              }`}>
                K = {fmtFixed(harmGain, 2)}×
              </div>
            </div>
            <CollisionView vRight={harmState.vRight} vLeft={harmState.vLeft} N={params.N} time={harmState.time} />
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
                const N = params.N;
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
                const N = params.N;
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
