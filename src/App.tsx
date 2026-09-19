import { useState, useEffect, useRef, useCallback } from 'react';
import {
  SimulationParams,
  SimulationState,
  DEFAULT_PARAMS,
  createInitialState,
  advanceSimulation,
  computeGainCoefficient,
  safeMax,
  safeSum,
  omegaToGHz,
} from './simulation';
import CollisionView from './CollisionView';
import EnergyAccumulation from './EnergyAccumulation';

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

  // Energy accumulation histories
  const [irrAccHistory, setIrrAccHistory] = useState<{ t: number; eCenter: number; eEdge: number }[]>([]);
  const [harmAccHistory, setHarmAccHistory] = useState<{ t: number; eCenter: number; eEdge: number }[]>([]);
  const irrAccRef = useRef({ center: 0, edge: 0 });
  const harmAccRef = useRef({ center: 0, edge: 0 });

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

  // Compute energy metrics for a state
  const computeEnergyMetrics = (state: SimulationState, N: number) => {
    const cIdx1 = Math.floor(N / 2) - 1;
    const cIdx2 = Math.floor(N / 2);
    const eCenter = (Number.isFinite(state.energies[cIdx1]) ? state.energies[cIdx1] : 0)
                  + (Number.isFinite(state.energies[cIdx2]) ? state.energies[cIdx2] : 0);
    const eEdge = (Number.isFinite(state.energies[0]) ? state.energies[0] : 0)
                + (Number.isFinite(state.energies[1]) ? state.energies[1] : 0)
                + (Number.isFinite(state.energies[2]) ? state.energies[2] : 0)
                + (Number.isFinite(state.energies[3]) ? state.energies[3] : 0)
                + (Number.isFinite(state.energies[N - 4]) ? state.energies[N - 4] : 0)
                + (Number.isFinite(state.energies[N - 3]) ? state.energies[N - 3] : 0)
                + (Number.isFinite(state.energies[N - 2]) ? state.energies[N - 2] : 0)
                + (Number.isFinite(state.energies[N - 1]) ? state.energies[N - 1] : 0);
    return { eCenter, eEdge };
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
      // Advance both simulations
      irrCurrent = advanceSimulation(irrCurrent, SIM_DT, { ...paramsRef.current, mode: 'irrational' }, SUB_STEPS);
      harmCurrent = advanceSimulation(harmCurrent, SIM_DT, { ...paramsRef.current, mode: 'harmonic' }, SUB_STEPS);
      accumulatorRef.current -= SIM_DT;
      stepsThisFrame++;

      // Accumulate energy
      const irrE = computeEnergyMetrics(irrCurrent, paramsRef.current.N);
      const harmE = computeEnergyMetrics(harmCurrent, paramsRef.current.N);
      irrAccRef.current.center += irrE.eCenter * SIM_DT;
      irrAccRef.current.edge += irrE.eEdge * SIM_DT;
      harmAccRef.current.center += harmE.eCenter * SIM_DT;
      harmAccRef.current.edge += harmE.eEdge * SIM_DT;
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
        setIrrAccHistory(hist => {
          const next = [...hist, { t: irrCurrent.time, eCenter: irrAccRef.current.center, eEdge: irrAccRef.current.edge }];
          if (next.length > 500) next.shift();
          return next;
        });
        setHarmAccHistory(hist => {
          const next = [...hist, { t: harmCurrent.time, eCenter: harmAccRef.current.center, eEdge: harmAccRef.current.edge }];
          if (next.length > 500) next.shift();
          return next;
        });
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
    setIrrAccHistory([]);
    setHarmAccHistory([]);
    irrAccRef.current = { center: 0, edge: 0 };
    harmAccRef.current = { center: 0, edge: 0 };
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
              ⚡ LC-Chain: Irrational vs Harmonic — Head-to-Head Comparison
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

        {/* ── Energy Accumulation side by side ── */}
        <div className="grid grid-cols-2 gap-3">
          <section className="bg-[#0a0a1a] rounded-lg border border-cyan-900/30 p-3">
            <h3 className="text-[10px] font-bold text-cyan-400 mb-1">
              🔋 Energy Accumulation — Irrational
            </h3>
            <EnergyAccumulation history={irrAccHistory} height={160} />
            <div className="grid grid-cols-3 gap-1 mt-1 text-[9px]">
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">⟨E_center⟩</span>
                <span className="text-yellow-400 font-bold ml-1">
                  {irrAccHistory.length > 0 ? fmtSci(irrAccHistory[irrAccHistory.length - 1].eCenter) : '0.00e+0'}
                </span>
              </div>
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">⟨E_edge⟩</span>
                <span className="text-purple-400 font-bold ml-1">
                  {irrAccHistory.length > 0 ? fmtSci(irrAccHistory[irrAccHistory.length - 1].eEdge) : '0.00e+0'}
                </span>
              </div>
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">K</span>
                <span className={`font-bold ml-1 ${irrGain > 1.5 ? 'text-red-400' : 'text-gray-400'}`}>
                  {fmtFixed(irrGain, 2)}×
                </span>
              </div>
            </div>
          </section>

          <section className="bg-[#0a0a1a] rounded-lg border border-purple-900/30 p-3">
            <h3 className="text-[10px] font-bold text-purple-400 mb-1">
              🔋 Energy Accumulation — Harmonic
            </h3>
            <EnergyAccumulation history={harmAccHistory} height={160} />
            <div className="grid grid-cols-3 gap-1 mt-1 text-[9px]">
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">⟨E_center⟩</span>
                <span className="text-yellow-400 font-bold ml-1">
                  {harmAccHistory.length > 0 ? fmtSci(harmAccHistory[harmAccHistory.length - 1].eCenter) : '0.00e+0'}
                </span>
              </div>
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">⟨E_edge⟩</span>
                <span className="text-purple-400 font-bold ml-1">
                  {harmAccHistory.length > 0 ? fmtSci(harmAccHistory[harmAccHistory.length - 1].eEdge) : '0.00e+0'}
                </span>
              </div>
              <div className="bg-gray-900/50 rounded p-1.5 border border-gray-800/30">
                <span className="text-gray-500">K</span>
                <span className={`font-bold ml-1 ${harmGain > 1.5 ? 'text-red-400' : 'text-gray-400'}`}>
                  {fmtFixed(harmGain, 2)}×
                </span>
              </div>
            </div>
          </section>
        </div>

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

        {/* ── Verdict ── */}
        <div className={`rounded-lg p-3 text-center text-xs font-bold ${
          irrGain > harmGain * 1.2
            ? 'bg-gradient-to-r from-cyan-900/30 to-blue-900/30 text-cyan-300 border border-cyan-700/50'
            : harmGain > irrGain * 1.2
            ? 'bg-gradient-to-r from-purple-900/30 to-pink-900/30 text-purple-300 border border-purple-700/50'
            : 'bg-gray-900/50 text-gray-400 border border-gray-700/50'
        }`}>
          {irrGain > harmGain * 1.2
            ? `⚡ IRRATIONAL WINS — K_irr = ${fmtFixed(irrGain, 2)}× vs K_harm = ${fmtFixed(harmGain, 2)}× (${fmtFixed(irrGain / Math.max(harmGain, 0.01), 1)}× better)`
            : harmGain > irrGain * 1.2
            ? `∿ HARMONIC WINS — K_harm = ${fmtFixed(harmGain, 2)}× vs K_irr = ${fmtFixed(irrGain, 2)}×`
            : `○ TIED — K_irr = ${fmtFixed(irrGain, 2)}× vs K_harm = ${fmtFixed(harmGain, 2)}×`
          }
        </div>
      </main>
    </div>
  );
}
