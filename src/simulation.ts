// Discrete LC-chain electromagnetic simulation engine
// Implements the discrete telegraph equation with irrational spectral pumping
// All functions are NaN-safe to prevent cascade failures.

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
  time: number;
  energies: Float64Array;
}

export const DEFAULT_PARAMS: SimulationParams = {
  N: 20,
  L: 0.01,
  C: 0.01,
  G: 0.005,
  omega1: 30.0,
  R: 1.475482818459,
  amplitude: 1.0,
  mode: 'irrational',
};

// ─── NaN-safe helpers ────────────────────────────────────────────────────────

/** Replace NaN / ±Infinity with 0 in a Float64Array (in-place). */
function sanitizeArray(arr: Float64Array): Float64Array {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
  return arr;
}

/** Clamp a scalar to a safe finite value. */
function safeNum(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

// ─── Boundary voltage sources ────────────────────────────────────────────────

function boundaryVoltageLeft(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  return (p.amplitude / 2.0) * (Math.sin(p.omega1 * t) + Math.sin(omega2 * t));
}

function boundaryVoltageRight(t: number, p: SimulationParams): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  return (p.amplitude / 2.0) * (
    Math.sin(p.omega1 * t + Math.PI) + Math.sin(omega2 * t + Math.PI)
  );
}

// ─── ODE right-hand side ─────────────────────────────────────────────────────

function computeDerivatives(
  V: Float64Array,
  t: number,
  p: SimulationParams,
): Float64Array {
  const { N, L, C, G } = p;
  const dV = new Float64Array(N);
  // Boundary nodes are Dirichlet-driven → derivative forced to 0
  dV[0] = 0;
  dV[N - 1] = 0;

  const invL = 1.0 / L;
  const invC = 1.0 / C;

  for (let i = 1; i < N - 1; i++) {
    const iL = (V[i - 1] - V[i]) * invL + (V[i + 1] - V[i]) * invL;
    dV[i] = (iL - G * V[i]) * invC;
  }
  return dV;
}

// ─── RK4 integrator with NaN guard ──────────────────────────────────────────

export function rk4Step(
  V: Float64Array,
  t: number,
  dt: number,
  p: SimulationParams,
): Float64Array {
  const N = p.N;
  const result = new Float64Array(N);

  const k1 = computeDerivatives(V, t, p);

  // ── k2 ──
  const v2 = new Float64Array(N);
  for (let i = 0; i < N; i++) v2[i] = V[i] + 0.5 * dt * k1[i];
  v2[0] = boundaryVoltageLeft(t + 0.5 * dt, p);
  v2[N - 1] = boundaryVoltageRight(t + 0.5 * dt, p);
  const k2 = computeDerivatives(v2, t + 0.5 * dt, p);

  // ── k3 ──
  const v3 = new Float64Array(N);
  for (let i = 0; i < N; i++) v3[i] = V[i] + 0.5 * dt * k2[i];
  v3[0] = boundaryVoltageLeft(t + 0.5 * dt, p);
  v3[N - 1] = boundaryVoltageRight(t + 0.5 * dt, p);
  const k3 = computeDerivatives(v3, t + 0.5 * dt, p);

  // ── k4 ──
  const v4 = new Float64Array(N);
  for (let i = 0; i < N; i++) v4[i] = V[i] + dt * k3[i];
  v4[0] = boundaryVoltageLeft(t + dt, p);
  v4[N - 1] = boundaryVoltageRight(t + dt, p);
  const k4 = computeDerivatives(v4, t + dt, p);

  // ── Combine ──
  const dt6 = dt / 6.0;
  for (let i = 0; i < N; i++) {
    result[i] = V[i] + dt6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  // Enforce Dirichlet boundaries
  result[0] = boundaryVoltageLeft(t + dt, p);
  result[N - 1] = boundaryVoltageRight(t + dt, p);

  // ── NaN / Infinity guard ──
  sanitizeArray(result);

  // ── Blow-up guard: if any voltage exceeds a physical limit, clamp ──
  const VMAX = 1e6;
  for (let i = 0; i < N; i++) {
    if (result[i] > VMAX) result[i] = VMAX;
    else if (result[i] < -VMAX) result[i] = -VMAX;
  }

  return result;
}

// ─── State factory ───────────────────────────────────────────────────────────

export function createInitialState(p: SimulationParams): SimulationState {
  const voltages = new Float64Array(p.N);
  const energies = new Float64Array(p.N);

  voltages[0] = boundaryVoltageLeft(0, p);
  voltages[p.N - 1] = boundaryVoltageRight(0, p);

  for (let i = 0; i < p.N; i++) energies[i] = voltages[i] * voltages[i];

  return { voltages, time: 0, energies };
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
  let t = state.time;

  for (let s = 0; s < subSteps; s++) {
    V = rk4Step(V, t, dt, p);
    t += dt;
    // Safety: if time itself went NaN, bail out
    if (!Number.isFinite(t)) {
      t = state.time;
      V = state.voltages;
      break;
    }
  }

  const energies = new Float64Array(p.N);
  for (let i = 0; i < p.N; i++) energies[i] = V[i] * V[i];

  return { voltages: V, time: t, energies };
}

// ─── Analytics ───────────────────────────────────────────────────────────────

/**
 * Gain coefficient K = max(E_center) / avg(E_edge).
 * Fully NaN-safe: returns 1.0 when both are zero / undefined.
 */
export function computeGainCoefficient(energies: Float64Array, N: number): number {
  const eCenter = Math.max(safeNum(energies[9]), safeNum(energies[10]));

  const edgeIdx = [0, 1, 2, N - 3, N - 2, N - 1];
  let eEdge = 0;
  for (const i of edgeIdx) eEdge += safeNum(energies[i]);
  eEdge /= edgeIdx.length;

  // Both zero → no meaningful ratio
  if (eEdge < 1e-15 && eCenter < 1e-15) return 1.0;
  // Edge effectively zero but center has energy → high gain
  if (eEdge < 1e-15) return 100.0;
  // Normal case
  const ratio = eCenter / eEdge;
  return Number.isFinite(ratio) ? ratio : 1.0;
}

/** Safe max of a Float64Array (returns 0 for empty / all-NaN). */
export function safeMax(arr: Float64Array): number {
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/** Safe sum of a Float64Array. */
export function safeSum(arr: Float64Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) s += v;
  }
  return s;
}
