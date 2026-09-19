import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AcousticParams,
  AcousticState,
  DEFAULT_ACOUSTIC_PARAMS,
  createInitialAcousticState,
  advanceAcousticSimulation,
  getCenterPeakPressure,
  pressureToDb,
} from './acousticSimulation';
import AcousticView from './AcousticView';
import PeakComparisonChart from './PeakComparisonChart';

function fmtSci(v: number): string { return Number.isFinite(v) ? v.toExponential(2) : '0.00e+0'; }
function fmtFixed(v: number, d = 2): string { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

const SIM_DT = 0.00001; // 10 μs timestep for acoustic simulation
const SUB_STEPS = 10;

export default function App() {
  // Irrational: R = 1.475482818459
  const [irrParams, setIrrParams] = useState<AcousticParams>({
    N: 200,
    L: 3.0,
    f1: 3050.0,
    R: 1.475482818459,
    amplitude: 20.0,
    amplitudeRatio: 1.0,
    mode: 'irrational',
    temperature: 293.0,
  });
  
  // Harmonic: R = 2.0
  const [harmParams, setHarmParams] = useState<AcousticParams>({
    N: 200,
    L: 3.0,
    f1: 3050.0,
    R: 2.0,
    amplitude: 20.0,
    amplitudeRatio: 1.0,
    mode: 'harmonic',
    temperature: 293.0,
  });

  const [isRunning, setIsRunning] = useState(false);
  const [irrState, setIrrState] = useState<AcousticState>(() => createInitialAcousticState(irrParams));
  const [harmState, setHarmState] = useState<AcousticState>(() => createInitialAcousticState(harmParams));
  
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
      irrCurrent = advanceAcousticSimulation(irrCurrent, SIM_DT, irrParamsRef.current);
      harmCurrent = advanceAcousticSimulation(harmCurrent, SIM_DT, harmParamsRef.current);
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
        const irrPeak = getCenterPeakPressure(irrCurrent);
        const harmPeak = getCenterPeakPressure(harmCurrent);

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
    const resetIrr = { ...irrParams, f1: 3050.0, L: 3.0, amplitude: 20.0, amplitudeRatio: 1.0, temperature: 293.0 };
    const resetHarm = { ...harmParams, f1: 3050.0, L: 3.0, amplitude: 20.0, amplitudeRatio: 1.0, temperature: 293.0 };
    setIrrParams(resetIrr);
    setHarmParams(resetHarm);
    const irrNew = createInitialAcousticState(resetIrr);
    const harmNew = createInitialAcousticState(resetHarm);
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

  const irrF2 = irrParams.R * irrParams.f1;
  const harmF2 = harmParams.R * harmParams.f1;

  return (
    <div className="min-h-screen bg-[#050510] text-white font-mono overflow-hidden">
      <header className="border-b border-gray-800/50 px-4 py-2 bg-[#0a0a1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-base font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              🔊 Acoustic Wave Simulation — Real Physics
            </h1>
            <p className="text-[9px] text-gray-500 mt-0.5">
              Sound waves in air at 20°C | c = 343 m/s | ρ = 1.225 kg/m³ | Two speakers facing each other
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
                type="range" min="100" max="10000" step="50"
                value={irrParams.f1}
                onChange={(e) => setIrrParams(p => ({ ...p, f1: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-20">{fmtFixed(irrParams.f1, 0)} Hz</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              f₁ = {fmtFixed(irrParams.f1, 0)} Hz | f₂ = {fmtFixed(irrF2, 0)} Hz | R = {irrParams.R.toFixed(4)}
            </div>
            <div className="text-[9px] text-cyan-600 mt-1">
              λ₁ = {fmtFixed(343 / irrParams.f1, 3)} m | λ₂ = {fmtFixed(343 / irrF2, 3)} m | T₁ = {fmtFixed(1000 / irrParams.f1, 2)} ms
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">AMPLITUDE (Sound Pressure)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.02" max="200" step="0.1"
                value={irrParams.amplitude}
                onChange={(e) => setIrrParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-20">{fmtFixed(irrParams.amplitude, 1)} Pa</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              {fmtFixed(pressureToDb(irrParams.amplitude), 1)} dB SPL | Threshold of pain: 120 dB (20 Pa)
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">AMPLITUDE RATIO (k = A₂/A₁)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.1" max="5.0" step="0.1"
                value={irrParams.amplitudeRatio}
                onChange={(e) => setIrrParams(p => ({ ...p, amplitudeRatio: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-16">k = {fmtFixed(irrParams.amplitudeRatio, 1)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              v(t) = A₁·sin(2πf₁t) + k·A₁·sin(2πf₂t) | A₂ = {fmtFixed(irrParams.amplitudeRatio * irrParams.amplitude, 1)} Pa
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">DISTANCE (L)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.5" max="5.0" step="0.1"
                value={irrParams.L}
                onChange={(e) => setIrrParams(p => ({ ...p, L: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-16">L = {fmtFixed(irrParams.L, 1)} m</span>
            </div>
            
            <div className="text-[10px] text-cyan-400 font-bold mb-1 mt-3">TEMPERATURE</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="253" max="323" step="1"
                value={irrParams.temperature}
                onChange={(e) => setIrrParams(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-cyan-300 font-mono w-20">{fmtFixed(irrParams.temperature - 273, 0)}°C</span>
            </div>
          </div>
          
          <div className="bg-[#0a0a1a] rounded-lg border border-purple-900/30 p-3">
            <div className="text-[10px] text-purple-400 font-bold mb-2">HARMONIC — Base Frequency f₁</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="100" max="10000" step="50"
                value={harmParams.f1}
                onChange={(e) => setHarmParams(p => ({ ...p, f1: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-20">{fmtFixed(harmParams.f1, 0)} Hz</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              f₁ = {fmtFixed(harmParams.f1, 0)} Hz | f₂ = {fmtFixed(harmF2, 0)} Hz | R = 2.0
            </div>
            <div className="text-[9px] text-purple-600 mt-1">
              λ₁ = {fmtFixed(343 / harmParams.f1, 3)} m | λ₂ = {fmtFixed(343 / harmF2, 3)} m | T₁ = {fmtFixed(1000 / harmParams.f1, 2)} ms
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">AMPLITUDE (Sound Pressure)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.02" max="200" step="0.1"
                value={harmParams.amplitude}
                onChange={(e) => setHarmParams(p => ({ ...p, amplitude: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-20">{fmtFixed(harmParams.amplitude, 1)} Pa</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              {fmtFixed(pressureToDb(harmParams.amplitude), 1)} dB SPL | Threshold of pain: 120 dB (20 Pa)
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">AMPLITUDE RATIO (k = A₂/A₁)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.1" max="5.0" step="0.1"
                value={harmParams.amplitudeRatio}
                onChange={(e) => setHarmParams(p => ({ ...p, amplitudeRatio: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-16">k = {fmtFixed(harmParams.amplitudeRatio, 1)}</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-1">
              v(t) = A₁·sin(2πf₁t) + k·A₁·sin(2πf₂t) | A₂ = {fmtFixed(harmParams.amplitudeRatio * harmParams.amplitude, 1)} Pa
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">DISTANCE (L)</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="0.5" max="5.0" step="0.1"
                value={harmParams.L}
                onChange={(e) => setHarmParams(p => ({ ...p, L: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-16">L = {fmtFixed(harmParams.L, 1)} m</span>
            </div>
            
            <div className="text-[10px] text-purple-400 font-bold mb-1 mt-3">TEMPERATURE</div>
            <div className="flex items-center gap-2">
              <input
                type="range" min="253" max="323" step="1"
                value={harmParams.temperature}
                onChange={(e) => setHarmParams(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[10px] text-purple-300 font-mono w-20">{fmtFixed(harmParams.temperature - 273, 0)}°C</span>
            </div>
          </div>
        </div>

        {/* Acoustic Views */}
        <div className="grid grid-cols-2 gap-3">
          <section className="bg-[#0a0a1a] rounded-lg border-2 border-cyan-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-cyan-400">⚡ IRRATIONAL — R = {irrParams.R.toFixed(4)}</h2>
              <div className="text-[10px] text-gray-500">Peak: {fmtFixed(pressureToDb(irrMaxPeak), 1)} dB | t = {(irrState.time*1000).toFixed(1)} ms</div>
            </div>
            <div className="text-[9px] text-gray-500 mb-1">
              Speaker 1: f₁+f₂ → ← f₁+f₂ Speaker 2 | Distance: {fmtFixed(irrParams.L, 1)} m
            </div>
            <AcousticView state={irrState} params={irrParams} />
          </section>

          <section className="bg-[#0a0a1a] rounded-lg border-2 border-purple-900/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-bold text-purple-400">∿ HARMONIC — R = 2.0</h2>
              <div className="text-[10px] text-gray-500">Peak: {fmtFixed(pressureToDb(harmMaxPeak), 1)} dB | t = {(harmState.time*1000).toFixed(1)} ms</div>
            </div>
            <div className="text-[9px] text-gray-500 mb-1">
              Speaker 1: f₁+f₂ → ← f₁+f₂ Speaker 2 | Distance: {fmtFixed(harmParams.L, 1)} m
            </div>
            <AcousticView state={harmState} params={harmParams} />
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
        <section className="bg-[#0a0a1a] rounded-lg border-2 border-yellow-900/50 p-3">
          <h2 className="text-sm font-bold text-yellow-400 mb-2">📈 Combined Peak Comparison</h2>
          <PeakComparisonChart
            irrHistory={irrPeakHistory}
            harmHistory={harmPeakHistory}
            irrMax={irrMaxPeak}
            harmMax={harmMaxPeak}
          />
        </section>

        {/* Physical Constants */}
        <section className="bg-[#0a0a1a] rounded-lg border border-gray-800/50 p-3">
          <h2 className="text-xs font-bold text-gray-400 mb-2">📐 Physical Constants (Air at 20°C)</h2>
          <div className="grid grid-cols-4 gap-2 text-[9px]">
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500">Speed of Sound</div>
              <div className="text-cyan-400 font-bold">343 m/s</div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500">Air Density</div>
              <div className="text-cyan-400 font-bold">1.225 kg/m³</div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500">Atmospheric Pressure</div>
              <div className="text-cyan-400 font-bold">101325 Pa</div>
            </div>
            <div className="bg-gray-900/50 rounded p-2">
              <div className="text-gray-500">Temperature</div>
              <div className="text-cyan-400 font-bold">293 K (20°C)</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
