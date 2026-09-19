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
} from './simulation';
import Oscilloscope from './Oscilloscope';
import Waterfall from './Waterfall';
import Spectrum from './Spectrum';
import CollisionView from './CollisionView';
import EnergyAccumulation from './EnergyAccumulation';

// ─── Ring buffer ─────────────────────────────────────────────────────────────

class RingBuffer {
  data: Float32Array;
  writeIdx = 0;
  count = 0;

  constructor(size: number) {
    this.data = new Float32Array(size);
  }

  push(v: number) {
    this.data[this.writeIdx] = Number.isFinite(v) ? v : 0;
    this.writeIdx = (this.writeIdx + 1) % this.data.length;
    if (this.count < this.data.length) this.count++;
  }

  reset() {
    this.data.fill(0);
    this.writeIdx = 0;
    this.count = 0;
  }
}

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
const SCOPE_SIZE = 512;
const SCOPE_SAMPLE_INTERVAL = 0.001;
const WATERFALL_ROWS = 150;
const WATERFALL_SAMPLE_INTERVAL = 0.005;

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [params, setParams] = useState<SimulationParams>({ ...DEFAULT_PARAMS });
  const [isRunning, setIsRunning] = useState(false);
  const [state, setState] = useState<SimulationState>(() => createInitialState(DEFAULT_PARAMS));
  const [gainCoeff, setGainCoeff] = useState(1.0);
  const [maxEnergyHistory, setMaxEnergyHistory] = useState<{ t: number; e: number }[]>([]);
  const [, setScopeTick] = useState(0);

  // Oscilloscope buffers
  const scopeLeftRef = useRef(new RingBuffer(SCOPE_SIZE));
  const scopeCenterRef = useRef(new RingBuffer(SCOPE_SIZE));
  const scopeRightRef = useRef(new RingBuffer(SCOPE_SIZE));

  // Traveling wave buffers at center
  const scopeVPlusRef = useRef(new RingBuffer(SCOPE_SIZE));   // V⁺ rightward (from left source)
  const scopeVMinusRef = useRef(new RingBuffer(SCOPE_SIZE));  // V⁻ leftward (from right source)
  const scopeVTotalRef = useRef(new RingBuffer(SCOPE_SIZE));  // V⁺ + V⁻ = total at center

  // Waterfall
  const waterfallRef = useRef<Float32Array[]>([]);

  // Energy accumulation history (cumulative integral over time)
  const [energyAccHistory, setEnergyAccHistory] = useState<{ t: number; eCenter: number; eEdge: number }[]>([]);
  const accCenterRef = useRef(0);
  const accEdgeRef = useRef(0);
  const lastAccTimeRef = useRef(0);

  // Pulse animation
  const [pulsePhase, setPulsePhase] = useState(0);

  const stateRef = useRef(state);
  const paramsRef = useRef(params);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const runningRef = useRef(isRunning);
  const accumulatorRef = useRef(0);
  const frameTickRef = useRef(0);
  const lastScopeSampleTime = useRef(0);
  const lastWaterfallTime = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { runningRef.current = isRunning; }, [isRunning]);

  const simulationLoop = useCallback(() => {
    if (!runningRef.current) return;

    const now = performance.now();
    const realDt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
    lastTimeRef.current = now;
    accumulatorRef.current += Math.min(realDt, 0.05);

    let currentState = stateRef.current;
    let stepsThisFrame = 0;
    const maxStepsPerFrame = 50;

    while (accumulatorRef.current >= SIM_DT && stepsThisFrame < maxStepsPerFrame) {
      currentState = advanceSimulation(currentState, SIM_DT, paramsRef.current, SUB_STEPS);
      accumulatorRef.current -= SIM_DT;
      stepsThisFrame++;

      // Sample oscilloscopes
      if (currentState.time - lastScopeSampleTime.current >= SCOPE_SAMPLE_INTERVAL) {
        lastScopeSampleTime.current = currentState.time;
        scopeLeftRef.current.push(currentState.voltages[0]);
        scopeCenterRef.current.push(currentState.voltages[9]);
        scopeRightRef.current.push(currentState.voltages[paramsRef.current.N - 1]);
        
        // Traveling waves at center
        const vPlus = currentState.vRight[9];
        const vMinus = currentState.vLeft[9];
        scopeVPlusRef.current.push(vPlus);
        scopeVMinusRef.current.push(vMinus);
        scopeVTotalRef.current.push(vPlus + vMinus);
      }

      // Waterfall
      if (currentState.time - lastWaterfallTime.current >= WATERFALL_SAMPLE_INTERVAL) {
        lastWaterfallTime.current = currentState.time;
        const snapshot = new Float32Array(paramsRef.current.N);
        for (let i = 0; i < paramsRef.current.N; i++) {
          snapshot[i] = Number.isFinite(currentState.voltages[i]) ? currentState.voltages[i] : 0;
        }
        waterfallRef.current.push(snapshot);
        if (waterfallRef.current.length > WATERFALL_ROWS) waterfallRef.current.shift();
      }

      // Energy accumulation (integrate energy over time)
      const dtAcc = currentState.time - lastAccTimeRef.current;
      if (dtAcc > 0 && Number.isFinite(dtAcc)) {
        lastAccTimeRef.current = currentState.time;
        // Center: nodes 9, 10
        const eCenterNow = (Number.isFinite(currentState.energies[9]) ? currentState.energies[9] : 0)
                         + (Number.isFinite(currentState.energies[10]) ? currentState.energies[10] : 0);
        // Edges: nodes 0,1,2 and N-3, N-2, N-1
        const N = paramsRef.current.N;
        const eEdgeNow = (Number.isFinite(currentState.energies[0]) ? currentState.energies[0] : 0)
                       + (Number.isFinite(currentState.energies[1]) ? currentState.energies[1] : 0)
                       + (Number.isFinite(currentState.energies[2]) ? currentState.energies[2] : 0)
                       + (Number.isFinite(currentState.energies[N - 3]) ? currentState.energies[N - 3] : 0)
                       + (Number.isFinite(currentState.energies[N - 2]) ? currentState.energies[N - 2] : 0)
                       + (Number.isFinite(currentState.energies[N - 1]) ? currentState.energies[N - 1] : 0);
        accCenterRef.current += eCenterNow * dtAcc;
        accEdgeRef.current += eEdgeNow * dtAcc;
      }
    }

    if (stepsThisFrame > 0) {
      const gain = computeGainCoefficient(currentState.energies, paramsRef.current.N);
      setState(currentState);
      setGainCoeff(Number.isFinite(gain) ? gain : 1.0);
      stateRef.current = currentState;

      frameTickRef.current++;
      if (frameTickRef.current % 5 === 0) {
        const maxE = safeMax(currentState.energies);
        if (Number.isFinite(maxE)) {
          setMaxEnergyHistory(hist => {
            const next = [...hist, { t: currentState.time, e: maxE }];
            if (next.length > 300) next.shift();
            return next;
          });
        }
        setScopeTick(t => t + 1);
        setPulsePhase(p => (p + 1) % 100);

        // Update energy accumulation history
        setEnergyAccHistory(hist => {
          const next = [...hist, {
            t: currentState.time,
            eCenter: accCenterRef.current,
            eEdge: accEdgeRef.current,
          }];
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
    const newState = createInitialState(params);
    setState(newState);
    setGainCoeff(1.0);
    setMaxEnergyHistory([]);
    frameTickRef.current = 0;
    stateRef.current = newState;
    accumulatorRef.current = 0;
    lastScopeSampleTime.current = 0;
    lastWaterfallTime.current = 0;
    scopeLeftRef.current.reset();
    scopeCenterRef.current.reset();
    scopeRightRef.current.reset();
    scopeVPlusRef.current.reset();
    scopeVMinusRef.current.reset();
    scopeVTotalRef.current.reset();
    waterfallRef.current = [];
    accCenterRef.current = 0;
    accEdgeRef.current = 0;
    lastAccTimeRef.current = 0;
    setEnergyAccHistory([]);
    setPulsePhase(0);
  };

  const handleModeChange = (mode: 'irrational' | 'harmonic') => {
    setParams(prev => ({ ...prev, mode }));
  };

  // ─── Derived metrics ───────────────────────────────────────────────────────

  const localizationActive = Number.isFinite(gainCoeff) && gainCoeff > 2.0;
  const maxEnergy = safeMax(state.energies);
  const omega2 = params.mode === 'irrational' ? params.R * params.omega1 : 2.0 * params.omega1;
  const centerEnergy = Math.max(
    Number.isFinite(state.energies[9]) ? state.energies[9] : 0,
    Number.isFinite(state.energies[10]) ? state.energies[10] : 0,
  );
  const totalEnergy = safeSum(state.energies);
  const edgeAvg = (() => {
    const idx = [0, 1, 2, params.N - 3, params.N - 2, params.N - 1];
    let s = 0;
    for (const i of idx) s += Number.isFinite(state.energies[i]) ? state.energies[i] : 0;
    return s / idx.length;
  })();

  const historySvgPoints = (() => {
    if (maxEnergyHistory.length < 2) return '';
    const histMax = Math.max(...maxEnergyHistory.map(h => Number.isFinite(h.e) ? h.e : 0), 1e-10);
    return maxEnergyHistory.map((item, i) => {
      const e = Number.isFinite(item.e) ? item.e : 0;
      const y = 100 - (e / histMax) * 90;
      return `${i},${y.toFixed(1)}`;
    }).join(' ');
  })();
  const historyFillPoints = (() => {
    if (maxEnergyHistory.length < 2) return '';
    const histMax = Math.max(...maxEnergyHistory.map(h => Number.isFinite(h.e) ? h.e : 0), 1e-10);
    const pts = maxEnergyHistory.map((item, i) => {
      const e = Number.isFinite(item.e) ? item.e : 0;
      const y = 100 - (e / histMax) * 90;
      return `${i},${y.toFixed(1)}`;
    }).join(' ');
    return `0,100 ${pts} ${maxEnergyHistory.length - 1},100`;
  })();

  const scopeSampleRate = 1 / SCOPE_SAMPLE_INTERVAL;

  // Pulse animation
  const leftPulses = [0, 1, 2, 3].map(k => {
    const phase = ((pulsePhase + k * 25) % 100) / 100;
    return phase * 0.45;
  });
  const rightPulses = [0, 1, 2, 3].map(k => {
    const phase = ((pulsePhase + k * 25) % 100) / 100;
    return 1.0 - phase * 0.45;
  });

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-x-hidden">
      {/* ── Header ── */}
      <header className="border-b border-gray-800/50 px-4 sm:px-6 py-3 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⚡ LC-Chain EM Simulator
            </h1>
            <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
              Counter-propagating waves • Irrational spectral pumping • Energy localization
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`hidden sm:block px-2 py-1 rounded text-[10px] font-bold ${
              isRunning ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
            }`}>{isRunning ? '● RUNNING' : '○ STOPPED'}</div>
            <button onClick={() => setIsRunning(!isRunning)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-bold text-xs transition-all ${
                isRunning ? 'bg-yellow-600 hover:bg-yellow-500 text-black' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}>{isRunning ? '⏸ Pause' : '▶ Start'}</button>
            <button onClick={handleReset}
              className="px-3 sm:px-4 py-2 rounded-lg font-bold text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700">↺ Reset</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4">

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* COLLISION VIEW — MAIN VISUALIZATION                                */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-[#0a0a1a] rounded-xl border-2 border-cyan-900/50 p-4 shadow-2xl shadow-cyan-900/20">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
              ⚡ Collision View — Waves Running Head-On
            </h2>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-cyan-400 inline-block" /> V⁺ →
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-purple-400 inline-block" /> ← V⁻
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-yellow-400 inline-block" /> V⁺+V⁻
              </span>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mb-3">
            Left source and right source both start at peak simultaneously → waves travel toward each other → collide at center → interference peaks (yellow dots)
          </p>

          {/* THE MAIN GRAPH */}
          <CollisionView
            vRight={state.vRight}
            vLeft={state.vLeft}
            N={params.N}
            time={state.time}
          />

          {/* Animated pulse line below */}
          <div className="relative bg-gray-900/50 rounded-lg p-3 border border-gray-800/30 mt-3">
            <div className="relative flex items-center justify-between px-6 py-3 min-h-[40px]">
              <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-gray-700/50 -translate-y-1/2" />
              {leftPulses.map((pos, k) => (
                <div key={`lp-${k}`}
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-cyan-400 opacity-80 blur-[1px]"
                  style={{ left: `${6 + pos * 88}%` }} />
              ))}
              {rightPulses.map((pos, k) => (
                <div key={`rp-${k}`}
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-purple-400 opacity-80 blur-[1px]"
                  style={{ left: `${6 + pos * 88}%` }} />
              ))}
              {Array.from(state.voltages).map((_, i) => {
                const isCenter = i === 9 || i === 10;
                const energy = Number.isFinite(state.energies[i]) ? state.energies[i] : 0;
                const color = energyToColor(energy, maxEnergy);
                return (
                  <div key={i} className="relative z-10">
                    <div className={`w-2.5 h-2.5 rounded-full border ${
                      isCenter ? 'border-yellow-400 ring-2 ring-yellow-400/40' : 'border-gray-600'
                    }`} style={{ backgroundColor: color }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center mt-1">
              <div className="text-cyan-400 text-[10px] font-bold">◀ SOURCE →→→</div>
              <div className="text-yellow-400 text-[10px] font-bold">⚡ COLLISION</div>
              <div className="text-purple-400 text-[10px] font-bold">←←← SOURCE ▶</div>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* ENERGY ACCUMULATION — THE KEY QUESTION                             */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-[#0a0a1a] rounded-xl border-2 border-yellow-900/50 p-4 shadow-2xl shadow-yellow-900/20">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-yellow-400 uppercase tracking-wider">
              🔋 Energy Accumulation — Does the scheme pump energy to center?
            </h2>
            {(() => {
              const last = energyAccHistory[energyAccHistory.length - 1];
              if (!last) return null;
              const K = last.eEdge > 1e-15 ? last.eCenter / last.eEdge : 1;
              const pumping = K > 1.5;
              return (
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  pumping ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-gray-800 text-gray-400 border border-gray-700'
                }`}>
                  {pumping ? `⚡ YES — K=${K.toFixed(2)}×` : `○ NO — K=${K.toFixed(2)}×`}
                </div>
              );
            })()}
          </div>
          <p className="text-[10px] text-gray-500 mb-3">
            <span className="text-yellow-400 font-bold">Yellow</span> = cumulative energy at center nodes (i=9,10) &nbsp;|&nbsp;
            <span className="text-purple-400 font-bold">Purple</span> = cumulative energy at edge nodes (i=0,1,2,17,18,19)<br/>
            If <span className="text-yellow-400 font-bold">yellow grows faster</span> → the irrational pumping scheme <span className="text-red-400 font-bold">DOES pump energy into the center</span>
          </p>
          <EnergyAccumulation history={energyAccHistory} height={240} />
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
            <div className="bg-gray-900/50 rounded p-2 border border-gray-800/30">
              <span className="text-gray-500">∫E_center dt =</span>
              <span className="text-yellow-400 font-bold ml-1">
                {energyAccHistory.length > 0 ? energyAccHistory[energyAccHistory.length - 1].eCenter.toExponential(2) : '0.00e+0'}
              </span>
            </div>
            <div className="bg-gray-900/50 rounded p-2 border border-gray-800/30">
              <span className="text-gray-500">∫E_edge dt =</span>
              <span className="text-purple-400 font-bold ml-1">
                {energyAccHistory.length > 0 ? energyAccHistory[energyAccHistory.length - 1].eEdge.toExponential(2) : '0.00e+0'}
              </span>
            </div>
            <div className="bg-gray-900/50 rounded p-2 border border-gray-800/30">
              <span className="text-gray-500">Ratio K =</span>
              <span className={`font-bold ml-1 ${
                energyAccHistory.length > 0 && energyAccHistory[energyAccHistory.length - 1].eCenter > energyAccHistory[energyAccHistory.length - 1].eEdge * 1.5
                  ? 'text-red-400' : 'text-gray-400'
              }`}>
                {energyAccHistory.length > 0 && energyAccHistory[energyAccHistory.length - 1].eEdge > 1e-15
                  ? (energyAccHistory[energyAccHistory.length - 1].eCenter / energyAccHistory[energyAccHistory.length - 1].eEdge).toFixed(2) + '×'
                  : '—'}
              </span>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* SPECTRUM ANALYZER — V⁺+V⁻                                         */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-[#0a0a1a] rounded-xl border border-yellow-900/30 p-4">
          <h2 className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-3">
            📊 Spectrum of V⁺+V⁻ at Center — Two Peaks from Irrational Pumping
          </h2>
          <Spectrum
            buffer={scopeVTotalRef.current.data}
            writeIdx={scopeVTotalRef.current.writeIdx}
            length={scopeVTotalRef.current.count}
            sampleRate={scopeSampleRate}
            label="|V_total(f)| at center (i=9)"
            color="rgb(255, 200, 0)"
            height={140}
          />
          <div className="mt-2 text-[9px] text-gray-600 text-center">
            Two spectral peaks at f₁ = {fmtFixed(params.omega1 / (2 * Math.PI), 2)} Hz and f₂ = {fmtFixed(omega2 / (2 * Math.PI), 2)} Hz
            {params.mode === 'irrational' && ' • Irrational ratio → quasi-periodic beating → energy accumulates at center'}
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* SPACE-TIME WATERFALL                                               */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            🌊 Space-Time Waterfall — Waves Propagating Toward Each Other
          </h2>
          <Waterfall history={waterfallRef.current} maxRows={WATERFALL_ROWS} N={params.N} mode="voltage" />
          <div className="mt-2 flex justify-between text-[9px] text-gray-600">
            <span>↑ Recent (top) → Past (bottom) &nbsp;|&nbsp; Diagonal streaks = traveling waves</span>
            <span>Yellow dashed = focus nodes</span>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* ENERGY PROFILE                                                     */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
            ⚡ Energy Profile — {params.N} Nodes
          </h2>
          <div className="relative overflow-x-auto">
            <div className="relative flex items-end justify-between gap-0.5 px-2 py-4 min-w-[600px]">
              {Array.from(state.voltages).map((_, i) => {
                const isCenter = i === 9 || i === 10;
                const isEdge = i <= 2 || i >= params.N - 3;
                const energy = Number.isFinite(state.energies[i]) ? state.energies[i] : 0;
                const color = energyToColor(energy, maxEnergy);
                const barHeight = 10 + (energy / Math.max(maxEnergy, 1e-10)) * 120;
                return (
                  <div key={i} className="flex flex-col items-center flex-1">
                    <div className="w-full max-w-[28px] rounded-t transition-all duration-100"
                      style={{ height: `${barHeight}px`, backgroundColor: color,
                        boxShadow: energy / Math.max(maxEnergy, 1e-10) > 0.5 ? `0 0 ${8 + 20 * (energy / Math.max(maxEnergy, 1e-10))}px ${color}` : 'none' }} />
                    <div className={`w-3 h-3 rounded-full mt-1 transition-all duration-100 ${isCenter ? 'ring-2 ring-yellow-400/60' : ''}`}
                      style={{ backgroundColor: color }} />
                    <span className={`text-[8px] mt-0.5 ${isCenter ? 'text-yellow-400 font-bold' : isEdge ? 'text-purple-400' : 'text-gray-600'}`}>{i}</span>
                    {isCenter && <span className="text-[7px] text-yellow-500 font-bold">▼</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between px-2 mt-1 min-w-[600px]">
              <div className="text-[9px] text-cyan-500 font-bold">◀ V⁺ SOURCE</div>
              <div className="text-[9px] text-yellow-500 font-bold">▼ COLLISION / FOCUS</div>
              <div className="text-[9px] text-purple-500 font-bold">V⁻ SOURCE ▶</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[9px] text-gray-500 mb-1">Energy Density Heatmap</div>
            <div className="flex h-6 rounded overflow-hidden border border-gray-800/50">
              {Array.from(state.energies).map((e, i) => (
                <div key={i} className="flex-1 transition-colors duration-100"
                  style={{ backgroundColor: energyToColor(Number.isFinite(e) ? e : 0, maxEnergy) }} />
              ))}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* CONTROLS + DASHBOARD                                               */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">⚙ Control Panel</h2>
            <div className="space-y-4">
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Base Frequency ω₁</span>
                  <span className="text-cyan-400 font-bold">{fmtFixed(params.omega1, 1)} rad/s</span>
                </label>
                <input type="range" min="5" max="100" step="0.5" value={params.omega1}
                  onChange={e => setParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-2 block">Pumping Mode</label>
                <div className="flex gap-2">
                  <button onClick={() => handleModeChange('irrational')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                      params.mode === 'irrational' ? 'bg-cyan-900/50 text-cyan-300 border-cyan-600' : 'bg-gray-900 text-gray-500 border-gray-700 hover:bg-gray-800'
                    }`}>
                    <div>⚡ Irrational</div><div className="text-[9px] opacity-70 mt-0.5">R = 1.47548…</div>
                  </button>
                  <button onClick={() => handleModeChange('harmonic')}
                    className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                      params.mode === 'harmonic' ? 'bg-purple-900/50 text-purple-300 border-purple-600' : 'bg-gray-900 text-gray-500 border-gray-700 hover:bg-gray-800'
                    }`}>
                    <div>∿ Harmonic</div><div className="text-[9px] opacity-70 mt-0.5">R = 2.0</div>
                  </button>
                </div>
                <div className="text-[9px] text-gray-600 mt-2 bg-gray-900/50 rounded px-2 py-1">
                  ω₂ = <span className="text-gray-300">{fmtFixed(omega2, 2)}</span> rad/s
                  {params.mode === 'irrational'
                    ? <span className="text-cyan-600 ml-2">• ω₂/ω₁ = {params.R} (irrational)</span>
                    : <span className="text-purple-600 ml-2">• ω₂/ω₁ = 2.0 (rational)</span>}
                </div>
              </div>
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Dissipation G</span>
                  <span className="text-orange-400 font-bold">{fmtFixed(params.G, 3)}</span>
                </label>
                <input type="range" min="0" max="0.5" step="0.001" value={params.G}
                  onChange={e => setParams(p => ({ ...p, G: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div>
                <label className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-400">Pump Amplitude A</span>
                  <span className="text-green-400 font-bold">{fmtFixed(params.amplitude, 2)}</span>
                </label>
                <input type="range" min="0.1" max="3.0" step="0.05" value={params.amplitude}
                  onChange={e => setParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))} className="w-full" />
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 text-[10px] text-gray-500 space-y-1.5 border border-gray-800/30">
                <div className="text-gray-400 font-bold mb-1">System</div>
                <div className="flex justify-between"><span>N</span><span className="text-gray-300">{params.N}</span></div>
                <div className="flex justify-between"><span>L</span><span className="text-gray-300">{params.L} H</span></div>
                <div className="flex justify-between"><span>C</span><span className="text-gray-300">{params.C} F</span></div>
                <div className="flex justify-between"><span>Z = √(L/C)</span><span className="text-gray-300">{fmtFixed(Math.sqrt(params.L / params.C), 3)} Ω</span></div>
                <div className="flex justify-between"><span>c = 1/√(LC)</span><span className="text-gray-300">{fmtFixed(1 / Math.sqrt(params.L * params.C), 1)}</span></div>
                <div className="flex justify-between"><span>Sim time</span><span className="text-gray-300">{fmtFixed(state.time, 3)} s</span></div>
              </div>
            </div>
          </section>

          <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">📊 Analytics</h2>
            <div className="mb-4">
              <div className="text-[10px] text-gray-500 mb-1">K<sub>gain</sub> = E<sub>center</sub> / E<sub>edge</sub></div>
              <span className={`text-5xl font-black tabular-nums ${
                localizationActive ? 'text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-yellow-400' : 'text-gray-500'
              }`}>{fmtFixed(gainCoeff, 2)}</span>
              <span className="text-xs text-gray-600 ml-1">×</span>
              <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
                localizationActive ? 'bg-gradient-to-r from-red-900/50 to-yellow-900/30 text-yellow-300 border border-yellow-700/50' : 'bg-gray-900/50 text-gray-500 border border-gray-800/50'
              }`}>
                {localizationActive
                  ? <><span className="animate-pulse">⚡</span><span>LOCALIZATION ACTIVE — counter-propagating waves constructively interfere at center</span></>
                  : <><span>○</span><span>No significant localization</span></>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Center Energy</div>
                <div className="text-base font-bold text-yellow-400 tabular-nums">{fmtSci(centerEnergy)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Max Energy</div>
                <div className="text-base font-bold text-red-400 tabular-nums">{fmtSci(maxEnergy)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Total Energy</div>
                <div className="text-base font-bold text-cyan-400 tabular-nums">{fmtSci(totalEnergy)}</div>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2.5 border border-gray-800/30">
                <div className="text-[9px] text-gray-500">Avg Edge Energy</div>
                <div className="text-base font-bold text-purple-400 tabular-nums">{fmtSci(edgeAvg)}</div>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-gray-500 mb-1">Max Energy vs Time</div>
              <div className="bg-gray-900/50 rounded-lg p-2 h-28 relative overflow-hidden border border-gray-800/30">
                {maxEnergyHistory.length > 2 ? (
                  <svg className="w-full h-full" viewBox={`0 0 ${maxEnergyHistory.length} 100`} preserveAspectRatio="none">
                    <defs><linearGradient id="eGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(239,68,68,0.4)" /><stop offset="100%" stopColor="rgba(239,68,68,0.0)" />
                    </linearGradient></defs>
                    <polyline fill="url(#eGrad)" stroke="none" points={historyFillPoints} />
                    <polyline fill="none" stroke="rgb(239,68,68)" strokeWidth="1.5" points={historySvgPoints} />
                  </svg>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-xs">Start simulation</div>
                )}
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[9px] text-gray-500 mb-1">Energy Distribution</div>
              <div className="flex items-end gap-px h-14 bg-gray-900/50 rounded-lg p-1.5 border border-gray-800/30">
                {Array.from(state.energies).map((e, i) => {
                  const energy = Number.isFinite(e) ? e : 0;
                  const h = (energy / Math.max(maxEnergy, 1e-10)) * 100;
                  const isCenter = i === 9 || i === 10;
                  return <div key={i} className="flex-1 rounded-t-sm transition-all duration-100"
                    style={{ height: `${Math.max(h, 3)}%`, backgroundColor: isCenter ? '#fbbf24' : energyToColor(energy, maxEnergy) }} />;
                })}
              </div>
            </div>
          </section>
        </div>

        {/* ── Physics Model ── */}
        <section className="bg-[#0a0a1a] rounded-xl border border-gray-800/50 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">📐 Physics Model</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-400">
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-cyan-400 font-bold mb-1.5 text-[11px]">Telegraph Equations</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                C·dVᵢ/dt = Iᵢ₋₁ − Iᵢ − G·Vᵢ<br/>
                L·dIᵢ/dt = Vᵢ − Vᵢ₊₁
              </div>
              <div className="mt-2 text-[9px] text-gray-600">Coupled V-I system → bidirectional wave propagation</div>
            </div>
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-purple-400 font-bold mb-1.5 text-[11px]">Counter-Propagating Drive</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                V₀(t) → launches V⁺ rightward<br/>
                V<sub>N−1</sub>(t) → launches V⁻ leftward
              </div>
              <div className="mt-2 text-[9px] text-gray-600">Anti-phase dual-frequency sources at both ends</div>
            </div>
            <div className="bg-gray-900/30 rounded-lg p-3 border border-gray-800/30">
              <div className="text-yellow-400 font-bold mb-1.5 text-[11px]">Traveling Wave Decomposition</div>
              <div className="font-mono text-[10px] leading-relaxed text-gray-300">
                V⁺ = (V + Z·I) / 2 → rightward<br/>
                V⁻ = (V − Z·I) / 2 ← leftward
              </div>
              <div className="mt-2 text-[9px] text-gray-600">Z = √(L/C) — waves meet at center, irrational ratio → constructive accumulation</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-800/30 px-6 py-3 mt-4">
        <div className="max-w-7xl mx-auto text-[10px] text-gray-700 text-center">
          LC-Chain EM Simulator • Counter-propagating waves • RK4 + NaN-guard • Real-time oscilloscopes
        </div>
      </footer>
    </div>
  );
}
