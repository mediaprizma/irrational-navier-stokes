import { useState, useEffect, useRef, useCallback } from 'react';
import {
  WaveParams,
  WaveState,
  DEFAULT_WAVE_PARAMS,
  createInitialWaveState,
  advanceWaveSimulation,
  getCenterPeakEnergy,
  getEdgeEnergy,
  checkDestruction,
  omegaToGHz,
} from './waveSimulation';

function fmtSci(v: number): string { return Number.isFinite(v) ? v.toExponential(2) : '0.00e+0'; }
function fmtFixed(v: number, d = 2): string { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

const SIM_DT = 0.001;

export default function App() {
  const [irrParams, setIrrParams] = useState<WaveParams>({
    ...DEFAULT_WAVE_PARAMS,
    mode: 'irrational',
    R: 1.475482818459,
  });
  const [harmParams, setHarmParams] = useState<WaveParams>({
    ...DEFAULT_WAVE_PARAMS,
    mode: 'harmonic',
    R: 2.0,
  });

  const [isRunning, setIsRunning] = useState(false);
  const [irrState, setIrrState] = useState<WaveState>(() => createInitialWaveState(irrParams));
  const [harmState, setHarmState] = useState<WaveState>(() => createInitialWaveState(harmParams));
  const [irrPeakHistory, setIrrPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [harmPeakHistory, setHarmPeakHistory] = useState<{ t: number; peak: number }[]>([]);
  const [irrMaxPeak, setIrrMaxPeak] = useState(0);
  const [harmMaxPeak, setHarmMaxPeak] = useState(0);
  const [irrDestruction, setIrrDestruction] = useState(false);
  const [harmDestruction, setHarmDestruction] = useState(false);

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
      irrCurrent = advanceWaveSimulation(irrCurrent, SIM_DT, irrParamsRef.current);
      harmCurrent = advanceWaveSimulation(harmCurrent, SIM_DT, harmParamsRef.current);
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
        const irrPeak = getCenterPeakEnergy(irrCurrent);
        const harmPeak = getCenterPeakEnergy(harmCurrent);

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

        if (checkDestruction(irrCurrent, irrParamsRef.current.criticalEnergy)) {
          setIrrDestruction(true);
        }
        if (checkDestruction(harmCurrent, harmParamsRef.current.criticalEnergy)) {
          setHarmDestruction(true);
        }
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
    const irrNew = createInitialWaveState(irrParams);
    const harmNew = createInitialWaveState(harmParams);
    setIrrState(irrNew);
    setHarmState(harmNew);
    setIrrPeakHistory([]);
    setHarmPeakHistory([]);
    setIrrMaxPeak(0);
    setHarmMaxPeak(0);
    setIrrDestruction(false);
    setHarmDestruction(false);
    frameTickRef.current = 0;
    irrStateRef.current = irrNew;
    harmStateRef.current = harmNew;
    accumulatorRef.current = 0;
  };

  const renderWaveProfile = (state: WaveState, color: string) => {
    const N = state.psiTotal.length;
    const maxAmp = Math.max(...Array.from(state.psiTotal).map(Math.abs), 0.01);
    
    return (
      <div className="flex items-end gap-px h-20 bg-gray-900/50 rounded p-1 border border-gray-800/30">
        {Array.from(state.psiTotal).map((psi, i) => {
          const amp = Math.abs(Number.isFinite(psi) ? psi : 0);
          const h = (amp / maxAmp) * 100;
          const isCenter = i < 5;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all duration-100"
              style={{
                height: `${Math.max(h, 2)}%`,
                backgroundColor: isCenter ? '#fbbf24' : color,
                boxShadow: isCenter && h > 50 ? `0 0 6px ${color}` : 'none',
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-hidden">
      <header className="border-b border-gray-800/50 px-4 py-2 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              ⚡ Continuous Wave Simulation — Spherical Convergence
            </h1>
            <p className="text-[9px] text-gray-500 mt-0.5">
              EM waves in vacuum/ether • Spherical geometry • Irrational vs Harmonic frequency ratio
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
        <div className="grid grid-cols-2 gap-3">
          {/* Irrational */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-cyan-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-cyan-400">
                ⚡ IRRATIONAL — R = {irrParams.R.toFixed(4)}
              </h2>
              {irrDestruction && (
                <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-300 border border-red-700 animate-pulse">
                  💥 DESTRUCTION
                </div>
              )}
            </div>

            <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30 mb-2">
              <div className="text-[9px] text-cyan-400 font-bold mb-1">BASE FREQUENCY f₁</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={irrParams.omega1}
                  onChange={(e) => setIrrParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))}
                  className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[10px] text-cyan-300 font-mono w-20">
                  {fmtFixed(omegaToGHz(irrParams.omega1), 2)} GHz
                </span>
              </div>
            </div>

            <div className="text-[9px] text-gray-500 mb-2">
              f₁ = {fmtFixed(omegaToGHz(irrParams.omega1), 2)} GHz | 
              f₂ = {fmtFixed(omegaToGHz(irrParams.R * irrParams.omega1), 2)} GHz
            </div>

            <div className="text-[9px] text-cyan-400 font-bold mb-1">WAVE PROFILE (center → edge)</div>
            {renderWaveProfile(irrState, 'rgb(0, 220, 255)')}

            <div className="grid grid-cols-2 gap-2 mt-2 text-[9px]">
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <span className="text-gray-500">Center Peak:</span>
                <span className="text-cyan-400 font-bold ml-1">{fmtSci(getCenterPeakEnergy(irrState))}</span>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-cyan-900/30">
                <span className="text-gray-500">Max Peak:</span>
                <span className="text-cyan-400 font-bold ml-1">{fmtSci(irrMaxPeak)}</span>
              </div>
            </div>
          </section>

          {/* Harmonic */}
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-purple-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-purple-400">
                ∿ HARMONIC — R = 2.0
              </h2>
              {harmDestruction && (
                <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-900/50 text-red-300 border border-red-700 animate-pulse">
                  💥 DESTRUCTION
                </div>
              )}
            </div>

            <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30 mb-2">
              <div className="text-[9px] text-purple-400 font-bold mb-1">BASE FREQUENCY f₁</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={harmParams.omega1}
                  onChange={(e) => setHarmParams(p => ({ ...p, omega1: parseFloat(e.target.value) }))}
                  className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[10px] text-purple-300 font-mono w-20">
                  {fmtFixed(omegaToGHz(harmParams.omega1), 2)} GHz
                </span>
              </div>
            </div>

            <div className="text-[9px] text-gray-500 mb-2">
              f₁ = {fmtFixed(omegaToGHz(harmParams.omega1), 2)} GHz | 
              f₂ = {fmtFixed(omegaToGHz(harmParams.R * harmParams.omega1), 2)} GHz
            </div>

            <div className="text-[9px] text-purple-400 font-bold mb-1">WAVE PROFILE (center → edge)</div>
            {renderWaveProfile(harmState, 'rgb(200, 100, 255)')}

            <div className="grid grid-cols-2 gap-2 mt-2 text-[9px]">
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <span className="text-gray-500">Center Peak:</span>
                <span className="text-purple-400 font-bold ml-1">{fmtSci(getCenterPeakEnergy(harmState))}</span>
              </div>
              <div className="bg-gray-900/50 rounded p-2 border border-purple-900/30">
                <span className="text-gray-500">Max Peak:</span>
                <span className="text-purple-400 font-bold ml-1">{fmtSci(harmMaxPeak)}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Peak Comparison */}
        <section className="bg-[#0a0a1a] rounded-lg border-2 border-yellow-900/50 p-3">
          <h2 className="text-sm font-bold text-yellow-400 mb-2">📊 Peak Comparison</h2>
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
      </main>
    </div>
  );
}
