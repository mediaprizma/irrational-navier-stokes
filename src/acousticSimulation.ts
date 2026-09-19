// Real acoustic wave simulation in air
// Based on actual physics of sound waves

// Physical constants for air at 20°C
export const PHYSICAL_CONSTANTS = {
  // Speed of sound in air (m/s)
  c: 343.0,
  
  // Air density (kg/m³)
  rho: 1.225,
  
  // Atmospheric pressure (Pa)
  P0: 101325.0,
  
  // Temperature (K)
  T: 293.0,
  
  // Specific heat ratio for air
  gamma: 1.4,
  
  // Gas constant (J/(mol·K))
  R: 8.314,
  
  // Molar mass of air (kg/mol)
  M: 0.029,
};

// Calculate speed of sound from temperature
export function speedOfSound(T: number): number {
  return Math.sqrt(PHYSICAL_CONSTANTS.gamma * PHYSICAL_CONSTANTS.R * T / PHYSICAL_CONSTANTS.M);
}

export interface AcousticParams {
  N: number;              // Number of grid points
  L: number;              // Distance between speakers (m)
  f1: number;             // Base frequency (Hz)
  R: number;              // Frequency ratio
  amplitude: number;      // Pressure amplitude (Pa)
  amplitudeRatio: number; // Amplitude weight for second frequency (k)
  mode: 'irrational' | 'harmonic';
  temperature: number;    // Air temperature (K)
}

export interface AcousticState {
  pressure: Float64Array;      // Acoustic pressure (Pa) — current
  pressurePrev: Float64Array;  // Acoustic pressure (Pa) — previous timestep
  velocity: Float64Array;      // Particle velocity (m/s)
  time: number;
  energyDensity: Float64Array; // Energy density (J/m³)
}

export const DEFAULT_ACOUSTIC_PARAMS: AcousticParams = {
  N: 200,
  L: 3.0,              // 3 meters between speakers
  f1: 3050.0,          // 3050 Hz base frequency
  R: 1.475482818459,
  amplitude: 20.0,     // 20 Pa (~120 dB SPL)
  amplitudeRatio: 1.0, // Equal amplitude for both frequencies
  mode: 'irrational',
  temperature: 293.0,  // 20°C
};

// Convert pressure to dB SPL
export function pressureToDb(p: number): number {
  const pRef = 20e-6; // Reference pressure (20 μPa)
  return 20 * Math.log10(Math.abs(p) / pRef);
}

// Convert dB SPL to pressure
export function dbToPressure(db: number): number {
  const pRef = 20e-6;
  return pRef * Math.pow(10, db / 20);
}

function sanitizeArray(arr: Float64Array): Float64Array {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) arr[i] = 0;
  }
  return arr;
}

// Left speaker: p₀(t) = A₁·sin(2πf₁t) + k·A₁·sin(2πf₂t)
// where k = amplitudeRatio (weight of second frequency)
function leftSpeaker(t: number, p: AcousticParams): number {
  const f2 = p.mode === 'irrational' ? p.R * p.f1 : 2.0 * p.f1;
  const A1 = p.amplitude;
  const A2 = p.amplitudeRatio * A1;
  return A1 * Math.sin(2 * Math.PI * p.f1 * t) + A2 * Math.sin(2 * Math.PI * f2 * t);
}

// Right speaker: p_L(t) = A₁·sin(2πf₁t) + k·A₁·sin(2πf₂t) — in phase
function rightSpeaker(t: number, p: AcousticParams): number {
  const f2 = p.mode === 'irrational' ? p.R * p.f1 : 2.0 * p.f1;
  const A1 = p.amplitude;
  const A2 = p.amplitudeRatio * A1;
  return A1 * Math.sin(2 * Math.PI * p.f1 * t) + A2 * Math.sin(2 * Math.PI * f2 * t);
}

// Wave equation: ∂²p/∂t² = c²·∂²p/∂x²
// Using Verlet integration: p(t+dt) = 2p(t) - p(t-dt) + (c·dt/dx)²·(p[i-1] - 2p[i] + p[i+1])
export function advanceAcousticSimulation(
  state: AcousticState,
  dt: number,
  params: AcousticParams,
): AcousticState {
  const { N, L, temperature } = params;
  const dx = L / (N - 1);
  const c = speedOfSound(temperature);
  
  const newPressure = new Float64Array(N);
  const newVelocity = new Float64Array(N);
  
  // Boundary conditions (speakers at x=0 and x=L)
  newPressure[0] = leftSpeaker(state.time + dt, params);
  newPressure[N - 1] = rightSpeaker(state.time + dt, params);
  
  // Courant number for stability check
  const courant = c * dt / dx;
  if (courant > 1) {
    console.warn('Courant number > 1, simulation may be unstable');
  }
  
  // Update interior points using wave equation (Verlet scheme)
  const courant2 = courant * courant;
  
  for (let i = 1; i < N - 1; i++) {
    const p_left = state.pressure[i - 1];
    const p_curr = state.pressure[i];
    const p_right = state.pressure[i + 1];
    const p_prev = state.pressurePrev[i]; // pressure at t-dt
    
    // Verlet: p(t+dt) = 2p(t) - p(t-dt) + (c·dt/dx)²·(p[i-1] - 2p[i] + p[i+1])
    newPressure[i] = 2 * p_curr - p_prev + courant2 * (p_left - 2 * p_curr + p_right);
    
    // Particle velocity from pressure gradient
    // Euler equation: ρ·∂v/∂t = -∂p/∂x
    const dp_dx = (p_right - p_left) / (2 * dx);
    newVelocity[i] = state.velocity[i] - (dt / PHYSICAL_CONSTANTS.rho) * dp_dx;
  }
  
  // Boundary velocities (zero at rigid speakers)
  newVelocity[0] = 0;
  newVelocity[N - 1] = 0;
  
  // Energy density: E = p²/(2ρc²) + ρv²/2
  const energyDensity = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = newPressure[i];
    const v = newVelocity[i];
    energyDensity[i] = (p * p) / (2 * PHYSICAL_CONSTANTS.rho * c * c) + 0.5 * PHYSICAL_CONSTANTS.rho * v * v;
  }
  
  sanitizeArray(newPressure);
  sanitizeArray(newVelocity);
  sanitizeArray(energyDensity);
  
  return {
    pressure: newPressure,
    pressurePrev: state.pressure, // current becomes previous for next step
    velocity: newVelocity,
    time: state.time + dt,
    energyDensity,
  };
}

export function createInitialAcousticState(params: AcousticParams): AcousticState {
  const N = params.N;
  const pressure = new Float64Array(N);
  const pressurePrev = new Float64Array(N);
  const velocity = new Float64Array(N);
  const energyDensity = new Float64Array(N);
  
  // Initial conditions
  pressure[0] = leftSpeaker(0, params);
  pressure[N - 1] = rightSpeaker(0, params);
  
  // Initialize pressurePrev to same as pressure (no previous state)
  for (let i = 0; i < N; i++) {
    pressurePrev[i] = pressure[i];
  }
  
  return { pressure, pressurePrev, velocity, time: 0, energyDensity };
}

export function getCenterPeakEnergy(state: AcousticState): number {
  const N = state.pressure.length;
  const cIdx = Math.floor(N / 2);
  return Math.max(
    Number.isFinite(state.energyDensity[cIdx - 1]) ? state.energyDensity[cIdx - 1] : 0,
    Number.isFinite(state.energyDensity[cIdx]) ? state.energyDensity[cIdx] : 0,
    Number.isFinite(state.energyDensity[cIdx + 1]) ? state.energyDensity[cIdx + 1] : 0
  );
}

export function getCenterPeakPressure(state: AcousticState): number {
  const N = state.pressure.length;
  const cIdx = Math.floor(N / 2);
  return Math.max(
    Math.abs(Number.isFinite(state.pressure[cIdx - 1]) ? state.pressure[cIdx - 1] : 0),
    Math.abs(Number.isFinite(state.pressure[cIdx]) ? state.pressure[cIdx] : 0),
    Math.abs(Number.isFinite(state.pressure[cIdx + 1]) ? state.pressure[cIdx + 1] : 0)
  );
}
