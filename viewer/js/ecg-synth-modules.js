// ECG Synthesis Modules - Teaching-Indistinguishable Architecture
// Step 1: Refactored into 5 explicit modules for independent testing and swapping
import { ECG_SCHEMA_VERSION, clamp, lerp } from "./ecg-core.js";

// ============================================================================
// UTILITIES
// ============================================================================

export function norm(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n === 0 ? [1, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
}

export function axisDir(axisDeg, z) {
  const th = (axisDeg * Math.PI) / 180;
  return norm([Math.cos(th), Math.sin(th), z || 0]);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ============================================================================
// WAVE BASIS TOOLKIT (Step 2: Morphology Upgrade)
// Provides primitives for realistic waveform generation in VCG domain
// ============================================================================

/**
 * Standard Gaussian wave component
 * @param {number} t - time
 * @param {number} mu - center time
 * @param {number} sigma - width
 * @param {number} amp - amplitude
 */
export function gaussianWave(t, mu, sigma, amp) {
  const x = (t - mu) / sigma;
  return amp * Math.exp(-0.5 * x * x);
}

/**
 * Asymmetric Gaussian - different rise/decay characteristics
 * More realistic for P waves and T waves which have asymmetric shapes
 * @param {number} t - time
 * @param {number} mu - peak time
 * @param {number} sigmaL - left (rise) sigma
 * @param {number} sigmaR - right (decay) sigma
 * @param {number} amp - amplitude
 */
export function asymmetricGaussian(t, mu, sigmaL, sigmaR, amp) {
  const sigma = t < mu ? sigmaL : sigmaR;
  const x = (t - mu) / sigma;
  return amp * Math.exp(-0.5 * x * x);
}

/**
 * Generalized Gaussian (super-Gaussian)
 * Controls "pointiness" - p=2 is standard Gaussian, p>2 is flatter top, p<2 is sharper
 * Useful for QRS (sharper) vs T wave (broader)
 * @param {number} t - time
 * @param {number} mu - center time
 * @param {number} sigma - width
 * @param {number} amp - amplitude
 * @param {number} p - shape parameter (default 2 = standard Gaussian)
 */
export function generalizedGaussian(t, mu, sigma, amp, p = 2) {
  const x = Math.abs((t - mu) / sigma);
  return amp * Math.exp(-Math.pow(x, p) / 2);
}

/**
 * Asymmetric Generalized Gaussian - combines asymmetry with shape control
 * @param {number} t - time
 * @param {number} mu - peak time
 * @param {number} sigmaL - left sigma
 * @param {number} sigmaR - right sigma
 * @param {number} amp - amplitude
 * @param {number} pL - left shape parameter
 * @param {number} pR - right shape parameter
 */
export function asymmetricGeneralizedGaussian(t, mu, sigmaL, sigmaR, amp, pL = 2, pR = 2) {
  const sigma = t < mu ? sigmaL : sigmaR;
  const p = t < mu ? pL : pR;
  const x = Math.abs((t - mu) / sigma);
  return amp * Math.exp(-Math.pow(x, p) / 2);
}

/**
 * Hermite function basis - useful for capturing notches and slurs in QRS
 * Hermite functions are orthogonal and can represent complex morphologies
 * @param {number} t - time (normalized)
 * @param {number} n - order (0, 1, 2, 3, ...)
 */
export function hermiteFunction(t, n) {
  // Hermite polynomials H_n(t) * exp(-t^2/2) / sqrt(2^n * n! * sqrt(pi))
  const expTerm = Math.exp(-t * t / 2);

  // First few Hermite polynomials
  switch (n) {
    case 0: return expTerm * 0.7511; // 1/pi^0.25
    case 1: return expTerm * t * 1.0622; // sqrt(2)/pi^0.25
    case 2: return expTerm * (t * t - 1) * 0.5311; // 1/(sqrt(2)*pi^0.25)
    case 3: return expTerm * (t * t * t - 3 * t) * 0.3066; // 1/(sqrt(6)*pi^0.25)
    case 4: return expTerm * (t * t * t * t - 6 * t * t + 3) * 0.1533;
    default: return 0;
  }
}

/**
 * QRS complex using Hermite basis expansion
 * Allows for notched, slurred, and complex QRS morphologies
 * @param {number} t - time relative to QRS center
 * @param {number} sigma - time scaling
 * @param {Array} coeffs - coefficients [c0, c1, c2, c3] for Hermite functions
 */
export function hermiteQRS(t, sigma, coeffs) {
  const tNorm = t / sigma;
  let result = 0;
  for (let n = 0; n < coeffs.length && n < 5; n++) {
    result += coeffs[n] * hermiteFunction(tNorm, n);
  }
  return result;
}

/**
 * Smooth sigmoid transition function
 * Useful for ST segment elevation/depression
 * @param {number} t - time
 * @param {number} t0 - transition center
 * @param {number} tau - transition sharpness (smaller = sharper)
 */
export function sigmoid(t, t0, tau) {
  return 0.5 * (1 + Math.tanh((t - t0) / tau));
}

/**
 * Biphasic wave - for complex T waves or U waves
 * @param {number} t - time
 * @param {number} mu1 - first peak time
 * @param {number} mu2 - second peak time
 * @param {number} sigma1 - first peak width
 * @param {number} sigma2 - second peak width
 * @param {number} amp1 - first peak amplitude
 * @param {number} amp2 - second peak amplitude
 */
export function biphasicWave(t, mu1, mu2, sigma1, sigma2, amp1, amp2) {
  return gaussianWave(t, mu1, sigma1, amp1) + gaussianWave(t, mu2, sigma2, amp2);
}

/**
 * Time warping function - maps phase φ ∈ [0,1] to actual time within a beat
 * Allows morphology to stay consistent across different heart rates
 * @param {number} phi - phase (0 to 1)
 * @param {number} beatStart - beat start time
 * @param {number} RR - R-R interval
 * @param {Object} warpParams - warping parameters
 */
export function timeWarp(phi, beatStart, RR, warpParams = {}) {
  const { stretch = 1.0, shift = 0 } = warpParams;
  // Simple linear warping with optional stretch/shift
  return beatStart + (phi * stretch + shift) * RR;
}

/**
 * Phase-based wave generator - consistent morphology across HR changes
 * @param {number} phi - phase within beat (0-1)
 * @param {number} phiPeak - phase of peak
 * @param {number} phiWidth - width in phase units
 * @param {number} amp - amplitude
 */
export function phaseWave(phi, phiPeak, phiWidth, amp) {
  const x = (phi - phiPeak) / phiWidth;
  return amp * Math.exp(-0.5 * x * x);
}

// ============================================================================
// WAVE COMPONENT PRESETS
// Pre-defined wave shapes for common ECG components
// ============================================================================

export const WAVE_PRESETS = {
  // P wave presets (atrial depolarization)
  P_NORMAL: {
    type: 'asymmetric',
    sigmaL: 0.012,
    sigmaR: 0.016,
    amp: 0.08,
    description: 'Normal rounded P wave'
  },
  P_PEAKED: {
    type: 'generalized',
    sigma: 0.010,
    p: 3,
    amp: 0.12,
    description: 'Peaked P wave (P pulmonale)'
  },
  P_BIFID: {
    type: 'biphasic',
    mu1Offset: -0.015,
    mu2Offset: 0.015,
    sigma1: 0.012,
    sigma2: 0.012,
    amp1: 0.06,
    amp2: 0.07,
    description: 'Bifid P wave (P mitrale)'
  },

  // QRS presets
  QRS_NARROW: {
    type: 'hermite',
    sigma: 0.020,
    coeffs: [0, 0.9, 0.15, 0],
    description: 'Normal narrow QRS'
  },
  QRS_WIDE_RBBB: {
    type: 'hermite',
    sigma: 0.035,
    coeffs: [0, 0.7, 0.3, 0.15],
    description: 'Wide QRS with RSR\' pattern (RBBB)'
  },
  QRS_WIDE_LBBB: {
    type: 'hermite',
    sigma: 0.040,
    coeffs: [0, 0.8, -0.1, 0.2],
    description: 'Wide QRS with notched pattern (LBBB)'
  },
  QRS_DELTA: {
    type: 'asymmetric',
    sigmaL: 0.035,
    sigmaR: 0.015,
    amp: 0.9,
    pL: 1.5,
    description: 'Delta wave (WPW)'
  },

  // T wave presets
  T_NORMAL: {
    type: 'asymmetric',
    sigmaL: 0.06,
    sigmaR: 0.10,
    amp: 0.25,
    description: 'Normal asymmetric T wave'
  },
  T_HYPERACUTE: {
    type: 'generalized',
    sigma: 0.08,
    p: 2.5,
    amp: 0.45,
    description: 'Hyperacute peaked T wave'
  },
  T_INVERTED: {
    type: 'asymmetric',
    sigmaL: 0.06,
    sigmaR: 0.10,
    amp: -0.20,
    description: 'Inverted T wave'
  },
  T_BIPHASIC: {
    type: 'biphasic',
    mu1Offset: -0.02,
    mu2Offset: 0.04,
    sigma1: 0.04,
    sigma2: 0.06,
    amp1: -0.08,
    amp2: 0.18,
    description: 'Biphasic T wave'
  }
};

/**
 * Apply a wave preset to generate waveform contribution
 * @param {Float64Array} signal - output signal array
 * @param {number} fs - sample rate
 * @param {number} center - center time of wave
 * @param {Object} preset - wave preset from WAVE_PRESETS
 * @param {Array} dir - 3D direction vector
 * @param {number} scale - amplitude scaling factor
 */
export function applyWavePreset(Vx, Vy, Vz, fs, center, preset, dir, scale = 1.0) {
  const n = Vx.length;
  const { type } = preset;

  // Determine time window
  let sigma = preset.sigma || preset.sigmaR || 0.05;
  const window = sigma * 5;
  const i0 = Math.max(0, Math.floor((center - window) * fs));
  const i1 = Math.min(n - 1, Math.ceil((center + window) * fs));

  for (let i = i0; i <= i1; i++) {
    const t = i / fs;
    let amp = 0;

    switch (type) {
      case 'asymmetric':
        amp = asymmetricGaussian(t, center, preset.sigmaL, preset.sigmaR, preset.amp * scale);
        break;
      case 'generalized':
        amp = generalizedGaussian(t, center, preset.sigma, preset.amp * scale, preset.p);
        break;
      case 'hermite':
        amp = hermiteQRS(t - center, preset.sigma, preset.coeffs) * scale;
        break;
      case 'biphasic':
        amp = biphasicWave(
          t,
          center + (preset.mu1Offset || 0),
          center + (preset.mu2Offset || 0),
          preset.sigma1,
          preset.sigma2,
          preset.amp1 * scale,
          preset.amp2 * scale
        );
        break;
      default:
        amp = gaussianWave(t, center, sigma, (preset.amp || 1) * scale);
    }

    Vx[i] += amp * dir[0];
    Vy[i] += amp * dir[1];
    Vz[i] += amp * dir[2];
  }
}

// ============================================================================
// HRV (Heart Rate Variability) PARAMETERS
// Age-dependent parameters for realistic rhythm generation
// Based on published normative data: Task Force (1996), Umetani (1998)
// ============================================================================

/**
 * Get age-appropriate HRV parameters
 * @param {number} ageY - age in years
 * @returns {Object} HRV parameters
 */
export function getHRVParams(ageY) {
  // HRV decreases with age - neonates have highest variability
  // RSA amplitude (HF component) particularly high in children

  if (ageY < 1) {
    // Neonates/infants: high HRV, strong RSA
    return {
      rsaAmp: 0.08,        // RSA amplitude (fraction of RR)
      rsaFreq: 0.4,        // Respiratory rate ~24 breaths/min
      lfAmp: 0.04,         // LF component amplitude
      lfFreq: 0.1,         // LF center frequency
      vlfAmp: 0.02,        // VLF component
      rrNoise: 0.015,      // Random beat-to-beat variability
      lfHfRatio: 0.5,      // Children have lower LF/HF (more parasympathetic)
    };
  } else if (ageY < 6) {
    // Toddlers/preschool
    return {
      rsaAmp: 0.06,
      rsaFreq: 0.35,       // ~21 breaths/min
      lfAmp: 0.035,
      lfFreq: 0.1,
      vlfAmp: 0.018,
      rrNoise: 0.012,
      lfHfRatio: 0.6,
    };
  } else if (ageY < 12) {
    // School age
    return {
      rsaAmp: 0.045,
      rsaFreq: 0.28,       // ~17 breaths/min
      lfAmp: 0.03,
      lfFreq: 0.1,
      vlfAmp: 0.015,
      rrNoise: 0.010,
      lfHfRatio: 0.8,
    };
  } else if (ageY < 18) {
    // Adolescents
    return {
      rsaAmp: 0.035,
      rsaFreq: 0.25,       // ~15 breaths/min
      lfAmp: 0.028,
      lfFreq: 0.1,
      vlfAmp: 0.012,
      rrNoise: 0.008,
      lfHfRatio: 1.0,
    };
  } else if (ageY < 40) {
    // Young adults
    return {
      rsaAmp: 0.028,
      rsaFreq: 0.22,       // ~13 breaths/min
      lfAmp: 0.025,
      lfFreq: 0.1,
      vlfAmp: 0.010,
      rrNoise: 0.006,
      lfHfRatio: 1.2,
    };
  } else if (ageY < 60) {
    // Middle-aged adults
    return {
      rsaAmp: 0.018,
      rsaFreq: 0.20,       // ~12 breaths/min
      lfAmp: 0.020,
      lfFreq: 0.1,
      vlfAmp: 0.008,
      rrNoise: 0.005,
      lfHfRatio: 1.5,
    };
  } else {
    // Older adults - significantly reduced HRV
    return {
      rsaAmp: 0.012,
      rsaFreq: 0.18,
      lfAmp: 0.015,
      lfFreq: 0.1,
      vlfAmp: 0.006,
      rrNoise: 0.004,
      lfHfRatio: 1.8,
    };
  }
}

/**
 * Generate HRV-modulated RR interval
 * Implements: RR(t) = RR0 * (1 + A_rsa*sin(2π*f_rsa*t + φ_rsa) + A_lf*sin(2π*f_lf*t + φ_lf) + A_vlf*sin(2π*f_vlf*t + φ_vlf)) + ε
 * @param {number} RR0 - base RR interval
 * @param {number} t - current time
 * @param {Object} hrvParams - HRV parameters
 * @param {Object} phases - phase offsets for each component
 * @param {Function} rng - random number generator
 * @returns {number} modulated RR interval
 */
export function modulateRR(RR0, t, hrvParams, phases, rng) {
  // RSA (High Frequency) - respiratory-driven
  const rsaMod = hrvParams.rsaAmp * Math.sin(2 * Math.PI * hrvParams.rsaFreq * t + phases.rsa);

  // LF component - sympathetic + baroreflex
  const lfMod = hrvParams.lfAmp * Math.sin(2 * Math.PI * hrvParams.lfFreq * t + phases.lf);

  // VLF component - thermoregulation, hormonal
  const vlfMod = hrvParams.vlfAmp * Math.sin(2 * Math.PI * 0.03 * t + phases.vlf);

  // Random beat-to-beat noise
  const noise = randn(rng) * hrvParams.rrNoise;

  // Combined modulation
  const modulation = 1.0 + rsaMod + lfMod + vlfMod;

  return RR0 * modulation + noise;
}

// ============================================================================
// ARRHYTHMIA STATE MACHINE
// Markov-based model for realistic ectopy timing
// ============================================================================

/**
 * State machine for ectopic beat generation
 * Models PAC/PVC occurrence with realistic clustering
 */
export class EctopyStateMachine {
  constructor(rng, ectopyType, baseRate = 0.1) {
    this.rng = rng;
    this.ectopyType = ectopyType; // 'PAC', 'PVC', or 'none'
    this.baseRate = baseRate;     // Base probability per beat

    // State: 'normal', 'ectopic', 'refractory'
    this.state = 'normal';
    this.refractoryBeats = 0;

    // Clustering parameters (ectopics tend to cluster)
    this.clusterProb = 0.3;       // Probability of another ectopic after one
    this.minRefractoryBeats = 2;  // Minimum beats after ectopic before another
  }

  /**
   * Determine if next beat should be ectopic
   * @param {number} beatIndex - current beat number
   * @returns {Object} { isEctopic, couplingInterval }
   */
  nextBeat(beatIndex) {
    if (this.ectopyType === 'none') {
      return { isEctopic: false, couplingInterval: 1.0 };
    }

    // Handle refractory period after ectopic
    if (this.state === 'refractory') {
      this.refractoryBeats--;
      if (this.refractoryBeats <= 0) {
        this.state = 'normal';
      }
      return { isEctopic: false, couplingInterval: 1.0 };
    }

    // Determine if this beat is ectopic
    let prob = this.baseRate;

    // Higher probability if previous beat was ectopic (clustering)
    if (this.state === 'ectopic') {
      prob = this.clusterProb;
    }

    // Occasional bursts more likely in middle of recording
    if (beatIndex > 5 && beatIndex % 7 === 0) {
      prob *= 1.5;
    }

    const isEctopic = this.rng() < prob;

    if (isEctopic) {
      // Coupling interval: 0.5-0.8 of normal RR for premature beats
      const couplingInterval = 0.5 + this.rng() * 0.3;

      // Set up refractory period after this ectopic
      this.refractoryBeats = this.minRefractoryBeats + Math.floor(this.rng() * 3);
      this.state = 'refractory';

      return { isEctopic: true, couplingInterval };
    }

    this.state = 'normal';
    return { isEctopic: false, couplingInterval: 1.0 };
  }
}

// ============================================================================
// MODULE 1: RHYTHM MODEL
// Generates beat schedule based on rhythm type and heart rate
// Input: params, seed
// Output: beatSchedule array of { pTime, qrsTime, hasPWave, hasQRS, isPVC, prInterval }
// ============================================================================

export function rhythmModel(params, dx, duration, seed, ageY = 30) {
  const rng = mulberry32(Math.max(1, Math.floor(seed)));
  const RR0 = 60 / params.HR;

  // Get age-appropriate HRV parameters
  const hrvParams = getHRVParams(ageY);

  // Disable HRV for certain rhythms
  const disableHRV = dx.includes("flutter") || dx.includes("SVT") || dx.includes("AVB");
  const effectiveHRV = disableHRV ? {
    rsaAmp: 0, rsaFreq: hrvParams.rsaFreq,
    lfAmp: 0, lfFreq: hrvParams.lfFreq,
    vlfAmp: 0, rrNoise: 0,
  } : hrvParams;

  // Random phase offsets for HRV components
  const phases = {
    rsa: rng() * 2 * Math.PI,
    lf: rng() * 2 * Math.PI,
    vlf: rng() * 2 * Math.PI,
  };

  // Generate P wave times (atrial rhythm) with realistic HRV
  const pWaveTimes = [];
  const rrIntervals = [];
  let tt = 0.6;

  while (tt < duration - 0.8) {
    pWaveTimes.push(tt);
    const rr = modulateRR(RR0, tt, effectiveHRV, phases, rng);
    rrIntervals.push(rr);
    tt += clamp(rr, 0.35, 1.2);
  }

  // Build beat schedule based on rhythm type
  const beats = [];

  if (dx === "3rd degree AVB") {
    // Complete heart block: P waves at sinus rate, QRS at escape rate (~40 bpm)
    const escapeRR = 1.5;
    let escapeT = 0.8;
    for (const pT of pWaveTimes) {
      beats.push({ pTime: pT, qrsTime: null, hasPWave: true, hasQRS: false, isPVC: false, prInterval: null });
    }
    while (escapeT < duration - 0.6) {
      beats.push({ pTime: null, qrsTime: escapeT, hasPWave: false, hasQRS: true, isPVC: false, prInterval: null });
      escapeT += escapeRR + randn(rng) * 0.05;
    }
  } else if (dx === "2nd degree AVB (Wenckebach)") {
    // Progressive PR prolongation until dropped beat (4:3 pattern)
    let cyclePos = 0;
    const cycleLen = 4;
    for (const pT of pWaveTimes) {
      const prIncrement = 0.04 * cyclePos;
      const effectivePR = params.PR + prIncrement;
      if (cyclePos < cycleLen - 1) {
        beats.push({ pTime: pT, qrsTime: pT + effectivePR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: effectivePR });
      } else {
        beats.push({ pTime: pT, qrsTime: null, hasPWave: true, hasQRS: false, isPVC: false, prInterval: null });
      }
      cyclePos = (cyclePos + 1) % cycleLen;
    }
  } else if (dx === "2nd degree AVB (Mobitz II)") {
    // Fixed PR with occasional dropped beats (3:1)
    let beatCount = 0;
    const dropEvery = 3;
    for (const pT of pWaveTimes) {
      if (beatCount % dropEvery !== dropEvery - 1) {
        beats.push({ pTime: pT, qrsTime: pT + params.PR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR });
      } else {
        beats.push({ pTime: pT, qrsTime: null, hasPWave: true, hasQRS: false, isPVC: false, prInterval: null });
      }
      beatCount++;
    }
  } else if (dx === "PACs") {
    // Normal rhythm with occasional early P waves using state machine
    const pacStateMachine = new EctopyStateMachine(rng, 'PAC', 0.15);
    for (let i = 0; i < pWaveTimes.length; i++) {
      const pT = pWaveTimes[i];
      beats.push({ pTime: pT, qrsTime: pT + params.PR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR });

      // Check if a PAC should occur after this beat
      const { isEctopic, couplingInterval } = pacStateMachine.nextBeat(i);
      if (isEctopic && pT + RR0 * couplingInterval < duration - 0.5) {
        const pacTime = pT + RR0 * couplingInterval;
        // PACs have shorter PR interval due to early activation
        const pacPR = params.PR * (0.85 + rng() * 0.1);
        beats.push({ pTime: pacTime, qrsTime: pacTime + pacPR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: pacPR, isPAC: true });
      }
    }
  } else if (dx === "PVCs") {
    // Normal rhythm with occasional PVCs using state machine
    const pvcStateMachine = new EctopyStateMachine(rng, 'PVC', 0.12);
    for (let i = 0; i < pWaveTimes.length; i++) {
      const pT = pWaveTimes[i];
      beats.push({ pTime: pT, qrsTime: pT + params.PR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR });

      // Check if a PVC should occur after this beat
      const { isEctopic, couplingInterval } = pvcStateMachine.nextBeat(i);
      if (isEctopic && pT + RR0 * couplingInterval < duration - 0.5) {
        const pvcTime = pT + RR0 * couplingInterval;
        beats.push({ pTime: null, qrsTime: pvcTime, hasPWave: false, hasQRS: true, isPVC: true, prInterval: null });
      }
    }
  } else {
    // Normal conduction
    for (const pT of pWaveTimes) {
      const skipP = dx === "SVT (narrow)" || dx === "Atrial flutter (2:1)";
      beats.push({ pTime: skipP ? null : pT, qrsTime: pT + params.PR, hasPWave: !skipP, hasQRS: true, isPVC: false, prInterval: params.PR });
    }
  }

  // Compute HRV metrics from generated RR intervals
  const hrvMetrics = computeHRVMetrics(rrIntervals);

  return {
    beats,
    RR: RR0,
    pWaveTimes,
    rrIntervals,
    hrvParams: effectiveHRV,
    hrvMetrics,
  };
}

/**
 * Compute time-domain HRV metrics from RR intervals
 * @param {Array} rrIntervals - array of RR intervals in seconds
 * @returns {Object} HRV metrics
 */
export function computeHRVMetrics(rrIntervals) {
  if (!rrIntervals || rrIntervals.length < 3) {
    return { SDNN: 0, RMSSD: 0, pNN50: 0, meanRR: 0 };
  }

  // Mean RR
  const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;

  // SDNN - standard deviation of NN intervals
  const variance = rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / rrIntervals.length;
  const SDNN = Math.sqrt(variance) * 1000; // Convert to ms

  // RMSSD - root mean square of successive differences
  let sumSqDiff = 0;
  let nn50Count = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = (rrIntervals[i] - rrIntervals[i - 1]) * 1000; // ms
    sumSqDiff += diff * diff;
    if (Math.abs(diff) > 50) nn50Count++;
  }
  const RMSSD = Math.sqrt(sumSqDiff / (rrIntervals.length - 1));

  // pNN50 - percentage of successive differences > 50ms
  const pNN50 = (nn50Count / (rrIntervals.length - 1)) * 100;

  return {
    meanRR: meanRR * 1000,  // ms
    SDNN,                    // ms
    RMSSD,                   // ms
    pNN50,                   // percentage
  };
}

// ============================================================================
// MODULE 2: MORPHOLOGY MODEL
// Generates VCG (3D source vectors) from beat schedule
// Input: beatSchedule, params, seed
// Output: { Vx, Vy, Vz } Float64Arrays
// ============================================================================

function addGaussian3(Vx, Vy, Vz, fs, mu, sigma, amp, dir) {
  const n = Vx.length;
  const i0 = Math.max(0, Math.floor((mu - 4 * sigma) * fs));
  const i1 = Math.min(n - 1, Math.ceil((mu + 4 * sigma) * fs));
  const inv2s2 = 1.0 / (2 * sigma * sigma);
  for (let i = i0; i <= i1; i++) {
    const tt = i / fs;
    const g = Math.exp((-(tt - mu) * (tt - mu)) * inv2s2) * amp;
    Vx[i] += g * dir[0];
    Vy[i] += g * dir[1];
    Vz[i] += g * dir[2];
  }
}

function addPWave(Vx, Vy, Vz, fs, pCenter, aScale, dP1, dP2) {
  addGaussian3(Vx, Vy, Vz, fs, pCenter - 0.01, 0.014, 0.075 * aScale, dP1);
  addGaussian3(Vx, Vy, Vz, fs, pCenter + 0.012, 0.016, 0.095 * aScale, dP2);
}

function addQRS(Vx, Vy, Vz, fs, qrsOn, qrsC, params, aScale, tJit, dQ1, dQ2, dQ3, dx, isPVC, rng) {
  const qrsWidth = isPVC ? params.QRS * 1.8 : params.QRS;
  const qrsAmp = isPVC ? 1.4 : 1.0;

  if (dx === "LBBB") {
    const dLBBB1 = norm([0.85, 0.3, 0.4]);
    const dLBBB2 = norm([0.7, 0.6, -0.2]);
    addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.35 * qrsWidth + tJit, 0.12 * qrsWidth, 0.6 * aScale, dLBBB1);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.18 * qrsWidth, 0.9 * aScale, dLBBB2);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.35 * qrsWidth + tJit, 0.14 * qrsWidth, 0.5 * aScale, dLBBB1);
    return;
  }

  if (isPVC) {
    const dPVC = norm([0.3 + rng() * 0.4, 0.8, -0.5 + rng() * 0.3]);
    addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.3 * qrsWidth + tJit, 0.12 * qrsWidth, 0.4 * aScale * qrsAmp, dQ1);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.2 * qrsWidth, 1.2 * aScale * qrsAmp, dPVC);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.35 * qrsWidth + tJit, 0.15 * qrsWidth, 0.5 * aScale * qrsAmp, dQ3);
    return;
  }

  // Normal QRS
  addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.32 * qrsWidth + tJit, 0.09 * qrsWidth, 0.22 * aScale * qrsAmp, dQ1);
  addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.16 * qrsWidth, 1.1 * aScale * qrsAmp, dQ2);
  addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.34 * qrsWidth + tJit, 0.12 * qrsWidth, 0.36 * aScale * qrsAmp, dQ3);
}

function addTWave(Vx, Vy, Vz, fs, qrsOn, QT, aScale, tJit, dT1, dT2, Taxis, isPVC) {
  const tPeak = qrsOn + 0.62 * QT + tJit;
  const tAmp = isPVC ? 0.7 : 1.0;
  const tDir1 = isPVC ? norm([-dT1[0], -dT1[1], -dT1[2]]) : dT1;
  const tDir2 = isPVC ? norm([-dT2[0], -dT2[1], -dT2[2]]) : dT2;

  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.0, 0.1 * QT, 0.22 * aScale * tAmp, tDir1);
  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.03, 0.14 * QT, 0.18 * aScale * tAmp, tDir2);
  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.16, 0.04, 0.015 * aScale, axisDir(Taxis, -0.1));
}

export function morphologyModel(beatSchedule, params, dx, fs, N, seed) {
  const rng = mulberry32(Math.max(1, Math.floor(seed + 1000)));
  const RR = 60 / params.HR;
  const QT = params.QTc * Math.sqrt(RR);

  const Vx = new Float64Array(N);
  const Vy = new Float64Array(N);
  const Vz = new Float64Array(N);

  // Direction vectors based on parameters
  const dP1 = norm([-0.35, 0.85, 0.22]);
  const dP2 = norm([0.55, 0.75, -0.15]);
  const dQ1 = norm([-0.95, 0.1, 0.9 * (0.6 + 0.4 * params.rvDom)]);
  const dQ2 = axisDir(params.QRSaxis, params.zQ2);
  const dQ3 = norm([0.45, -0.65, -0.8]);
  const dT1 = axisDir(params.Taxis, params.zT * (0.6 + 0.4 * params.juvenileT));
  const dT2 = norm([dT1[0] * 0.9, dT1[1] * 1.05, dT1[2] * 1.1]);

  // Atrial flutter waves
  if (dx === "Atrial flutter (2:1)") {
    const f = 5.0, amp = 0.07;
    const dF = axisDir(params.Paxis, 0.1);
    for (let i = 0; i < N; i++) {
      const x = (i / fs) * f;
      const saw = 2 * (x - Math.floor(x + 0.5));
      const F = amp * saw;
      Vx[i] += F * dF[0];
      Vy[i] += F * dF[1];
      Vz[i] += F * dF[2];
    }
  }

  // Generate waveforms for each beat
  for (const beat of beatSchedule.beats) {
    const aScale = 1.0 + randn(rng) * 0.02;
    const tJit = randn(rng) * 0.003;

    // P wave
    if (beat.hasPWave && beat.pTime != null) {
      const pCenter = beat.pTime + 0.04 + tJit;
      addPWave(Vx, Vy, Vz, fs, pCenter, aScale, dP1, dP2);
    }

    // QRS complex
    if (beat.hasQRS && beat.qrsTime != null) {
      const qrsOn = beat.qrsTime;
      const qrsC = qrsOn + params.QRS / 2;

      addQRS(Vx, Vy, Vz, fs, qrsOn, qrsC, params, aScale, tJit, dQ1, dQ2, dQ3, dx, beat.isPVC, rng);

      // Morphology modifiers
      if (!beat.isPVC) {
        if (dx === "WPW") {
          const dDelta = norm([dQ1[0] * 0.6 + dQ2[0] * 0.4, dQ1[1] * 0.6 + dQ2[1] * 0.4, dQ1[2] * 0.6 + dQ2[2] * 0.4]);
          addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.012 + tJit, 0.022, 0.28 * aScale, dDelta);
        }
        if (dx === "RBBB") {
          const dLate = norm([-0.9, 0.0, 0.95]);
          addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.82 * params.QRS + tJit, 0.01 + 0.08 * params.QRS, 0.35 * aScale, dLate);
        }
        if (dx === "LVH") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.16 * params.QRS, 0.55 * aScale, axisDir(params.QRSaxis - 20, params.zQ2 * 0.8));
        }
        if (dx === "RVH") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.14 * params.QRS, 0.45 * aScale, norm([-0.75, 0.2, 0.95]));
        }
        if (dx === "LAFB") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.25 * params.QRS + tJit, 0.08 * params.QRS, 0.15 * aScale, norm([0.9, -0.3, 0.1]));
        }
      }

      // T wave
      addTWave(Vx, Vy, Vz, fs, qrsOn, QT, aScale, tJit, dT1, dT2, params.Taxis, beat.isPVC);

      // Pericarditis ST changes
      if (dx === "Pericarditis" && !beat.isPVC && beat.pTime != null) {
        const tau = 0.008;
        const dST = axisDir(params.Taxis, params.zT * 0.7);
        const dPR = axisDir(params.Paxis, 0.0);
        function sig(tt) {
          return 0.5 * (1 + Math.tanh(tt / tau));
        }
        const j = qrsOn + 0.04;
        const stEnd = qrsOn + 0.18;
        const prStart = beat.pTime + 0.1;
        const prEnd = qrsOn - 0.01;
        const aST = 0.1 * aScale;
        const aPR = -0.04 * aScale;
        const i0 = Math.max(0, Math.floor((beat.pTime + 0.05) * fs));
        const i1 = Math.min(N - 1, Math.ceil((stEnd + 0.25) * fs));
        for (let i = i0; i <= i1; i++) {
          const tt2 = i / fs;
          const stPlate = (sig(tt2 - j) - sig(tt2 - stEnd)) * aST;
          const prPlate = (sig(tt2 - prStart) - sig(tt2 - prEnd)) * aPR;
          Vx[i] += stPlate * dST[0] + prPlate * dPR[0];
          Vy[i] += stPlate * dST[1] + prPlate * dPR[1];
          Vz[i] += stPlate * dST[2] + prPlate * dPR[2];
        }
      }
    }
  }

  return { Vx, Vy, Vz, QT };
}

// ============================================================================
// MODULE 3: LEAD FIELD MODEL
// Projects VCG to electrode potentials using forward model
// Input: VCG, torsoParams, electrodeParams
// Output: electrodePotentials object
// ============================================================================

// Default electrode geometry (simplified forward model)
export const DEFAULT_ELECTRODE_GEOMETRY = {
  RA: norm([-1.0, -0.55, 0.2]),
  LA: norm([1.0, -0.55, 0.2]),
  LL: norm([0.05, 1.25, 0.05]),
  V1: norm([-0.75, 0.0, 1.1]),
  V2: norm([-0.05, 0.0, 1.05]),
  V3: norm([0.55, 0.1, 0.95]),
  V4: norm([1.0, 0.2, 0.78]),
  V5: norm([1.25, 0.2, 0.45]),
  V6: norm([1.35, 0.2, 0.15]),
  V3R: norm([-0.55, 0.1, 0.95]),
  V4R: norm([-0.95, 0.2, 0.78]),
  V7: norm([1.05, 0.2, -0.35]),
};

function dotDipole(Vx, Vy, Vz, r) {
  const out = new Float64Array(Vx.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Vx[i] * r[0] + Vy[i] * r[1] + Vz[i] * r[2];
  }
  return out;
}

export function leadFieldModel(vcg, electrodeGeometry = DEFAULT_ELECTRODE_GEOMETRY) {
  const { Vx, Vy, Vz } = vcg;

  return {
    phiRA: dotDipole(Vx, Vy, Vz, electrodeGeometry.RA),
    phiLA: dotDipole(Vx, Vy, Vz, electrodeGeometry.LA),
    phiLL: dotDipole(Vx, Vy, Vz, electrodeGeometry.LL),
    phiV1: dotDipole(Vx, Vy, Vz, electrodeGeometry.V1),
    phiV2: dotDipole(Vx, Vy, Vz, electrodeGeometry.V2),
    phiV3: dotDipole(Vx, Vy, Vz, electrodeGeometry.V3),
    phiV4: dotDipole(Vx, Vy, Vz, electrodeGeometry.V4),
    phiV5: dotDipole(Vx, Vy, Vz, electrodeGeometry.V5),
    phiV6: dotDipole(Vx, Vy, Vz, electrodeGeometry.V6),
    phiV3R: dotDipole(Vx, Vy, Vz, electrodeGeometry.V3R),
    phiV4R: dotDipole(Vx, Vy, Vz, electrodeGeometry.V4R),
    phiV7: dotDipole(Vx, Vy, Vz, electrodeGeometry.V7),
  };
}

// ============================================================================
// MODULE 4: DERIVE LEADS
// Derives 12/15-lead ECG from electrode potentials
// Input: electrodePotentials
// Output: leads object (I, II, III, aVR, aVL, aVF, V1-V6, V3R, V4R, V7)
// ============================================================================

export function deriveLeads(phi) {
  const N = phi.phiRA.length;

  const WCT = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    WCT[i] = (phi.phiRA[i] + phi.phiLA[i] + phi.phiLL[i]) / 3.0;
  }

  function diff(a, b) {
    const y = new Float64Array(N);
    for (let i = 0; i < N; i++) y[i] = a[i] - b[i];
    return y;
  }

  function comb(a, b, c) {
    const y = new Float64Array(N);
    for (let i = 0; i < N; i++) y[i] = a[i] - (b[i] + c[i]) / 2;
    return y;
  }

  return {
    I: diff(phi.phiLA, phi.phiRA),
    II: diff(phi.phiLL, phi.phiRA),
    III: diff(phi.phiLL, phi.phiLA),
    aVR: comb(phi.phiRA, phi.phiLA, phi.phiLL),
    aVL: comb(phi.phiLA, phi.phiRA, phi.phiLL),
    aVF: comb(phi.phiLL, phi.phiRA, phi.phiLA),
    V1: diff(phi.phiV1, WCT),
    V2: diff(phi.phiV2, WCT),
    V3: diff(phi.phiV3, WCT),
    V4: diff(phi.phiV4, WCT),
    V5: diff(phi.phiV5, WCT),
    V6: diff(phi.phiV6, WCT),
    V3R: diff(phi.phiV3R, WCT),
    V4R: diff(phi.phiV4R, WCT),
    V7: diff(phi.phiV7, WCT),
  };
}

// ============================================================================
// MODULE 5: DEVICE AND ARTIFACT MODEL
// Adds noise, artifacts, and applies device filtering
// Input: leads, deviceParams, artifactParams, seed
// Output: finalLeads (processed)
// ============================================================================

export const DEVICE_PRESETS = {
  diagnostic: { hpCutoff: 0.05, lpCutoff: 150, description: "Diagnostic mode (0.05-150 Hz)" },
  monitor: { hpCutoff: 0.5, lpCutoff: 40, description: "Monitor mode (0.5-40 Hz)" },
};

export const ARTIFACT_PRESETS = {
  none: { baseline: 0, powerline: 0, emg: 0, description: "No artifacts" },
  minimal: { baseline: 0.02, powerline: 0.002, emg: 0.002, description: "Minimal artifacts" },
  typical: { baseline: 0.04, powerline: 0.004, emg: 0.004, description: "Typical clinical artifacts" },
  noisy: { baseline: 0.08, powerline: 0.008, emg: 0.008, description: "Noisy recording" },
};

function highpass1(x, fs, fc) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const a = RC / (RC + dt);
  const y = new Float64Array(x.length);
  y[0] = 0;
  for (let i = 1; i < x.length; i++) {
    y[i] = a * (y[i - 1] + x[i] - x[i - 1]);
  }
  return y;
}

function lowpass1(x, fs, fc) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const a = dt / (RC + dt);
  const y = new Float64Array(x.length);
  y[0] = x[0];
  for (let i = 1; i < x.length; i++) {
    y[i] = y[i - 1] + a * (x[i] - y[i - 1]);
  }
  return y;
}

function applyBandpass(x, fs, hpCutoff, lpCutoff) {
  let y = highpass1(x, fs, hpCutoff);
  y = lowpass1(y, fs, lpCutoff);
  return y;
}

function addEMG(x, scale, rng, N, fs) {
  const nComp = 18;
  const freqs = [], phases = [];
  for (let k = 0; k < nComp; k++) {
    freqs.push(20 + (100 - 20) * rng());
    phases.push(2 * Math.PI * rng());
  }
  const envPh = 2 * Math.PI * rng();
  for (let i = 0; i < N; i++) {
    const tt = i / fs;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * tt + envPh);
    let s = 0;
    for (let k = 0; k < nComp; k++) {
      s += Math.sin(2 * Math.PI * freqs[k] * tt + phases[k]);
    }
    s = (s / nComp) * env * scale;
    x[i] += s;
  }
}

export function deviceAndArtifactModel(phi, fs, seed, artifactParams = ARTIFACT_PRESETS.typical, deviceParams = DEVICE_PRESETS.diagnostic, enableNoise = true, enableFilters = true) {
  const N = phi.phiRA.length;
  const rng = mulberry32(Math.max(1, Math.floor(seed + 2000)));

  // Clone electrode potentials for modification
  const phiMod = {
    phiRA: new Float64Array(phi.phiRA),
    phiLA: new Float64Array(phi.phiLA),
    phiLL: new Float64Array(phi.phiLL),
    phiV1: new Float64Array(phi.phiV1),
    phiV2: new Float64Array(phi.phiV2),
    phiV3: new Float64Array(phi.phiV3),
    phiV4: new Float64Array(phi.phiV4),
    phiV5: new Float64Array(phi.phiV5),
    phiV6: new Float64Array(phi.phiV6),
    phiV3R: new Float64Array(phi.phiV3R),
    phiV4R: new Float64Array(phi.phiV4R),
    phiV7: new Float64Array(phi.phiV7),
  };

  // Add correlated noise to electrode potentials (preserves Einthoven)
  if (enableNoise) {
    const phase1 = rng() * Math.PI * 2;
    const phase2 = rng() * Math.PI * 2;

    for (let i = 0; i < N; i++) {
      const tt = i / fs;
      // Baseline wander - correlated across limb leads
      const bw = artifactParams.baseline * Math.sin(2 * Math.PI * 0.25 * tt + phase1);
      // Power line interference - correlated across all electrodes
      const pl = artifactParams.powerline * Math.sin(2 * Math.PI * 60 * tt + phase2);

      phiMod.phiRA[i] += bw + pl;
      phiMod.phiLA[i] += bw + pl;
      phiMod.phiLL[i] += bw + pl;
    }

    // EMG noise - independent per electrode but scaled appropriately
    const emgScale = artifactParams.emg;
    addEMG(phiMod.phiRA, emgScale * 0.75, rng, N, fs);
    addEMG(phiMod.phiLA, emgScale * 0.75, rng, N, fs);
    addEMG(phiMod.phiLL, emgScale * 0.75, rng, N, fs);
    addEMG(phiMod.phiV1, emgScale * 1.25, rng, N, fs);
    addEMG(phiMod.phiV2, emgScale * 1.25, rng, N, fs);
    addEMG(phiMod.phiV3, emgScale * 1.25, rng, N, fs);
    addEMG(phiMod.phiV4, emgScale, rng, N, fs);
    addEMG(phiMod.phiV5, emgScale, rng, N, fs);
    addEMG(phiMod.phiV6, emgScale, rng, N, fs);
    addEMG(phiMod.phiV3R, emgScale * 1.25, rng, N, fs);
    addEMG(phiMod.phiV4R, emgScale * 1.25, rng, N, fs);
    addEMG(phiMod.phiV7, emgScale, rng, N, fs);
  }

  // Derive leads from modified electrode potentials
  let leads = deriveLeads(phiMod);

  // Apply device filtering
  if (enableFilters) {
    const leadNames = Object.keys(leads);
    for (const name of leadNames) {
      leads[name] = applyBandpass(leads[name], fs, deviceParams.hpCutoff, deviceParams.lpCutoff);
    }
  }

  return leads;
}

// ============================================================================
// INTEGRATED SYNTHESIS FUNCTION (using all modules)
// ============================================================================

import { ageDefaults, applyDx, DIAGNOSES } from "./ecg-synth.js";

export function synthECGModular(ageY, dx, seed, options = {}) {
  const {
    enableNoise = true,
    enableFilters = true,
    artifactParams = ARTIFACT_PRESETS.typical,
    deviceParams = DEVICE_PRESETS.diagnostic,
    electrodeGeometry = DEFAULT_ELECTRODE_GEOMETRY,
  } = options;

  const fs = 1000;
  const duration = 10.0;
  const N = Math.floor(duration * fs);

  // Get parameters
  const base = ageDefaults(ageY);
  const params = applyDx(base, dx);
  const RR = 60 / params.HR;
  const QT = params.QTc * Math.sqrt(RR);

  // Module 1: Rhythm (with age-appropriate HRV)
  const beatSchedule = rhythmModel(params, dx, duration, seed, ageY);

  // Module 2: Morphology
  const vcg = morphologyModel(beatSchedule, params, dx, fs, N, seed);

  // Module 3: Lead Field
  const electrodePotentials = leadFieldModel(vcg, electrodeGeometry);

  // Module 5: Device and Artifact (includes deriving leads)
  const leads = deviceAndArtifactModel(
    electrodePotentials,
    fs,
    seed,
    enableNoise ? artifactParams : ARTIFACT_PRESETS.none,
    deviceParams,
    enableNoise,
    enableFilters
  );

  // Convert to Int16 (microvolts)
  function toUV(x) {
    const out = new Int16Array(N);
    for (let i = 0; i < N; i++) {
      let v = Math.round(x[i] * 1000.0);
      v = clamp(v, -32768, 32767);
      out[i] = v;
    }
    return out;
  }

  const leads_uV = {};
  for (const name of Object.keys(leads)) {
    leads_uV[name] = toUV(leads[name]);
  }

  return {
    schema_version: ECG_SCHEMA_VERSION,
    fs,
    duration_s: duration,
    targets: {
      synthetic: true,
      generator_version: "2.1.0-hrv",
      age_years: ageY,
      dx,
      HR_bpm: params.HR,
      PR_ms: Math.round(params.PR * 1000),
      QRS_ms: Math.round(params.QRS * 1000),
      QT_ms: Math.round(QT * 1000),
      QTc_ms: Math.round(params.QTc * 1000),
      axes_deg: { P: params.Paxis, QRS: params.QRSaxis, T: params.Taxis },
      hrv: beatSchedule.hrvMetrics,
    },
    leads_uV,
  };
}

// Re-export for convenience
export { DIAGNOSES, ageDefaults, applyDx };
