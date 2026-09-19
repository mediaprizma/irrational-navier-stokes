// Continuous wave simulation in spherical/cylindrical geometry
// Models EM waves in vacuum/ether as continuous medium, not discrete LC-chain
// 
// Wave equation in spherical coordinates (radial):
//   ∂²ψ/∂t² = c² · (∂²ψ/∂r² + (2/r)·∂ψ/∂r) - 2α·∂ψ/∂t
//
// For converging spherical wave: amplitude grows as 1/r
// For converging cylindrical wave: amplitude grows as 1/√r
//
// Two sources at opposite poles emit waves that converge at center.
// Irrational frequency ratio → quasi-periodic constructive interference.

export interface WaveParams {
  N: number;              // Number of radial grid points (from center to edge)
  c: number;              // Wave speed (speed of light in medium)
  alpha: number;          // Dissipation coefficient
  omega1: number;         // Base angular frequency
  R: number;              // Frequency ratio ω₂/ω₁
  amplitude: number;      // Source amplitude
  mode: 'irrational' | 'harmonic';
  geometry: 'linear' | 'cylindrical' | 'spherical';
  nonlinearMedium: boolean;  // Nonlinear medium effects
  criticalEnergy: number;    // Matter destruction threshold
  
  // Independent source control
  source1Freq1On: boolean;
  source1Freq2On: boolean;
  source2Freq1On: boolean;
  source2Freq2On: boolean;
}

export interface WaveState {
  // ψ₁(r,t) — wave from source 1 (left pole), traveling inward
  psi1: Float64Array;
  // ψ₂(r,t) — wave from source 2 (right pole), traveling inward
  psi2: Float64Array;
  // Total field at each radial point
  psiTotal: Float64Array;
  // Energy density at each point: E = ψ²
  energy: Float64Array;
  time: number;
}

export const DEFAULT_WAVE_PARAMS: WaveParams = {
  N: 100,
  c: 100.0,
  alpha: 0.001,
  omega1: 30.0,
  R: 1.475482818459,
  amplitude: 1.0,
  mode: 'irrational',
  geometry: 'spherical',
  nonlinearMedium: true,
  criticalEnergy: 50.0,
  source1Freq1On: true,
  source1Freq2On: true,
  source2Freq1On: true,
  source2Freq2On: true,
};

// Frequency scale: ω=30 → 1 GHz
export const FREQ_SCALE_GHZ_PER_UNIT = 1.0 / 30.0;
export function omegaToGHz(omega: number): number {
  return omega * FREQ_SCALE_GHZ_PER_UNIT;
}

function safeNum(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

// Geometric amplification factor for converging wave
// r is normalized distance from center (0 at center, 1 at edge)
function geometricFactor(r: number, geometry: string): number {
  const rSafe = Math.max(r, 0.02); // Prevent singularity at exact center
  switch (geometry) {
    case 'spherical':
      return 1.0 / (rSafe * rSafe);  // 1/r² energy density
    case 'cylindrical':
      return 1.0 / rSafe;            // 1/r energy density
    case 'linear':
    default:
      return 1.0;                     // No geometric effect
  }
}

// Source signal: sum of two frequencies
function sourceSignal(t: number, p: WaveParams, sourceIdx: number): number {
  const omega2 = p.mode === 'irrational' ? p.R * p.omega1 : 2.0 * p.omega1;
  const freq1On = sourceIdx === 1 ? p.source1Freq1On : p.source2Freq1On;
  const freq2On = sourceIdx === 1 ? p.source1Freq2On : p.source2Freq2On;
  
  let signal = 0;
  if (freq1On) signal += Math.sin(p.omega1 * t);
  if (freq2On) signal += Math.sin(omega2 * t);
  
  return p.amplitude * signal;
}

// Nonlinear medium: wave speed depends on amplitude
function effectiveWaveSpeed(c: number, psi: number, nonlinear: boolean): number {
  if (!nonlinear) return c;
  // At high amplitudes, wave speed increases slightly (self-focusing)
  return c * (1.0 + 0.05 * Math.tanh(psi * psi));
}

// Nonlinear dissipation: alpha drops at high amplitudes
function effectiveAlpha(alpha: number, psi: number, nonlinear: boolean): number {
  if (!nonlinear) return alpha;
  // At high amplitudes, dissipation drops dramatically
  return alpha / (1.0 + 5.0 * psi * psi);
}

// Advance simulation by dt using finite differences
// We solve the wave equation for each converging wave separately
export function advanceWaveSimulation(
  state: WaveState,
  dt: number,
  p: WaveParams,
): WaveState {
  const N = p.N;
  const dr = 1.0 / (N - 1); // Radial grid spacing (0 to 1)
  
  const newPsi1 = new Float64Array(N);
  const newPsi2 = new Float64Array(N);
  
  // Copy boundary values (sources at r=1, i.e., edge)
  const src1 = sourceSignal(state.time + dt, p, 1);
  const src2 = sourceSignal(state.time + dt, p, 2);
  
  // Update interior points using wave equation
  // For converging wave: ψ(r,t) propagates from r=1 toward r=0
  for (let i = 1; i < N - 1; i++) {
    const r = i * dr; // Distance from center (0 at center, 1 at edge)
    
    // For psi1 (converging from edge to center)
    const psi1_curr = safeNum(state.psi1[i]);
    const psi1_prev = safeNum(state.psi1[i + 1]); // Previous radial point (toward edge)
    const psi1_next = safeNum(state.psi1[i - 1]); // Next radial point (toward center)
    
    // Spatial derivatives
    const d2psi1_dr2 = (psi1_prev - 2 * psi1_curr + psi1_next) / (dr * dr);
    const dpsi1_dr = (psi1_next - psi1_prev) / (2 * dr);
    
    // Geometric term: (2/r)·∂ψ/∂r for spherical
    let geoTerm = 0;
    if (p.geometry === 'spherical') {
      geoTerm = (2.0 / Math.max(r, 0.01)) * dpsi1_dr;
    } else if (p.geometry === 'cylindrical') {
      geoTerm = (1.0 / Math.max(r, 0.01)) * dpsi1_dr;
    }
    
    // Effective parameters
    const cEff = effectiveWaveSpeed(p.c, psi1_curr, p.nonlinearMedium);
    const alphaEff = effectiveAlpha(p.alpha, psi1_curr, p.nonlinearMedium);
    
    // Wave equation: ∂²ψ/∂t² = c²·(∂²ψ/∂r² + geoTerm) - 2α·∂ψ/∂t
    // Using Verlet integration for stability
    const dpsi1_dt = (psi1_curr - (state as any).psi1_prev?.[i] || psi1_curr) / dt;
    const d2psi1_dt2 = cEff * cEff * (d2psi1_dr2 + geoTerm) - 2 * alphaEff * dpsi1_dt;
    
    newPsi1[i] = 2 * psi1_curr - ((state as any).psi1_prev?.[i] || psi1_curr) + d2psi1_dt2 * dt * dt;
    
    // Same for psi2
    const psi2_curr = safeNum(state.psi2[i]);
    const psi2_prev = safeNum(state.psi2[i + 1]);
    const psi2_next = safeNum(state.psi2[i - 1]);
    
    const d2psi2_dr2 = (psi2_prev - 2 * psi2_curr + psi2_next) / (dr * dr);
    const dpsi2_dr = (psi2_next - psi2_prev) / (2 * dr);
    
    let geoTerm2 = 0;
    if (p.geometry === 'spherical') {
      geoTerm2 = (2.0 / Math.max(r, 0.01)) * dpsi2_dr;
    } else if (p.geometry === 'cylindrical') {
      geoTerm2 = (1.0 / Math.max(r, 0.01)) * dpsi2_dr;
    }
    
    const cEff2 = effectiveWaveSpeed(p.c, psi2_curr, p.nonlinearMedium);
    const alphaEff2 = effectiveAlpha(p.alpha, psi2_curr, p.nonlinearMedium);
    
    const dpsi2_dt = (psi2_curr - (state as any).psi2_prev?.[i] || psi2_curr) / dt;
    const d2psi2_dt2 = cEff2 * cEff2 * (d2psi2_dr2 + geoTerm2) - 2 * alphaEff2 * dpsi2_dt;
    
    newPsi2[i] = 2 * psi2_curr - ((state as any).psi2_prev?.[i] || psi2_curr) + d2psi2_dt2 * dt * dt;
  }
  
  // Boundary conditions
  // At edge (r=1, i=N-1): source drives the wave
  newPsi1[N - 1] = src1;
  newPsi2[N - 1] = src2;
  
  // At center (r=0, i=0): waves converge and interfere
  // Apply geometric amplification at center
  const centerAmp1 = newPsi1[1] * geometricFactor(0.02, p.geometry);
  const centerAmp2 = newPsi2[1] * geometricFactor(0.02, p.geometry);
  newPsi1[0] = Number.isFinite(centerAmp1) ? Math.min(Math.max(centerAmp1, -1e6), 1e6) : 0;
  newPsi2[0] = Number.isFinite(centerAmp2) ? Math.min(Math.max(centerAmp2, -1e6), 1e6) : 0;
  
  // Sanitize
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(newPsi1[i])) newPsi1[i] = 0;
    if (!Number.isFinite(newPsi2[i])) newPsi2[i] = 0;
  }
  
  // Total field = superposition
  const psiTotal = new Float64Array(N);
  const energy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    psiTotal[i] = newPsi1[i] + newPsi2[i];
    energy[i] = psiTotal[i] * psiTotal[i];
  }
  
  // Store previous state for Verlet integration
  const result: any = {
    psi1: newPsi1,
    psi2: newPsi2,
    psiTotal,
    energy,
    time: state.time + dt,
    psi1_prev: state.psi1,
    psi2_prev: state.psi2,
  };
  
  return result as WaveState;
}

export function createInitialWaveState(p: WaveParams): WaveState {
  const N = p.N;
  const psi1 = new Float64Array(N);
  const psi2 = new Float64Array(N);
  const psiTotal = new Float64Array(N);
  const energy = new Float64Array(N);
  
  // Initial conditions: sources at edge
  psi1[N - 1] = sourceSignal(0, p, 1);
  psi2[N - 1] = sourceSignal(0, p, 2);
  
  const result: any = {
    psi1, psi2, psiTotal, energy, time: 0,
    psi1_prev: new Float64Array(N),
    psi2_prev: new Float64Array(N),
  };
  
  return result as WaveState;
}

export function getCenterPeakEnergy(state: WaveState): number {
  const N = state.psiTotal.length;
  // Check center and near-center points
  let maxE = 0;
  for (let i = 0; i < Math.min(5, N); i++) {
    const e = safeNum(state.energy[i]);
    if (e > maxE) maxE = e;
  }
  return maxE;
}

export function getEdgeEnergy(state: WaveState): number {
  const N = state.psiTotal.length;
  let sum = 0;
  let count = 0;
  for (let i = N - 5; i < N; i++) {
    sum += safeNum(state.energy[i]);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

export function checkDestruction(state: WaveState, threshold: number): boolean {
  return getCenterPeakEnergy(state) >= threshold;
}
