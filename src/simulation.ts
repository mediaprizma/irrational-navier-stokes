// Discrete LC-chain electromagnetic simulation engine
// Implements the discrete telegraph equation with irrational spectral pumping

export interface SimulationParams {
  N: number;           // Number of nodes
  L: number;           // Inductance
  C: number;           // Capacitance
  G: number;           // Leakage conductance (dissipation)
  omega1: number;      // Base angular frequency
  R: number;           // Irrational ratio (omega2 / omega1)
  amplitude: number;   // Pumping amplitude A
  mode: 'irrational' | 'harmonic'; // Pumping mode
}

export interface SimulationState {
  voltages: Float64Array;  // V_i for each node
  time: number;            // Current simulation time
  energies: Float64Array;  // E_i = V_i^2
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
// Note: with L=C=0.01, the passband extends to ω_max = 2/√(LC) = 200
// For ω₁ = 30: λ₁ ≈ 21 nodes (comparable to chain length N=20)
// For ω₂ ≈ 44.3: λ₂ ≈ 14 nodes — both create visible spatial patterns

// Boundary voltage functions
function boundaryVoltageLeft(t: number, params: SimulationParams): number {
  const { amplitude, omega1, mode, R } = params;
  const omega2 = mode === 'irrational' ? R * omega1 : 2.0 * omega1;
  return (amplitude / 2.0) * (Math.sin(omega1 * t) + Math.sin(omega2 * t));
}

function boundaryVoltageRight(t: number, params: SimulationParams): number {
  const { amplitude, omega1, mode, R } = params;
  const omega2 = mode === 'irrational' ? R * omega1 : 2.0 * omega1;
  return (amplitude / 2.0) * (Math.sin(omega1 * t + Math.PI) + Math.sin(omega2 * t + Math.PI));
}

// Compute dV/dt for internal nodes
function computeDerivatives(
  voltages: Float64Array,
  t: number,
  params: SimulationParams
): Float64Array {
  const { N, L, C, G } = params;
  const dVdt = new Float64Array(N);

  // Boundary nodes are driven (not integrated)
  dVdt[0] = 0;
  dVdt[N - 1] = 0;

  // Internal nodes: C * dV_i/dt = (V_{i-1} - V_i)/L + (V_{i+1} - V_i)/L - G * V_i
  for (let i = 1; i < N - 1; i++) {
    const currentLeft = (voltages[i - 1] - voltages[i]) / L;
    const currentRight = (voltages[i + 1] - voltages[i]) / L;
    const leakage = G * voltages[i];
    dVdt[i] = (currentLeft + currentRight - leakage) / C;
  }

  return dVdt;
}

// RK4 integration step
export function rk4Step(
  voltages: Float64Array,
  t: number,
  dt: number,
  params: SimulationParams
): Float64Array {
  const N = params.N;
  const newVoltages = new Float64Array(N);

  // k1
  const k1 = computeDerivatives(voltages, t, params);

  // k2
  const v2 = new Float64Array(N);
  for (let i = 0; i < N; i++) v2[i] = voltages[i] + 0.5 * dt * k1[i];
  // Set boundary conditions at intermediate time
  v2[0] = boundaryVoltageLeft(t + 0.5 * dt, params);
  v2[N - 1] = boundaryVoltageRight(t + 0.5 * dt, params);
  const k2 = computeDerivatives(v2, t + 0.5 * dt, params);

  // k3
  const v3 = new Float64Array(N);
  for (let i = 0; i < N; i++) v3[i] = voltages[i] + 0.5 * dt * k2[i];
  v3[0] = boundaryVoltageLeft(t + 0.5 * dt, params);
  v3[N - 1] = boundaryVoltageRight(t + 0.5 * dt, params);
  const k3 = computeDerivatives(v3, t + 0.5 * dt, params);

  // k4
  const v4 = new Float64Array(N);
  for (let i = 0; i < N; i++) v4[i] = voltages[i] + dt * k3[i];
  v4[0] = boundaryVoltageLeft(t + dt, params);
  v4[N - 1] = boundaryVoltageRight(t + dt, params);
  const k4 = computeDerivatives(v4, t + dt, params);

  // Combine
  for (let i = 0; i < N; i++) {
    newVoltages[i] = voltages[i] + (dt / 6.0) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }

  // Enforce boundary conditions
  newVoltages[0] = boundaryVoltageLeft(t + dt, params);
  newVoltages[N - 1] = boundaryVoltageRight(t + dt, params);

  return newVoltages;
}

// Initialize simulation state
export function createInitialState(params: SimulationParams): SimulationState {
  const voltages = new Float64Array(params.N);
  const energies = new Float64Array(params.N);

  // Set initial boundary conditions
  voltages[0] = boundaryVoltageLeft(0, params);
  voltages[params.N - 1] = boundaryVoltageRight(0, params);

  // Compute initial energies
  for (let i = 0; i < params.N; i++) {
    energies[i] = voltages[i] * voltages[i];
  }

  return { voltages, time: 0, energies };
}

// Advance simulation by dt_total using multiple RK4 sub-steps
export function advanceSimulation(
  state: SimulationState,
  dtTotal: number,
  params: SimulationParams,
  subSteps: number = 10
): SimulationState {
  const dt = dtTotal / subSteps;
  let voltages = state.voltages;
  let t = state.time;

  for (let s = 0; s < subSteps; s++) {
    voltages = rk4Step(voltages, t, dt, params);
    t += dt;
  }

  const energies = new Float64Array(params.N);
  for (let i = 0; i < params.N; i++) {
    energies[i] = voltages[i] * voltages[i];
  }

  return { voltages, time: t, energies };
}

// Compute gain coefficient: max center energy / average edge energy
export function computeGainCoefficient(energies: Float64Array, N: number): number {
  // Center nodes: i = 9, 10
  const centerEnergy = Math.max(energies[9], energies[10]);

  // Edge nodes: i = 0, 1, 2 and i = N-3, N-2, N-1
  let edgeEnergy = 0;
  const edgeNodes = [0, 1, 2, N - 3, N - 2, N - 1];
  for (const idx of edgeNodes) {
    edgeEnergy += energies[idx];
  }
  edgeEnergy /= edgeNodes.length;

  if (edgeEnergy < 1e-12) return centerEnergy > 1e-12 ? 100 : 1;
  return centerEnergy / edgeEnergy;
}
