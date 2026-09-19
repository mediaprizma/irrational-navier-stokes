// Discrete LC-chain electromagnetic simulation engine
// Implements the discrete telegraph equation with irrational spectral pumping
// Tracks both node voltages AND inter-node currents for traveling-wave decomposition.

export interface SimulationParams {
  N: number;
  L: number;
  C: number;
  G: number;
  omega1: number;
  R: number;
  amplitude: number;
  mode: 'irrational' | 'harmonic';
  reflectiveBoundaries?: boolean;  // Если true — границы отражают волны
  // Independent frequency control for each source
  leftFreq1Enabled?: boolean;   // Enable f₁ on left source
  leftFreq2Enabled?: boolean;   // Enable f₂ on left source
  rightFreq1Enabled?: boolean;  // Enable f₁ on right source
  rightFreq2Enabled?: boolean;  // Enable f₂ on right source
}

export interface SimulationState {
  voltages: Float64Array;   // V_i for each node (length N)
  currents: Float64Array;   // I_i = current from node i to node i+1 (length N-1)
  time: number;
  energies: Float64Array;   // E_i = V_i^2
  // Traveling wave decomposition (computed on the fly)
  vRight: Float64Array;     // V⁺ rightward wave at each node
  vLeft: Float64Array;      // V⁻ leftward wave at each node
}

export const DEFAULT_PARAMS: SimulationParams = {
  N: 80,
  L: 0.01,
  C: 0.01,
  G: 0.0001,  // Минимальная диссипация — чтобы энергия накапливалась
  omega1: 30.0,
  R: 1.475482818459,
  amplitude: 1.0,
  mode: 'irrational',
  reflectiveBoundaries: true,  // Отражающие границы для накопления энергии
  // All frequencies enabled by default
  leftFreq1Enabled: true,
  leftFreq2Enabled: true,
  rightFreq1Enabled: true,
  rightFreq2Enabled: true,
};

// Frequency display scale: ω_sim = 30 rad/s corresponds to f = 1 GHz
// So: f_GHz = ω_sim / (2π × 30) × 1 = ω_sim / 30 (in our units)
// More precisely: we define 1 "simulation frequency unit" = 1/30 GHz
export const FREQ_SCALE_GHZ_PER_UNIT = 1.0 / 30.0; // ω=30 → 1 GHz
export function omegaToGHz(omega: number): number {
  return omega * FREQ_SCALE_GHZ_PER_UNIT;
}
export function GHzToOmega(fGHz: number): number {
  return fGHz / FREQ_SCALE_GHZ_PER_UNIT;
}
// With N=80, c=1/√(LC)=100:
//   λ₁ = 2π·c/ω₁ ≈ 21 nodes → ~4 wavelengths fit in the line → visible nodes/antinodes
//   λ₂ = 2π·c/ω₂ ≈ 14 nodes → ~6 wavelengths fit in the line
// Two standing wave patterns with different numbers of antinodes interfere!

// ─── NaN-safe helpers ────────────────────────────────────────────────────────

function sanitizeArray(arr: Float64Array): Float64Array {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
  return arr;
}

function safeNum(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

// ─── Boundary voltage sources ────────────────────────────────────────────────

export function boundaryVoltageLeft(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  const f1 = p.leftFreq1Enabled !== false ? Math.sin(p.omega1 * t) : 0;
  const f2 = p.leftFreq2Enabled !== false ? Math.sin(omega2 * t) : 0;
  return (p.amplitude / 2.0) * (f1 + f2);
}

export function boundaryVoltageRight(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  // In-phase with left source: both start at peak simultaneously
  // so waves meet head-on and constructively interfere at center
  const f1 = p.rightFreq1Enabled !== false ? Math.sin(p.omega1 * t) : 0;
  const f2 = p.rightFreq2Enabled !== false ? Math.sin(omega2 * t) : 0;
  return (p.amplitude / 2.0) * (f1 + f2);
}

// ─── ODE right-hand side ─────────────────────────────────────────────────────
// State vector: [V_1, V_2, ..., V_{N-2}, I_0, I_1, ..., I_{N-2}]
// where I_i is current through inductor from node i to node i+1.
//
// Equations:
//   C dV_i/dt = I_{i-1} - I_i - G V_i    (KCL at node i)
//   L dI_i/dt = V_i - V_{i+1}             (KVL across inductor i→i+1)
//
// Boundary: V_0 and V_{N-1} are driven sources.

function computeDerivatives(
  V: Float64Array,
  I: Float64Array,
  t: number,
  p: SimulationParams,
): { dV: Float64Array; dI: Float64Array } {
  const { N, L, C, G } = p;
  const dV = new Float64Array(N);
  const dI = new Float64Array(N - 1);

  const invC = 1.0 / C;
  const invL = 1.0 / L;

  // KCL at internal nodes
  for (let i = 1; i < N - 1; i++) {
    const iLeft = I[i - 1];   // current flowing INTO node i from left
    const iRight = I[i];      // current flowing OUT of node i to right
    dV[i] = (iLeft - iRight - G * V[i]) * invC;
  }

  // KVL across each inductor
  for (let i = 0; i < N - 1; i++) {
    dI[i] = (V[i] - V[i + 1]) * invL;
  }

  return { dV, dI };
}

// ─── RK4 integrator ─────────────────────────────────────────────────────────

export function rk4Step(
  V: Float64Array,
  I: Float64Array,
  t: number,
  dt: number,
  p: SimulationParams,
): { V: Float64Array; I: Float64Array } {
  const N = p.N;
  const nI = N - 1;

  const k1 = computeDerivatives(V, I, t, p);

  // Helper for boundary conditions
  const applyBoundary = (v: Float64Array, tLocal: number) => {
    if (p.reflectiveBoundaries) {
      const reflectionCoeff = 0.85;
      const sourceLeft = boundaryVoltageLeft(tLocal, p);
      const sourceRight = boundaryVoltageRight(tLocal, p);
      v[0] = (sourceLeft + reflectionCoeff * v[1]) / (1 + reflectionCoeff);
      v[N - 1] = (sourceRight + reflectionCoeff * v[N - 2]) / (1 + reflectionCoeff);
    } else {
      v[0] = boundaryVoltageLeft(tLocal, p);
      v[N - 1] = boundaryVoltageRight(tLocal, p);
    }
  };

  // k2
  const v2 = new Float64Array(N);
  const i2 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v2[j] = V[j] + 0.5 * dt * k1.dV[j];
  for (let j = 0; j < nI; j++) i2[j] = I[j] + 0.5 * dt * k1.dI[j];
  applyBoundary(v2, t + 0.5 * dt);
  const k2 = computeDerivatives(v2, i2, t + 0.5 * dt, p);

  // k3
  const v3 = new Float64Array(N);
  const i3 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v3[j] = V[j] + 0.5 * dt * k2.dV[j];
  for (let j = 0; j < nI; j++) i3[j] = I[j] + 0.5 * dt * k2.dI[j];
  applyBoundary(v3, t + 0.5 * dt);
  const k3 = computeDerivatives(v3, i3, t + 0.5 * dt, p);

  // k4
  const v4 = new Float64Array(N);
  const i4 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v4[j] = V[j] + dt * k3.dV[j];
  for (let j = 0; j < nI; j++) i4[j] = I[j] + dt * k3.dI[j];
  applyBoundary(v4, t + dt);
  const k4 = computeDerivatives(v4, i4, t + dt, p);

  // Combine
  const newV = new Float64Array(N);
  const newI = new Float64Array(nI);
  const dt6 = dt / 6.0;

  for (let j = 0; j < N; j++) {
    newV[j] = V[j] + dt6 * (k1.dV[j] + 2 * k2.dV[j] + 2 * k3.dV[j] + k4.dV[j]);
  }
  for (let j = 0; j < nI; j++) {
    newI[j] = I[j] + dt6 * (k1.dI[j] + 2 * k2.dI[j] + 2 * k3.dI[j] + k4.dI[j]);
  }

  // Boundary conditions
  if (p.reflectiveBoundaries) {
    // Reflective boundaries: source + reflected wave
    // Waves bounce back and interfere, accumulating energy at center
    const reflectionCoeff = 0.85;  // 85% reflection
    const sourceLeft = boundaryVoltageLeft(t + dt, p);
    const sourceRight = boundaryVoltageRight(t + dt, p);
    
    // V[0] = source + reflection * (V[1] - V[0])
    // Rearranging: V[0] * (1 + reflectionCoeff) = source + reflectionCoeff * V[1]
    newV[0] = (sourceLeft + reflectionCoeff * newV[1]) / (1 + reflectionCoeff);
    newV[N - 1] = (sourceRight + reflectionCoeff * newV[N - 2]) / (1 + reflectionCoeff);
  } else {
    // Absorbing boundaries: waves are absorbed by sources (no reflection)
    newV[0] = boundaryVoltageLeft(t + dt, p);
    newV[N - 1] = boundaryVoltageRight(t + dt, p);
  }

  // NaN / Infinity guard
  sanitizeArray(newV);
  sanitizeArray(newI);

  // Blow-up guard
  const VMAX = 1e6;
  const IMAX = 1e6;
  for (let j = 0; j < N; j++) {
    if (newV[j] > VMAX) newV[j] = VMAX;
    else if (newV[j] < -VMAX) newV[j] = -VMAX;
  }
  for (let j = 0; j < nI; j++) {
    if (newI[j] > IMAX) newI[j] = IMAX;
    else if (newI[j] < -IMAX) newI[j] = -IMAX;
  }

  return { V: newV, I: newI };
}

// ─── Traveling wave decomposition ────────────────────────────────────────────
// V⁺_i = (V_i + Z * I_i) / 2   (rightward wave, using current INTO node from left)
// V⁻_i = (V_i - Z * I_i) / 2   (leftward wave)
// where Z = sqrt(L/C) is characteristic impedance.
// At boundaries we extrapolate from nearest internal node.

function computeTravelingWaves(
  V: Float64Array,
  I: Float64Array,
  p: SimulationParams,
): { vRight: Float64Array; vLeft: Float64Array } {
  const N = p.N;
  const Z = Math.sqrt(p.L / p.C);
  const vR = new Float64Array(N);
  const vL = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    // Use the current on the inductor to the right of node i (or left for last node)
    let iLocal: number;
    if (i < N - 1) {
      iLocal = I[i]; // current flowing right from node i
    } else {
      iLocal = I[N - 2]; // extrapolate from last inductor
    }
    vR[i] = (V[i] + Z * iLocal) / 2;
    vL[i] = (V[i] - Z * iLocal) / 2;
  }

  return { vRight: vR, vLeft: vL };
}

// ─── State factory ───────────────────────────────────────────────────────────

export function createInitialState(p: SimulationParams): SimulationState {
  const voltages = new Float64Array(p.N);
  const currents = new Float64Array(p.N - 1);
  const energies = new Float64Array(p.N);

  voltages[0] = boundaryVoltageLeft(0, p);
  voltages[p.N - 1] = boundaryVoltageRight(0, p);

  for (let i = 0; i < p.N; i++) energies[i] = voltages[i] * voltages[i];

  const waves = computeTravelingWaves(voltages, currents, p);

  return { voltages, currents, time: 0, energies, vRight: waves.vRight, vLeft: waves.vLeft };
}

// ─── Time advance ────────────────────────────────────────────────────────────

export function advanceSimulation(
  state: SimulationState,
  dtTotal: number,
  p: SimulationParams,
  subSteps = 10,
): SimulationState {
  const dt = dtTotal / subSteps;
  let V = state.voltages;
  let I = state.currents;
  let t = state.time;

  for (let s = 0; s < subSteps; s++) {
    const result = rk4Step(V, I, t, dt, p);
    V = result.V;
    I = result.I;
    t += dt;
    if (!Number.isFinite(t)) {
      t = state.time;
      V = state.voltages;
      I = state.currents;
      break;
    }
  }

  const energies = new Float64Array(p.N);
  for (let i = 0; i < p.N; i++) energies[i] = V[i] * V[i];

  const waves = computeTravelingWaves(V, I, p);

  return { voltages: V, currents: I, time: t, energies, vRight: waves.vRight, vLeft: waves.vLeft };
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export function computeGainCoefficient(energies: Float64Array, N: number): number {
  const cIdx1 = Math.floor(N / 2) - 1;
  const cIdx2 = Math.floor(N / 2);
  const eCenter = Math.max(safeNum(energies[cIdx1]), safeNum(energies[cIdx2]));
  const edgeIdx = [0, 1, 2, 3, N - 4, N - 3, N - 2, N - 1];
  let eEdge = 0;
  for (const i of edgeIdx) eEdge += safeNum(energies[i]);
  eEdge /= edgeIdx.length;
  if (eEdge < 1e-15 && eCenter < 1e-15) return 1.0;
  if (eEdge < 1e-15) return 100.0;
  const ratio = eCenter / eEdge;
  return Number.isFinite(ratio) ? ratio : 1.0;
}

export function safeMax(arr: Float64Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

export function safeSum(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) s += v;
  }
  return s;
}
