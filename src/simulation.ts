// LC-Chain simulation with traveling wave decomposition
// Two sources at opposite ends emit waves that travel toward each other

export interface SimulationParams {
  N: number;
  L: number;
  C: number;
  G: number;
  omega1: number;
  R: number;
  amplitude: number;
  mode: 'irrational' | 'harmonic';
}

export interface SimulationState {
  voltages: Float64Array;
  currents: Float64Array;
  time: number;
  energies: Float64Array;
  vRight: Float64Array;
  vLeft: Float64Array;
}

export const DEFAULT_PARAMS: SimulationParams = {
  N: 160,
  L: 0.01,
  C: 0.01,
  G: 0.0,
  omega1: 31.0,
  R: 1.475482818459,
  amplitude: 5.0,
  mode: 'irrational',
};

// Frequency scale: ω=30 → 1 GHz
export const FREQ_SCALE_GHZ_PER_UNIT = 1.0 / 30.0;
export function omegaToGHz(omega: number): number {
  return omega * FREQ_SCALE_GHZ_PER_UNIT;
}

function sanitizeArray(arr: Float64Array): Float64Array {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
  return arr;
}

// Left source: V₀(t) = (A/2)·[sin(ω₁t) + sin(ω₂t)]
function boundaryVoltageLeft(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  return (p.amplitude / 2.0) * (Math.sin(p.omega1 * t) + Math.sin(omega2 * t));
}

// Right source: V_{N-1}(t) = (A/2)·[sin(ω₁t) + sin(ω₂t)] — in phase with left
function boundaryVoltageRight(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  return (p.amplitude / 2.0) * (Math.sin(p.omega1 * t) + Math.sin(omega2 * t));
}

// ODE: C·dV/dt = I_left - I_right - G·V, L·dI/dt = V_left - V_right
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

  for (let i = 1; i < N - 1; i++) {
    dV[i] = (I[i - 1] - I[i] - G * V[i]) * invC;
  }

  for (let i = 0; i < N - 1; i++) {
    dI[i] = (V[i] - V[i + 1]) * invL;
  }

  return { dV, dI };
}

// RK4 integrator
function rk4Step(
  V: Float64Array,
  I: Float64Array,
  t: number,
  dt: number,
  p: SimulationParams,
): { V: Float64Array; I: Float64Array } {
  const N = p.N;
  const nI = N - 1;

  const k1 = computeDerivatives(V, I, t, p);

  const v2 = new Float64Array(N);
  const i2 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v2[j] = V[j] + 0.5 * dt * k1.dV[j];
  for (let j = 0; j < nI; j++) i2[j] = I[j] + 0.5 * dt * k1.dI[j];
  v2[0] = boundaryVoltageLeft(t + 0.5 * dt, p);
  v2[N - 1] = boundaryVoltageRight(t + 0.5 * dt, p);
  const k2 = computeDerivatives(v2, i2, t + 0.5 * dt, p);

  const v3 = new Float64Array(N);
  const i3 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v3[j] = V[j] + 0.5 * dt * k2.dV[j];
  for (let j = 0; j < nI; j++) i3[j] = I[j] + 0.5 * dt * k2.dI[j];
  v3[0] = boundaryVoltageLeft(t + 0.5 * dt, p);
  v3[N - 1] = boundaryVoltageRight(t + 0.5 * dt, p);
  const k3 = computeDerivatives(v3, i3, t + 0.5 * dt, p);

  const v4 = new Float64Array(N);
  const i4 = new Float64Array(nI);
  for (let j = 0; j < N; j++) v4[j] = V[j] + dt * k3.dV[j];
  for (let j = 0; j < nI; j++) i4[j] = I[j] + dt * k3.dI[j];
  v4[0] = boundaryVoltageLeft(t + dt, p);
  v4[N - 1] = boundaryVoltageRight(t + dt, p);
  const k4 = computeDerivatives(v4, i4, t + dt, p);

  const newV = new Float64Array(N);
  const newI = new Float64Array(nI);
  const dt6 = dt / 6.0;

  for (let j = 0; j < N; j++) {
    newV[j] = V[j] + dt6 * (k1.dV[j] + 2 * k2.dV[j] + 2 * k3.dV[j] + k4.dV[j]);
  }
  for (let j = 0; j < nI; j++) {
    newI[j] = I[j] + dt6 * (k1.dI[j] + 2 * k2.dI[j] + 2 * k3.dI[j] + k4.dI[j]);
  }

  newV[0] = boundaryVoltageLeft(t + dt, p);
  newV[N - 1] = boundaryVoltageRight(t + dt, p);

  sanitizeArray(newV);
  sanitizeArray(newI);

  const VMAX = 1e6;
  for (let j = 0; j < N; j++) {
    if (newV[j] > VMAX) newV[j] = VMAX;
    else if (newV[j] < -VMAX) newV[j] = -VMAX;
  }
  for (let j = 0; j < nI; j++) {
    if (newI[j] > VMAX) newI[j] = VMAX;
    else if (newI[j] < -VMAX) newI[j] = -VMAX;
  }

  return { V: newV, I: newI };
}

// Traveling wave decomposition: V⁺ = (V + Z·I)/2, V⁻ = (V - Z·I)/2
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
    const iLocal = i < N - 1 ? I[i] : I[N - 2];
    vR[i] = (V[i] + Z * iLocal) / 2;
    vL[i] = (V[i] - Z * iLocal) / 2;
  }

  return { vRight: vR, vLeft: vL };
}

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

export function advanceSimulation(
  state: SimulationState,
  dtTotal: number,
  p: SimulationParams,
  subSteps = 5,
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

export function getCenterPeak(state: SimulationState): number {
  const N = state.voltages.length;
  const cIdx = Math.floor(N / 2);
  return Math.max(
    Number.isFinite(state.energies[cIdx - 1]) ? state.energies[cIdx - 1] : 0,
    Number.isFinite(state.energies[cIdx]) ? state.energies[cIdx] : 0
  );
}
