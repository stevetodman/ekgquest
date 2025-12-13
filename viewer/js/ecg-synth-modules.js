// ECG Synthesis Modules - Teaching-Indistinguishable Architecture
// Modular synthesizer for generating pediatric and adult ECGs
//
// MODULE INDEX (use Ctrl+G in editor to jump to line):
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ SECTION                     │ LINE  │ KEY EXPORTS                        │
// ├───────────────────────────────────────────────────────────────────────────┤
// │ UTILITIES                   │   30  │ norm, axisDir, mulberry32, randn   │
// │ PEDIATRIC PRIORS           │   55  │ PEDIATRIC_PRIORS, getAgeBin,       │
// │                            │       │ samplePediatricPriors              │
// │ DIAGNOSES                  │  250  │ DIAGNOSES, ageDefaults, applyDx    │
// │ WAVE FUNCTIONS             │  365  │ gaussianWave, hermiteQRS,          │
// │                            │       │ WAVE_PRESETS                       │
// │ HRV PARAMETERS             │  660  │ getHRVParams, modulateRR,          │
// │                            │       │ EctopyStateMachine, rhythmModel    │
// │ BEAT JITTER                │ 1040  │ generateBeatJitter                 │
// │ MORPHOLOGY MODEL           │ 1300  │ morphologyModel                    │
// │ LEAD FIELD MODEL           │ 1460  │ leadFieldModel, deriveLeads        │
// │ DEVICE/FILTERS             │ 1700  │ DEVICE_PRESETS, ARTIFACT_PRESETS   │
// │ MAIN SYNTHESIZER           │ 2300  │ synthECGModular                    │
// └───────────────────────────────────────────────────────────────────────────┘
//
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
// PEDIATRIC PRIORS (Step 7: Data-driven calibration)
// Age/sex-conditioned parameter distributions from published literature
// ============================================================================

/**
 * Pediatric ECG normal value priors
 *
 * SOURCE OF TRUTH: /data/pediatric_priors.json
 *
 * This embedded copy must stay in sync with the JSON file.
 * Python validation uses the JSON directly to prevent drift.
 * If updating values, modify the JSON first, then update this copy.
 *
 * Based on: Rijnbeek et al. 2001/2014, Bratincsák et al. 2020, Davignon et al. 1979
 */
export const PEDIATRIC_PRIORS = {
  age_bins: [
    { id: "neonate", age_range: [0, 0.08], HR: { mean: 145, sd: 22 }, PR: { mean: 0.100, sd: 0.015 }, QRS: { mean: 0.060, sd: 0.008 }, QTc: { mean: 0.400, sd: 0.025 }, QRSaxis: { mean: 125, sd: 35 }, Taxis: { mean: 85, sd: 40 }, Paxis: { mean: 60, sd: 20 } },
    { id: "infant_early", age_range: [0.08, 0.25], HR: { mean: 150, sd: 20 }, PR: { mean: 0.105, sd: 0.015 }, QRS: { mean: 0.062, sd: 0.008 }, QTc: { mean: 0.400, sd: 0.025 }, QRSaxis: { mean: 100, sd: 35 }, Taxis: { mean: 70, sd: 35 }, Paxis: { mean: 58, sd: 18 } },
    { id: "infant_mid", age_range: [0.25, 0.5], HR: { mean: 140, sd: 20 }, PR: { mean: 0.110, sd: 0.018 }, QRS: { mean: 0.065, sd: 0.008 }, QTc: { mean: 0.405, sd: 0.025 }, QRSaxis: { mean: 85, sd: 35 }, Taxis: { mean: 55, sd: 30 }, Paxis: { mean: 55, sd: 18 } },
    { id: "infant_late", age_range: [0.5, 1.0], HR: { mean: 130, sd: 18 }, PR: { mean: 0.115, sd: 0.020 }, QRS: { mean: 0.068, sd: 0.008 }, QTc: { mean: 0.410, sd: 0.025 }, QRSaxis: { mean: 75, sd: 35 }, Taxis: { mean: 50, sd: 28 }, Paxis: { mean: 55, sd: 18 } },
    { id: "toddler", age_range: [1.0, 3.0], HR: { mean: 115, sd: 18 }, PR: { mean: 0.120, sd: 0.020 }, QRS: { mean: 0.070, sd: 0.008 }, QTc: { mean: 0.410, sd: 0.025 }, QRSaxis: { mean: 65, sd: 30 }, Taxis: { mean: 45, sd: 25 }, Paxis: { mean: 55, sd: 16 } },
    { id: "preschool", age_range: [3.0, 5.0], HR: { mean: 100, sd: 15 }, PR: { mean: 0.130, sd: 0.022 }, QRS: { mean: 0.072, sd: 0.008 }, QTc: { mean: 0.410, sd: 0.022 }, QRSaxis: { mean: 60, sd: 28 }, Taxis: { mean: 40, sd: 22 }, Paxis: { mean: 52, sd: 15 } },
    { id: "school_early", age_range: [5.0, 8.0], HR: { mean: 90, sd: 14 }, PR: { mean: 0.140, sd: 0.024 }, QRS: { mean: 0.076, sd: 0.010 }, QTc: { mean: 0.410, sd: 0.022 }, QRSaxis: { mean: 58, sd: 26 }, Taxis: { mean: 38, sd: 20 }, Paxis: { mean: 50, sd: 15 } },
    { id: "school_late", age_range: [8.0, 12.0], HR: { mean: 80, sd: 12 }, PR: { mean: 0.150, sd: 0.026 }, QRS: { mean: 0.080, sd: 0.010 }, QTc: { mean: 0.410, sd: 0.020 }, QRSaxis: { mean: 55, sd: 25 }, Taxis: { mean: 38, sd: 18 }, Paxis: { mean: 50, sd: 14 } },
    { id: "adolescent", age_range: [12.0, 16.0], HR: { mean: 75, sd: 12 }, PR: { mean: 0.155, sd: 0.028 }, QRS: { mean: 0.085, sd: 0.012 }, QTc: { mean: 0.410, sd: 0.020 }, QRSaxis: { mean: 52, sd: 24 }, Taxis: { mean: 38, sd: 18 }, Paxis: { mean: 50, sd: 14 } },
    { id: "young_adult", age_range: [16.0, 100.0], HR: { mean: 70, sd: 12 }, PR: { mean: 0.160, sd: 0.028 }, QRS: { mean: 0.090, sd: 0.012 }, QTc: { mean: 0.410, sd: 0.020 }, QRSaxis: { mean: 50, sd: 30 }, Taxis: { mean: 40, sd: 20 }, Paxis: { mean: 50, sd: 15 } },
  ],
  morphology: {
    rvDom: [{ age: 0, mean: 1.0, sd: 0.05 }, { age: 0.5, mean: 0.9, sd: 0.08 }, { age: 1, mean: 0.8, sd: 0.1 }, { age: 3, mean: 0.6, sd: 0.12 }, { age: 8, mean: 0.4, sd: 0.12 }, { age: 12, mean: 0.25, sd: 0.1 }, { age: 16, mean: 0.15, sd: 0.08 }],
    juvenileT: [{ age: 0, mean: 1.0, sd: 0.05 }, { age: 1, mean: 0.9, sd: 0.08 }, { age: 4, mean: 0.75, sd: 0.12 }, { age: 8, mean: 0.5, sd: 0.15 }, { age: 12, mean: 0.25, sd: 0.12 }, { age: 16, mean: 0.1, sd: 0.08 }],
    // Rijnbeek 2001 R-wave amplitude targets (mV, median values, averaged M/F)
    // Source: Eur Heart J 2001;22:702-711, Table 5
    rijnbeekTargets: [
      { age: 0, V1: 1.22, V2: 1.83, V3: 1.80, V4: 1.74, V5: 1.35, V6: 0.97, I: 0.28, II: 0.67, III: 0.82, aVL: 0.17, aVF: 0.66 },
      { age: 0.17, V1: 1.20, V2: 1.82, V3: 2.00, V4: 2.28, V5: 1.90, V6: 1.53, I: 0.56, II: 1.12, III: 0.84, aVL: 0.30, aVF: 0.93 },
      { age: 0.75, V1: 1.07, V2: 1.88, V3: 2.05, V4: 2.25, V5: 1.95, V6: 1.69, I: 0.56, II: 1.15, III: 0.87, aVL: 0.28, aVF: 0.99 },
      { age: 2, V1: 1.05, V2: 1.79, V3: 2.00, V4: 2.29, V5: 2.00, V6: 1.74, I: 0.55, II: 1.20, III: 0.88, aVL: 0.26, aVF: 1.02 },
      { age: 4, V1: 0.86, V2: 1.50, V3: 1.90, V4: 2.33, V5: 2.10, V6: 1.92, I: 0.53, II: 1.25, III: 0.90, aVL: 0.24, aVF: 1.05 },
      { age: 6.5, V1: 0.59, V2: 1.14, V3: 1.55, V4: 1.98, V5: 2.00, V6: 2.01, I: 0.56, II: 1.29, III: 0.92, aVL: 0.20, aVF: 1.10 },
      { age: 10, V1: 0.52, V2: 0.96, V3: 1.40, V4: 1.79, V5: 1.95, V6: 2.09, I: 0.57, II: 1.36, III: 0.91, aVL: 0.17, aVF: 1.13 },
      { age: 14, V1: 0.42, V2: 0.82, V3: 1.20, V4: 1.56, V5: 1.75, V6: 1.84, I: 0.53, II: 1.32, III: 0.87, aVL: 0.18, aVF: 1.08 },
    ],
  },
  sex_adjustments: {
    male: { QTc_offset: -0.01, QRS_factor: 1.05, voltage_factor: 1.1 },
    female: { QTc_offset: 0.01, QRS_factor: 0.95, voltage_factor: 0.9 },
  },
};

/**
 * Get the appropriate age bin for a given age
 * @param {number} ageY - Age in years
 * @returns {object} Age bin with prior distributions
 */
export function getAgeBin(ageY) {
  for (const bin of PEDIATRIC_PRIORS.age_bins) {
    if (ageY >= bin.age_range[0] && ageY < bin.age_range[1]) {
      return bin;
    }
  }
  // Return last bin (young_adult) for ages >= 16
  return PEDIATRIC_PRIORS.age_bins[PEDIATRIC_PRIORS.age_bins.length - 1];
}

/**
 * Interpolate morphology parameter from age-indexed array
 * @param {number} ageY - Age in years
 * @param {Array} ageArray - Array of {age, mean, sd} objects
 * @returns {object} {mean, sd} for interpolated age
 */
function interpMorphology(ageY, ageArray) {
  if (ageY <= ageArray[0].age) return { mean: ageArray[0].mean, sd: ageArray[0].sd };
  if (ageY >= ageArray[ageArray.length - 1].age) {
    const last = ageArray[ageArray.length - 1];
    return { mean: last.mean, sd: last.sd };
  }
  // Find bracketing ages
  for (let i = 0; i < ageArray.length - 1; i++) {
    if (ageY >= ageArray[i].age && ageY < ageArray[i + 1].age) {
      const t = (ageY - ageArray[i].age) / (ageArray[i + 1].age - ageArray[i].age);
      return {
        mean: lerp(ageArray[i].mean, ageArray[i + 1].mean, t),
        sd: lerp(ageArray[i].sd, ageArray[i + 1].sd, t),
      };
    }
  }
  return { mean: ageArray[0].mean, sd: ageArray[0].sd };
}

/**
 * Get age-dependent amplitude scale factor (Rijnbeek 2001 calibration)
 * Includes base multiplier and age-dependent scaling
 * @param {number} ageY - Age in years
 * @returns {number} Total amplitude scaling factor
 */
/**
 * Interpolate a factor from age-anchored array
 */
function interpFactor(ageY, anchors) {
  if (ageY <= anchors[0].age) return anchors[0].factor;
  if (ageY >= anchors[anchors.length - 1].age) return anchors[anchors.length - 1].factor;

  for (let i = 0; i < anchors.length - 1; i++) {
    if (ageY >= anchors[i].age && ageY < anchors[i + 1].age) {
      const t = (ageY - anchors[i].age) / (anchors[i + 1].age - anchors[i].age);
      return lerp(anchors[i].factor, anchors[i + 1].factor, t);
    }
  }
  return 1.0;
}

// Pre-computed calibration factors: target / raw baseline
// Based on Rijnbeek 2001 targets and measured VCG projection baselines
const CALIBRATION_FACTORS = [
  { age: 0, V1: 1.24, V2: 2.22, V3: 4.06, V4: 17.6, V5: 23.3, V6: 7.82, I: 1.19, II: 1.09, III: 0.66, aVL: 0.74, aVF: 0.91 },
  { age: 0.17, V1: 1.28, V2: 2.27, V3: 4.36, V4: 17.7, V5: 32.8, V6: 12.2, I: 2.38, II: 1.81, III: 0.67, aVL: 1.33, aVF: 1.20 },
  { age: 0.75, V1: 1.24, V2: 2.37, V3: 4.04, V4: 9.41, V5: 26.4, V6: 12.5, I: 2.22, II: 1.77, III: 0.66, aVL: 1.19, aVF: 1.04 },
  { age: 2, V1: 1.57, V2: 2.57, V3: 3.59, V4: 6.07, V5: 12.1, V6: 9.67, I: 1.99, II: 1.08, III: 0.63, aVL: 1.03, aVF: 0.81 },
  { age: 4, V1: 2.04, V2: 2.35, V3: 2.69, V4: 3.54, V5: 4.19, V6: 5.44, I: 1.19, II: 0.85, III: 0.79, aVL: 0.79, aVF: 0.82 },
  { age: 6.5, V1: 2.37, V2: 2.14, V3: 2.11, V4: 2.69, V5: 3.22, V6: 3.94, I: 0.76, II: 0.75, III: 0.88, aVL: 0.62, aVF: 0.79 },
  { age: 10, V1: 2.30, V2: 2.05, V3: 1.83, V4: 2.17, V5: 2.65, V6: 3.32, I: 0.61, II: 0.77, III: 1.08, aVL: 0.50, aVF: 0.87 },
  { age: 14, V1: 2.00, V2: 2.03, V3: 1.55, V4: 1.76, V5: 2.09, V6: 2.42, I: 0.45, II: 0.70, III: 1.18, aVL: 0.46, aVF: 0.82 },
];

/**
 * Get lead-specific calibration factors (Rijnbeek 2001)
 * Returns object with scaling factor for each lead
 */
export function getLeadCalibration(ageY) {
  const factors = CALIBRATION_FACTORS;

  // Find interpolation bounds
  if (ageY <= factors[0].age) {
    return { ...factors[0] };
  }
  if (ageY >= factors[factors.length - 1].age) {
    return { ...factors[factors.length - 1] };
  }

  // Interpolate between age brackets
  for (let i = 0; i < factors.length - 1; i++) {
    if (ageY >= factors[i].age && ageY < factors[i + 1].age) {
      const t = (ageY - factors[i].age) / (factors[i + 1].age - factors[i].age);
      const result = { age: ageY };
      for (const lead of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'I', 'II', 'III', 'aVL', 'aVF']) {
        result[lead] = lerp(factors[i][lead], factors[i + 1][lead], t);
      }
      return result;
    }
  }

  return { ...factors[0] };
}

/**
 * Sample ECG parameters from pediatric priors for a given age
 * Uses truncated normal distributions to stay within physiological bounds
 * @param {number} ageY - Age in years
 * @param {number} seed - Random seed for reproducibility
 * @param {string} sex - Optional sex ('male', 'female', or null for neutral)
 * @returns {object} Sampled ECG parameters with realistic variation
 */
export function samplePediatricPriors(ageY, seed, sex = null) {
  const rng = mulberry32(seed + 7777); // Offset to avoid correlation with other uses
  const bin = getAgeBin(ageY);

  // Helper to sample from truncated normal (within ±2.5 SD)
  function sampleTruncNorm(mean, sd, minVal, maxVal) {
    let val;
    for (let i = 0; i < 10; i++) {
      val = mean + randn(rng) * sd;
      if (val >= minVal && val <= maxVal) return val;
    }
    return clamp(val, minVal, maxVal);
  }

  // Sample main parameters from age bin
  let HR = sampleTruncNorm(bin.HR.mean, bin.HR.sd, 40, 220);
  let PR = sampleTruncNorm(bin.PR.mean, bin.PR.sd, 0.06, 0.30);
  let QRS = sampleTruncNorm(bin.QRS.mean, bin.QRS.sd, 0.04, 0.16);
  let QTc = sampleTruncNorm(bin.QTc.mean, bin.QTc.sd, 0.32, 0.50);
  let QRSaxis = sampleTruncNorm(bin.QRSaxis.mean, bin.QRSaxis.sd, -90, 180);
  let Taxis = sampleTruncNorm(bin.Taxis.mean, bin.Taxis.sd, -90, 180);
  let Paxis = sampleTruncNorm(bin.Paxis.mean, bin.Paxis.sd, 0, 90);

  // Sample morphology parameters
  const rvDomPrior = interpMorphology(ageY, PEDIATRIC_PRIORS.morphology.rvDom);
  const juvenileTPrior = interpMorphology(ageY, PEDIATRIC_PRIORS.morphology.juvenileT);
  const rvDom = sampleTruncNorm(rvDomPrior.mean, rvDomPrior.sd, 0, 1);
  const juvenileT = sampleTruncNorm(juvenileTPrior.mean, juvenileTPrior.sd, 0, 1);

  // Apply sex-specific adjustments
  if (sex === 'male') {
    QTc += PEDIATRIC_PRIORS.sex_adjustments.male.QTc_offset;
    QRS *= PEDIATRIC_PRIORS.sex_adjustments.male.QRS_factor;
  } else if (sex === 'female') {
    QTc += PEDIATRIC_PRIORS.sex_adjustments.female.QTc_offset;
    QRS *= PEDIATRIC_PRIORS.sex_adjustments.female.QRS_factor;
  }

  // Derived parameters
  const zQ2 = lerp(0.75, 0.35, clamp(ageY / 16, 0, 1));
  const zT = lerp(-0.6, -0.18, clamp(ageY / 16, 0, 1));

  return {
    HR,
    PR,
    QRS,
    QTc,
    Paxis,
    QRSaxis,
    Taxis,
    rvDom,
    juvenileT,
    zQ2,
    zT,
    _ageBin: bin.id,
    _priorSource: 'pediatric_priors_v1',
  };
}

/**
 * Get z-score for a measurement given age
 * Useful for evaluating if a measurement is within normal limits
 * @param {string} param - Parameter name (HR, PR, QRS, QTc, QRSaxis)
 * @param {number} value - Measured value
 * @param {number} ageY - Age in years
 * @returns {number} Z-score (0 = mean, ±1 = 1 SD from mean)
 */
export function computeZScore(param, value, ageY) {
  const bin = getAgeBin(ageY);
  if (!bin[param]) return null;
  const { mean, sd } = bin[param];
  return (value - mean) / sd;
}

/**
 * Check if a measurement is within normal limits for age
 * @param {string} param - Parameter name
 * @param {number} value - Measured value
 * @param {number} ageY - Age in years
 * @param {number} zLimit - Z-score limit (default 2 = 95% CI)
 * @returns {object} {normal: boolean, zScore: number, interpretation: string}
 */
export function checkNormalLimits(param, value, ageY, zLimit = 2) {
  const z = computeZScore(param, value, ageY);
  if (z === null) return { normal: null, zScore: null, interpretation: 'Unknown parameter' };

  const absZ = Math.abs(z);
  let interpretation;
  if (absZ <= 1) interpretation = 'Normal';
  else if (absZ <= 2) interpretation = z > 0 ? 'High-normal' : 'Low-normal';
  else if (absZ <= 3) interpretation = z > 0 ? 'Elevated' : 'Low';
  else interpretation = z > 0 ? 'Markedly elevated' : 'Markedly low';

  return {
    normal: absZ <= zLimit,
    zScore: z,
    interpretation,
  };
}

// ============================================================================
// DIAGNOSES AND PARAMETER MODIFIERS
// ============================================================================

export const DIAGNOSES = [
  "Normal sinus",
  "WPW",
  "RBBB",
  "LBBB",
  "LAFB",
  "LVH",
  "RVH",
  "SVT (narrow)",
  "Atrial flutter (2:1)",
  "1st degree AVB",
  "2nd degree AVB (Wenckebach)",
  "2nd degree AVB (Mobitz II)",
  "3rd degree AVB",
  "Long QT",
  "Pericarditis",
  "PACs",
  "PVCs",
  "Sinus bradycardia",
  "Sinus tachycardia",
];

// Age anchors for parameter interpolation
const AGE_ANCHORS = [
  { age: 0.0, HR: 140, PR: 0.1, QRS: 0.065, QTc: 0.41, Paxis: 65, QRSaxis: 125, Taxis: 85, rvDom: 1.0, juvenileT: 1.0, zQ2: 0.75, zT: -0.6 },
  { age: 1.0, HR: 120, PR: 0.11, QRS: 0.07, QTc: 0.41, Paxis: 60, QRSaxis: 105, Taxis: 70, rvDom: 0.85, juvenileT: 0.9, zQ2: 0.65, zT: -0.55 },
  { age: 4.0, HR: 100, PR: 0.12, QRS: 0.07, QTc: 0.41, Paxis: 60, QRSaxis: 75, Taxis: 50, rvDom: 0.65, juvenileT: 0.75, zQ2: 0.55, zT: -0.45 },
  { age: 8.0, HR: 85, PR: 0.14, QRS: 0.08, QTc: 0.41, Paxis: 55, QRSaxis: 60, Taxis: 45, rvDom: 0.45, juvenileT: 0.5, zQ2: 0.45, zT: -0.32 },
  { age: 16.0, HR: 70, PR: 0.16, QRS: 0.09, QTc: 0.41, Paxis: 55, QRSaxis: 50, Taxis: 40, rvDom: 0.25, juvenileT: 0.2, zQ2: 0.35, zT: -0.18 },
];

function interpAnchors(age, anchors, key) {
  if (age <= anchors[0].age) return anchors[0][key];
  if (age >= anchors[anchors.length - 1].age) return anchors[anchors.length - 1][key];
  for (let i = 0; i < anchors.length - 1; i++) {
    const A = anchors[i], B = anchors[i + 1];
    if (age >= A.age && age <= B.age) {
      const u = (age - A.age) / (B.age - A.age);
      return lerp(A[key], B[key], u);
    }
  }
  return anchors[0][key];
}

export function ageDefaults(ageY, sex = null) {
  ageY = clamp(ageY, 0, 25);

  let QTc = interpAnchors(ageY, AGE_ANCHORS, "QTc");
  let QRS = interpAnchors(ageY, AGE_ANCHORS, "QRS");
  let voltageFactor = 1.0;

  // Apply sex-specific adjustments from Rijnbeek et al.
  if (sex === 'male') {
    QTc += PEDIATRIC_PRIORS.sex_adjustments.male.QTc_offset;
    QRS *= PEDIATRIC_PRIORS.sex_adjustments.male.QRS_factor;
    voltageFactor = PEDIATRIC_PRIORS.sex_adjustments.male.voltage_factor;
  } else if (sex === 'female') {
    QTc += PEDIATRIC_PRIORS.sex_adjustments.female.QTc_offset;
    QRS *= PEDIATRIC_PRIORS.sex_adjustments.female.QRS_factor;
    voltageFactor = PEDIATRIC_PRIORS.sex_adjustments.female.voltage_factor;
  }

  return {
    HR: interpAnchors(ageY, AGE_ANCHORS, "HR"),
    PR: interpAnchors(ageY, AGE_ANCHORS, "PR"),
    QRS,
    QTc,
    Paxis: interpAnchors(ageY, AGE_ANCHORS, "Paxis"),
    QRSaxis: interpAnchors(ageY, AGE_ANCHORS, "QRSaxis"),
    Taxis: interpAnchors(ageY, AGE_ANCHORS, "Taxis"),
    rvDom: interpAnchors(ageY, AGE_ANCHORS, "rvDom"),
    juvenileT: interpAnchors(ageY, AGE_ANCHORS, "juvenileT"),
    zQ2: interpAnchors(ageY, AGE_ANCHORS, "zQ2"),
    zT: interpAnchors(ageY, AGE_ANCHORS, "zT"),
    voltageFactor,
  };
}

export function applyDx(p, dx) {
  const q = { ...p };
  if (dx === "WPW") {
    q.PR = Math.max(0.08, p.PR - 0.04);
    q.QRS = Math.min(0.12, p.QRS + 0.04);
  }
  if (dx === "RBBB") {
    q.QRS = Math.min(0.14, p.QRS + 0.04);
  }
  if (dx === "LBBB") {
    q.QRS = Math.min(0.16, p.QRS + 0.06);
    q.QRSaxis = Math.max(-45, p.QRSaxis - 40);
  }
  if (dx === "LAFB") {
    q.QRSaxis = Math.max(-60, p.QRSaxis - 50);
  }
  if (dx === "LVH") {
    q.QRSaxis = Math.max(-30, p.QRSaxis - 35);
  }
  if (dx === "RVH") {
    q.QRSaxis = Math.min(170, p.QRSaxis + 35);
    q.rvDom = Math.min(1.2, p.rvDom + 0.25);
  }
  if (dx === "SVT (narrow)") {
    q.HR = Math.max(150, Math.min(230, p.HR * 1.9));
  }
  if (dx === "Atrial flutter (2:1)") {
    q.HR = Math.max(120, Math.min(180, p.HR * 1.5));
  }
  if (dx === "1st degree AVB") {
    q.PR = Math.min(0.28, p.PR + 0.08);
  }
  if (dx === "Long QT") {
    q.QTc = 0.5;
  }
  if (dx === "Sinus bradycardia") {
    q.HR = Math.max(40, Math.min(60, p.HR * 0.6));
  }
  if (dx === "Sinus tachycardia") {
    q.HR = Math.max(100, Math.min(150, p.HR * 1.4));
  }
  return q;
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
  // Guard against division by zero and invalid inputs
  if (sigma === 0 || !coeffs || coeffs.length === 0) {
    return 0;
  }
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
// BEAT-TO-BEAT MORPHOLOGY JITTER
// Generates realistic per-beat variations in amplitude, timing, duration, and shape
// Real ECGs have subtle beat-to-beat variations due to:
// - Respiratory modulation (amplitude changes with breathing)
// - Autonomic tone fluctuations
// - Slight electrode contact variations
// - Beat-to-beat hemodynamic changes
// ============================================================================

/**
 * Generate per-beat jitter parameters for realistic morphology variation
 * @param {number} beatIndex - Index of the beat in the trace
 * @param {number} totalBeats - Total number of beats
 * @param {function} rng - Random number generator
 * @param {number} respiratoryRate - Respiratory rate in breaths/min (default 15)
 * @param {number} fs - Sampling rate (for time calculations)
 * @returns {Object} Jitter parameters for this beat
 */
export function generateBeatJitter(beatIndex, totalBeats, rng, respiratoryRate = 15, beatTime = 0) {
  // Respiratory modulation - sinusoidal amplitude variation with breathing
  // Inspiration increases R-wave amplitude, expiration decreases it
  const respPeriod = 60 / respiratoryRate;  // seconds per breath
  const respPhase = (beatTime % respPeriod) / respPeriod * 2 * Math.PI;
  const respModulation = 0.06 * Math.sin(respPhase);  // ±6% with respiration

  // Random amplitude jitter (±5% baseline + respiratory)
  const ampJitter = 1.0 + respModulation + randn(rng) * 0.05;

  // Timing jitter (±8ms for QRS onset, ±5ms for other features)
  const timeJitterQRS = randn(rng) * 0.008;
  const timeJitterP = randn(rng) * 0.005;
  const timeJitterT = randn(rng) * 0.006;

  // Duration jitter (±3% for QRS width, ±5% for P and T)
  const qrsDurationFactor = 1.0 + randn(rng) * 0.03;
  const pDurationFactor = 1.0 + randn(rng) * 0.05;
  const tDurationFactor = 1.0 + randn(rng) * 0.05;

  // Shape jitter - subtle variations in direction vectors
  // These create slight axis shifts beat-to-beat
  const dirJitter = [
    randn(rng) * 0.03,  // X component
    randn(rng) * 0.03,  // Y component
    randn(rng) * 0.02,  // Z component (less variation)
  ];

  // P wave amplitude variation (atrial conduction variability)
  const pAmpFactor = 1.0 + randn(rng) * 0.08;

  // T wave amplitude variation (repolarization variability)
  const tAmpFactor = 1.0 + randn(rng) * 0.07;

  // Occasional subtle notching probability (adds micro-notches)
  const hasSubtleNotch = rng() < 0.15;  // 15% of beats
  const notchDepth = hasSubtleNotch ? 0.03 + rng() * 0.04 : 0;
  const notchPosition = 0.4 + rng() * 0.2;  // Position within QRS

  return {
    ampJitter,
    timeJitterQRS,
    timeJitterP,
    timeJitterT,
    qrsDurationFactor,
    pDurationFactor,
    tDurationFactor,
    dirJitter,
    pAmpFactor,
    tAmpFactor,
    hasSubtleNotch,
    notchDepth,
    notchPosition,
    respPhase,
  };
}

/**
 * Apply direction jitter to a direction vector
 * @param {Array} dir - Original direction vector [x, y, z]
 * @param {Array} jitter - Jitter values [dx, dy, dz]
 * @returns {Array} Jittered and normalized direction vector
 */
function applyDirJitter(dir, jitter) {
  return norm([
    dir[0] + jitter[0],
    dir[1] + jitter[1],
    dir[2] + jitter[2],
  ]);
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

// Jittered versions of wave generation functions

function addPWaveJittered(Vx, Vy, Vz, fs, pCenter, aScale, durFactor, dP1, dP2) {
  // Duration jitter affects wave width
  const sig1 = 0.014 * durFactor;
  const sig2 = 0.016 * durFactor;
  addGaussian3(Vx, Vy, Vz, fs, pCenter - 0.01, sig1, 0.075 * aScale, dP1);
  addGaussian3(Vx, Vy, Vz, fs, pCenter + 0.012, sig2, 0.095 * aScale, dP2);
}

function addQRSJittered(Vx, Vy, Vz, fs, qrsOn, qrsC, params, jitter, dQ1, dQ2, dQ3, dx, isPVC, rng) {
  const qrsWidth = params.QRS * jitter.qrsDurationFactor;
  const qrsAmp = isPVC ? 1.4 : 1.0;
  const aScale = jitter.ampJitter;

  if (dx === "LBBB") {
    const dLBBB1 = applyDirJitter(norm([0.85, 0.3, 0.4]), jitter.dirJitter);
    const dLBBB2 = applyDirJitter(norm([0.7, 0.6, -0.2]), jitter.dirJitter);
    addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.35 * qrsWidth, 0.12 * qrsWidth, 0.6 * aScale, dLBBB1);
    addGaussian3(Vx, Vy, Vz, fs, qrsC, 0.18 * qrsWidth, 0.9 * aScale, dLBBB2);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.35 * qrsWidth, 0.14 * qrsWidth, 0.5 * aScale, dLBBB1);
    return;
  }

  if (isPVC) {
    const dPVC = applyDirJitter(norm([0.3 + rng() * 0.4, 0.8, -0.5 + rng() * 0.3]), jitter.dirJitter);
    addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.3 * qrsWidth, 0.12 * qrsWidth, 0.4 * aScale * qrsAmp, dQ1);
    addGaussian3(Vx, Vy, Vz, fs, qrsC, 0.2 * qrsWidth, 1.2 * aScale * qrsAmp, dPVC);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.35 * qrsWidth, 0.15 * qrsWidth, 0.5 * aScale * qrsAmp, dQ3);
    return;
  }

  // Normal QRS with optional subtle notching
  addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.32 * qrsWidth, 0.09 * qrsWidth, 0.22 * aScale * qrsAmp, dQ1);
  addGaussian3(Vx, Vy, Vz, fs, qrsC, 0.16 * qrsWidth, 1.1 * aScale * qrsAmp, dQ2);
  addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.34 * qrsWidth, 0.12 * qrsWidth, 0.36 * aScale * qrsAmp, dQ3);

  // Add subtle notching (15% of beats have micro-variations)
  if (jitter.hasSubtleNotch && jitter.notchDepth > 0) {
    const notchTime = qrsC + (jitter.notchPosition - 0.5) * 0.4 * qrsWidth;
    const notchDir = norm([-dQ2[0] * 0.3, -dQ2[1] * 0.2, dQ2[2] * 0.5]);
    addGaussian3(Vx, Vy, Vz, fs, notchTime, 0.004, jitter.notchDepth * aScale, notchDir);
  }
}

function addTWaveJittered(Vx, Vy, Vz, fs, qrsOn, QT, aScale, tJit, dT1, dT2, Taxis, isPVC) {
  const tPeak = qrsOn + 0.62 * QT + tJit;
  const tAmp = isPVC ? 0.7 : 1.0;
  const tDir1 = isPVC ? norm([-dT1[0], -dT1[1], -dT1[2]]) : dT1;
  const tDir2 = isPVC ? norm([-dT2[0], -dT2[1], -dT2[2]]) : dT2;

  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.0, 0.1 * QT, 0.22 * aScale * tAmp, tDir1);
  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.03, 0.14 * QT, 0.18 * aScale * tAmp, tDir2);
  addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.16, 0.04, 0.015 * aScale, axisDir(Taxis, -0.1));
}

// ============================================================================
// TEMPLATE-BASED WAVE GENERATION (Feature-flagged alternative to parametric)
// ============================================================================

/**
 * Add P wave using template morphology
 */
function addPWaveTemplate(Vx, Vy, Vz, fs, pCenter, aScale, dx, age, dP, rng) {
  if (!templatesReady()) return false;

  const waveform = getTemplateWaveform('p', dx, {
    targetDurationMs: 100,
    targetAmplitude: 0.1 * aScale,
    targetFs: fs,
    age
  }, rng);

  if (!waveform) return false;

  // Calculate start sample (center waveform on pCenter)
  const startSample = Math.round(pCenter * fs - waveform.length / 2);
  addTemplateToVCG(Vx, Vy, Vz, waveform, dP, startSample, fs);
  return true;
}

/**
 * Add QRS complex using template morphology
 */
function addQRSTemplate(Vx, Vy, Vz, fs, qrsOn, qrsWidth, aScale, dx, age, dQ, isPVC, rng) {
  if (!templatesReady()) return false;

  // Select appropriate template category
  const category = isPVC ? 'pvc' : 'qrs';
  const targetDx = isPVC ? 'pvc' : dx;

  const waveform = getTemplateWaveform(category, targetDx, {
    targetDurationMs: qrsWidth * 1000,
    targetAmplitude: aScale,
    targetFs: fs,
    age
  }, rng);

  if (!waveform) return false;

  const startSample = Math.round(qrsOn * fs);
  addTemplateToVCG(Vx, Vy, Vz, waveform, dQ, startSample, fs);
  return true;
}

/**
 * Add T wave using template morphology
 */
function addTWaveTemplate(Vx, Vy, Vz, fs, qrsOn, QT, aScale, dx, age, dT, isPVC, rng) {
  if (!templatesReady()) return false;

  const tPeak = qrsOn + 0.62 * QT;
  const tDuration = 0.35 * QT * 1000; // T wave is ~35% of QT

  const waveform = getTemplateWaveform('t', dx, {
    targetDurationMs: tDuration,
    targetAmplitude: 0.25 * aScale * (isPVC ? -0.7 : 1.0),
    targetFs: fs,
    age
  }, rng);

  if (!waveform) return false;

  const startSample = Math.round((tPeak - tDuration / 2000) * fs);
  addTemplateToVCG(Vx, Vy, Vz, waveform, dT, startSample, fs);
  return true;
}

// ============================================================================
// MORPHOLOGY MODEL (Main synthesis function)
// ============================================================================

export function morphologyModel(beatSchedule, params, dx, fs, N, seed, ageY = 8) {
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

  // Respiratory rate varies with age (higher in infants)
  const respRate = ageY < 1 ? 40 : ageY < 5 ? 25 : ageY < 12 ? 20 : 15;
  const totalBeats = beatSchedule.beats.length;

  // Generate waveforms for each beat with enhanced jitter
  for (let beatIdx = 0; beatIdx < totalBeats; beatIdx++) {
    const beat = beatSchedule.beats[beatIdx];
    const beatTime = beat.qrsTime || beat.pTime || 0;

    // Generate comprehensive per-beat jitter
    const jitter = generateBeatJitter(beatIdx, totalBeats, rng, respRate, beatTime);

    // Apply jittered direction vectors for this beat
    const dP1j = applyDirJitter(dP1, jitter.dirJitter);
    const dP2j = applyDirJitter(dP2, jitter.dirJitter);
    const dQ1j = applyDirJitter(dQ1, jitter.dirJitter);
    const dQ2j = applyDirJitter(dQ2, jitter.dirJitter);
    const dQ3j = applyDirJitter(dQ3, jitter.dirJitter);
    const dT1j = applyDirJitter(dT1, jitter.dirJitter);
    const dT2j = applyDirJitter(dT2, jitter.dirJitter);

    // P wave with enhanced jitter
    if (beat.hasPWave && beat.pTime != null) {
      const pCenter = beat.pTime + 0.04 + jitter.timeJitterP;
      const pAmp = jitter.ampJitter * jitter.pAmpFactor;
      addPWaveJittered(Vx, Vy, Vz, fs, pCenter, pAmp, jitter.pDurationFactor, dP1j, dP2j);
    }

    // QRS complex with enhanced jitter
    if (beat.hasQRS && beat.qrsTime != null) {
      const qrsOn = beat.qrsTime + jitter.timeJitterQRS;
      const qrsWidth = params.QRS * jitter.qrsDurationFactor;
      const qrsC = qrsOn + qrsWidth / 2;

      addQRSJittered(Vx, Vy, Vz, fs, qrsOn, qrsC, params, jitter, dQ1j, dQ2j, dQ3j, dx, beat.isPVC, rng);

      // Morphology modifiers with jitter
      if (!beat.isPVC) {
        if (dx === "WPW") {
          const dDelta = norm([dQ1j[0] * 0.6 + dQ2j[0] * 0.4, dQ1j[1] * 0.6 + dQ2j[1] * 0.4, dQ1j[2] * 0.6 + dQ2j[2] * 0.4]);
          addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.012 + jitter.timeJitterQRS, 0.022, 0.28 * jitter.ampJitter, dDelta);
        }
        if (dx === "RBBB") {
          const dLate = applyDirJitter(norm([-0.9, 0.0, 0.95]), jitter.dirJitter);
          addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.82 * qrsWidth, 0.01 + 0.08 * qrsWidth, 0.35 * jitter.ampJitter, dLate);
        }
        if (dx === "LVH") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC, 0.16 * qrsWidth, 0.55 * jitter.ampJitter, axisDir(params.QRSaxis - 20, params.zQ2 * 0.8));
        }
        if (dx === "RVH") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC, 0.14 * qrsWidth, 0.45 * jitter.ampJitter, applyDirJitter(norm([-0.75, 0.2, 0.95]), jitter.dirJitter));
        }
        if (dx === "LAFB") {
          addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.25 * qrsWidth, 0.08 * qrsWidth, 0.15 * jitter.ampJitter, applyDirJitter(norm([0.9, -0.3, 0.1]), jitter.dirJitter));
        }
      }

      // T wave with enhanced jitter
      const tAmp = jitter.ampJitter * jitter.tAmpFactor;
      const tDur = jitter.tDurationFactor;
      addTWaveJittered(Vx, Vy, Vz, fs, qrsOn, QT * tDur, tAmp, jitter.timeJitterT, dT1j, dT2j, params.Taxis, beat.isPVC);

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
        const aST = 0.1 * jitter.ampJitter;
        const aPR = -0.04 * jitter.ampJitter;
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

  // Note: Lead-specific amplitude calibration is applied in deviceAndArtifactModel
  // after VCG-to-lead projection, matching Rijnbeek 2001 reference values

  return { Vx, Vy, Vz, QT };
}

// ============================================================================
// MODULE 3: LEAD FIELD MODEL (Step 4: Improved)
// Projects VCG to electrode potentials using forward model with:
// - Parameterized heart orientation (age-dependent)
// - Heart position variability
// - Realistic chest lead progression
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

/**
 * Get age-dependent heart orientation parameters
 * Heart position and orientation change with age:
 * - Neonates: More horizontal, right-shifted
 * - Children: Gradually more vertical
 * - Adults: Standard position
 * @param {number} ageY - Age in years
 * @returns {Object} Heart orientation parameters (angles in radians)
 */
export function getHeartOrientationParams(ageY) {
  // Heart rotation angles (Euler angles: roll, pitch, yaw)
  // Roll (α): rotation around anterior-posterior axis
  // Pitch (β): rotation around left-right axis
  // Yaw (γ): rotation around superior-inferior axis

  if (ageY < 1) {
    // Neonates: heart more horizontal, rightward
    return {
      roll: 0.15,      // ~8.5° more horizontal
      pitch: 0.08,     // slight anterior tilt
      yaw: 0.12,       // rightward rotation
      rollVar: 0.08,   // variation
      pitchVar: 0.05,
      yawVar: 0.06,
    };
  } else if (ageY < 6) {
    // Toddlers/preschool: transitioning
    return {
      roll: 0.10,
      pitch: 0.05,
      yaw: 0.08,
      rollVar: 0.07,
      pitchVar: 0.04,
      yawVar: 0.05,
    };
  } else if (ageY < 12) {
    // School age: approaching adult
    return {
      roll: 0.05,
      pitch: 0.03,
      yaw: 0.04,
      rollVar: 0.06,
      pitchVar: 0.03,
      yawVar: 0.04,
    };
  } else {
    // Adolescent/adult: standard orientation
    return {
      roll: 0.0,
      pitch: 0.0,
      yaw: 0.0,
      rollVar: 0.05,
      pitchVar: 0.03,
      yawVar: 0.03,
    };
  }
}

/**
 * Create 3D rotation matrix from Euler angles (ZYX convention)
 * @param {number} roll - rotation around X axis
 * @param {number} pitch - rotation around Y axis
 * @param {number} yaw - rotation around Z axis
 * @returns {Array} 3x3 rotation matrix as flat array
 */
export function createRotationMatrix(roll, pitch, yaw) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  // ZYX Euler rotation matrix
  return [
    cy * cp,                      cy * sp * sr - sy * cr,       cy * sp * cr + sy * sr,
    sy * cp,                      sy * sp * sr + cy * cr,       sy * sp * cr - cy * sr,
    -sp,                          cp * sr,                      cp * cr
  ];
}

/**
 * Apply rotation matrix to a 3D vector
 */
function rotateVector(R, v) {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

/**
 * Apply rotation to VCG signals (rotate dipole orientation)
 */
function rotateVCG(Vx, Vy, Vz, R) {
  const N = Vx.length;
  const VxR = new Float64Array(N);
  const VyR = new Float64Array(N);
  const VzR = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    VxR[i] = R[0] * Vx[i] + R[1] * Vy[i] + R[2] * Vz[i];
    VyR[i] = R[3] * Vx[i] + R[4] * Vy[i] + R[5] * Vz[i];
    VzR[i] = R[6] * Vx[i] + R[7] * Vy[i] + R[8] * Vz[i];
  }

  return { Vx: VxR, Vy: VyR, Vz: VzR };
}

/**
 * Generate random heart orientation based on age
 */
export function generateHeartOrientation(ageY, seed) {
  const rng = mulberry32(seed + 5000);
  const params = getHeartOrientationParams(ageY);

  // Base orientation + random variation
  const roll = params.roll + randn(rng) * params.rollVar;
  const pitch = params.pitch + randn(rng) * params.pitchVar;
  const yaw = params.yaw + randn(rng) * params.yawVar;

  return { roll, pitch, yaw };
}

function dotDipole(Vx, Vy, Vz, r) {
  const out = new Float64Array(Vx.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = Vx[i] * r[0] + Vy[i] * r[1] + Vz[i] * r[2];
  }
  return out;
}

/**
 * Enhanced lead field model with heart orientation
 * @param {Object} vcg - VCG signals { Vx, Vy, Vz }
 * @param {Object} electrodeGeometry - Electrode direction vectors
 * @param {Object} options - Additional options
 * @param {number} options.ageY - Age for orientation priors
 * @param {number} options.seed - Random seed for orientation
 * @param {boolean} options.applyRotation - Whether to apply heart rotation (default true)
 */
export function leadFieldModel(vcg, electrodeGeometry = DEFAULT_ELECTRODE_GEOMETRY, options = {}) {
  let { Vx, Vy, Vz } = vcg;
  const { ageY = 30, seed = 42, applyRotation = true } = options;

  // Apply heart orientation rotation if enabled
  if (applyRotation) {
    const orientation = generateHeartOrientation(ageY, seed);
    const R = createRotationMatrix(orientation.roll, orientation.pitch, orientation.yaw);
    const rotated = rotateVCG(Vx, Vy, Vz, R);
    Vx = rotated.Vx;
    Vy = rotated.Vy;
    Vz = rotated.Vz;
  }

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
// MODULE 5: DEVICE AND ARTIFACT MODEL (Step 5: Enhanced)
// Adds realistic noise, artifacts, and applies device filtering
// Features:
// - Correlated baseline wander with colored noise
// - Powerline interference with harmonics
// - Band-limited EMG with nonstationary envelope
// - Electrode motion artifacts (transient shifts)
// - Impedance drift (slow + step changes)
// ============================================================================

export const DEVICE_PRESETS = {
  diagnostic: {
    hpCutoff: 0.05,
    lpCutoff: 150,
    notchFreq: null,        // No notch filter in diagnostic mode (preserves waveform)
    filterOrder: 2,         // 2nd order Butterworth
    adcBits: 16,            // 16-bit ADC (typical)
    adcRangeUV: 10000,      // ±10mV input range
    outputFs: 1000,         // Native sampling rate
    description: "Diagnostic mode (0.05-150 Hz)"
  },
  monitor: {
    hpCutoff: 0.5,
    lpCutoff: 40,
    notchFreq: 60,          // Notch filter enabled for cleaner display
    filterOrder: 2,
    adcBits: 12,            // Lower resolution acceptable
    adcRangeUV: 10000,
    outputFs: 500,          // Often downsampled for display
    description: "Monitor mode (0.5-40 Hz)"
  },
  exercise: {
    hpCutoff: 0.67,
    lpCutoff: 40,
    notchFreq: 60,
    filterOrder: 2,
    adcBits: 12,
    adcRangeUV: 10000,
    outputFs: 500,
    description: "Exercise mode (0.67-40 Hz)"
  },
  holter: {
    hpCutoff: 0.05,
    lpCutoff: 100,
    notchFreq: null,
    filterOrder: 2,
    adcBits: 12,
    adcRangeUV: 10000,
    outputFs: 250,          // Holter often uses 250 Hz for storage
    description: "Holter mode (0.05-100 Hz, 250 Hz sampling)"
  },
  highres: {
    hpCutoff: 0.05,
    lpCutoff: 250,
    notchFreq: null,
    filterOrder: 2,
    adcBits: 16,
    adcRangeUV: 5000,       // Narrower range for better resolution
    outputFs: 1000,
    description: "High-resolution mode (0.05-250 Hz)"
  },
};

export const ARTIFACT_PRESETS = {
  none: {
    baseline: 0, powerline: 0, emg: 0, motion: 0, impedance: 0,
    description: "No artifacts"
  },
  minimal: {
    baseline: 0.02, powerline: 0.002, emg: 0.002, motion: 0.01, impedance: 0.005,
    description: "Minimal artifacts (ideal conditions)"
  },
  typical: {
    baseline: 0.04, powerline: 0.004, emg: 0.004, motion: 0.02, impedance: 0.01,
    description: "Typical clinical artifacts"
  },
  noisy: {
    baseline: 0.08, powerline: 0.008, emg: 0.008, motion: 0.04, impedance: 0.02,
    description: "Noisy recording (restless patient)"
  },
  exercise: {
    baseline: 0.12, powerline: 0.003, emg: 0.015, motion: 0.06, impedance: 0.03,
    description: "Exercise/stress test artifacts"
  },
};

// ============================================================================
// DIGITAL FILTER IMPLEMENTATIONS (Step 6: Device Model)
// ============================================================================

/**
 * Biquad filter coefficient calculation
 * Implements 2nd-order Butterworth sections
 */
export function calcBiquadCoeffs(type, fc, fs, Q = 0.7071) {
  const w0 = 2 * Math.PI * fc / fs;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);

  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosW0) / 2;
      b1 = 1 - cosW0;
      b2 = (1 - cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosW0) / 2;
      b1 = -(1 + cosW0);
      b2 = (1 + cosW0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1;
      b1 = -2 * cosW0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cosW0;
      a2 = 1 - alpha;
      break;
    default:
      throw new Error(`Unknown filter type: ${type}`);
  }

  // Normalize coefficients
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/**
 * Apply biquad filter (Direct Form II Transposed)
 * More numerically stable implementation
 */
export function applyBiquad(x, coeffs) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  const y = new Float64Array(x.length);
  let z1 = 0, z2 = 0;

  for (let i = 0; i < x.length; i++) {
    const input = x[i];
    const output = b0 * input + z1;
    z1 = b1 * input - a1 * output + z2;
    z2 = b2 * input - a2 * output;
    y[i] = output;
  }
  return y;
}

/**
 * Apply cascaded biquad sections for higher-order filter
 * Forward-backward (filtfilt) for zero phase distortion
 */
function applyBiquadFiltfilt(x, coeffs) {
  // Forward pass
  let y = applyBiquad(x, coeffs);
  // Reverse
  y.reverse();
  // Backward pass
  y = applyBiquad(y, coeffs);
  // Reverse back
  y.reverse();
  return y;
}

/**
 * Notch filter for powerline interference removal
 * @param {Float64Array} x - input signal
 * @param {number} fs - sampling frequency
 * @param {number} f0 - notch frequency (50 or 60 Hz)
 * @param {number} Q - quality factor (higher = narrower notch)
 */
export function applyNotchFilter(x, fs, f0, Q = 30) {
  const coeffs = calcBiquadCoeffs('notch', f0, fs, Q);
  return applyBiquadFiltfilt(x, coeffs);
}

/**
 * Apply 2nd order Butterworth lowpass filter
 */
export function applyLowpass2(x, fs, fc) {
  // Q = 1/sqrt(2) for Butterworth response
  const coeffs = calcBiquadCoeffs('lowpass', fc, fs, 0.7071);
  return applyBiquadFiltfilt(x, coeffs);
}

/**
 * Apply 2nd order Butterworth highpass filter
 */
export function applyHighpass2(x, fs, fc) {
  const coeffs = calcBiquadCoeffs('highpass', fc, fs, 0.7071);
  return applyBiquadFiltfilt(x, coeffs);
}

/**
 * Simple 1st order highpass (for backwards compatibility and very low cutoffs)
 */
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

/**
 * Simple 1st order lowpass
 */
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

/**
 * Apply bandpass filter with specified order
 * Uses cascaded biquads for order > 1
 */
function applyBandpass(x, fs, hpCutoff, lpCutoff, order = 2) {
  let y;
  if (order >= 2) {
    // Use 2nd order Butterworth for better rolloff
    // For very low HP cutoff (< 0.1 Hz), use 1st order to avoid instability
    if (hpCutoff < 0.1) {
      y = highpass1(x, fs, hpCutoff);
    } else {
      y = applyHighpass2(x, fs, hpCutoff);
    }
    y = applyLowpass2(y, fs, lpCutoff);
  } else {
    // 1st order filters
    y = highpass1(x, fs, hpCutoff);
    y = lowpass1(y, fs, lpCutoff);
  }
  return y;
}

// ============================================================================
// ADC SIMULATION (Step 6: Device Model)
// ============================================================================

/**
 * Simulate ADC quantization and clipping
 * @param {Float64Array} x - input signal (mV)
 * @param {number} bits - ADC resolution in bits
 * @param {number} rangeUV - full scale range in microvolts (±rangeUV)
 * @returns {Float64Array} quantized signal
 */
export function simulateADC(x, bits, rangeUV) {
  const rangeMV = rangeUV / 1000;  // Convert to mV
  const levels = Math.pow(2, bits);
  const lsb = (2 * rangeMV) / levels;  // LSB size in mV
  const y = new Float64Array(x.length);

  for (let i = 0; i < x.length; i++) {
    // Clip to ADC range
    let v = x[i];
    if (v > rangeMV) v = rangeMV;
    if (v < -rangeMV) v = -rangeMV;

    // Quantize (round to nearest LSB)
    v = Math.round(v / lsb) * lsb;
    y[i] = v;
  }

  return y;
}

// ============================================================================
// DOWNSAMPLING (Step 6: Device Model)
// ============================================================================

/**
 * Downsample signal with anti-aliasing filter
 * @param {Float64Array} x - input signal
 * @param {number} inputFs - input sampling frequency
 * @param {number} outputFs - target sampling frequency
 * @returns {Float64Array} downsampled signal
 */
export function downsample(x, inputFs, outputFs) {
  if (outputFs >= inputFs) return x;  // No downsampling needed

  const ratio = inputFs / outputFs;
  if (!Number.isInteger(ratio)) {
    // Non-integer ratio - use nearest sample (simple but works for ECG)
    const outputLen = Math.floor(x.length / ratio);
    const y = new Float64Array(outputLen);
    for (let i = 0; i < outputLen; i++) {
      y[i] = x[Math.round(i * ratio)];
    }
    // Apply anti-alias filter (Nyquist = outputFs/2)
    return applyLowpass2(y, outputFs, outputFs * 0.45);
  }

  // Integer ratio - apply anti-aliasing then decimate
  // Anti-alias cutoff at 80% of new Nyquist to avoid aliasing
  const antiAliasFreq = (outputFs / 2) * 0.8;
  const filtered = applyLowpass2(x, inputFs, antiAliasFreq);

  // Decimate
  const outputLen = Math.floor(x.length / ratio);
  const y = new Float64Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    y[i] = filtered[i * ratio];
  }

  return y;
}

/**
 * Add EMG noise with nonstationary envelope
 * Band-limited noise in 20-150 Hz range with time-varying amplitude
 */
function addEMG(x, scale, rng, N, fs) {
  const nComp = 18;
  const freqs = [], phases = [];
  for (let k = 0; k < nComp; k++) {
    freqs.push(20 + (130 - 20) * rng()); // 20-150 Hz range
    phases.push(2 * Math.PI * rng());
  }
  // Multiple envelope frequencies for realistic nonstationary behavior
  const envFreqs = [0.3 + rng() * 0.3, 0.8 + rng() * 0.4, 1.5 + rng() * 0.5];
  const envPhases = [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI];

  for (let i = 0; i < N; i++) {
    const tt = i / fs;
    // Multi-frequency envelope for more realistic bursts
    const env = 0.3 + 0.25 * Math.sin(2 * Math.PI * envFreqs[0] * tt + envPhases[0])
                    + 0.25 * Math.sin(2 * Math.PI * envFreqs[1] * tt + envPhases[1])
                    + 0.2 * Math.sin(2 * Math.PI * envFreqs[2] * tt + envPhases[2]);
    let s = 0;
    for (let k = 0; k < nComp; k++) {
      s += Math.sin(2 * Math.PI * freqs[k] * tt + phases[k]);
    }
    s = (s / nComp) * Math.max(0, env) * scale;
    x[i] += s;
  }
}

/**
 * Generate colored noise (1/f noise) for baseline wander
 * More realistic than pure sinusoidal wander
 */
function generateColoredNoise(N, fs, rng) {
  const noise = new Float64Array(N);
  // Sum of sinusoids at low frequencies with 1/f amplitude scaling
  const nComponents = 8;
  for (let k = 0; k < nComponents; k++) {
    const freq = 0.05 + k * 0.08; // 0.05 to 0.61 Hz
    const amp = 1.0 / (1 + k * 0.5); // 1/f-like decay
    const phase = rng() * 2 * Math.PI;
    for (let i = 0; i < N; i++) {
      noise[i] += amp * Math.sin(2 * Math.PI * freq * (i / fs) + phase);
    }
  }
  // Normalize
  const maxNoise = Math.max(...noise.map(Math.abs));
  if (maxNoise > 0) {
    for (let i = 0; i < N; i++) noise[i] /= maxNoise;
  }
  return noise;
}

/**
 * Generate powerline interference with harmonics
 * Includes fundamental (50/60 Hz) and odd harmonics with amplitude modulation
 */
function generatePowerlineNoise(N, fs, rng, fundamental = 60) {
  const noise = new Float64Array(N);
  const phase = rng() * 2 * Math.PI;
  // Amplitude modulation frequency (slow drift in powerline coupling)
  const amFreq = 0.1 + rng() * 0.2;
  const amPhase = rng() * 2 * Math.PI;

  for (let i = 0; i < N; i++) {
    const tt = i / fs;
    // Amplitude modulation (simulates varying electrode-skin impedance)
    const am = 0.7 + 0.3 * Math.sin(2 * Math.PI * amFreq * tt + amPhase);

    // Fundamental + odd harmonics (3rd, 5th)
    let pl = Math.sin(2 * Math.PI * fundamental * tt + phase);
    pl += 0.15 * Math.sin(2 * Math.PI * 3 * fundamental * tt + phase * 1.5);
    pl += 0.05 * Math.sin(2 * Math.PI * 5 * fundamental * tt + phase * 2.0);

    noise[i] = pl * am;
  }
  return noise;
}

/**
 * Generate electrode motion artifacts
 * Transient shifts with bi-exponential recovery (models physical electrode movement)
 */
function generateMotionArtifacts(N, fs, rng, eventRate = 0.3) {
  const artifacts = new Float64Array(N);
  const duration = N / fs;

  // Random motion events
  const nEvents = Math.floor(duration * eventRate * (0.5 + rng()));
  for (let e = 0; e < nEvents; e++) {
    const eventTime = rng() * duration;
    const eventIdx = Math.floor(eventTime * fs);
    const amplitude = (rng() - 0.5) * 2; // Random direction
    const tauFast = 0.05 + rng() * 0.1;  // Fast recovery: 50-150ms
    const tauSlow = 0.3 + rng() * 0.5;   // Slow recovery: 300-800ms
    const fastWeight = 0.7;

    // Bi-exponential recovery
    for (let i = eventIdx; i < N; i++) {
      const dt = (i - eventIdx) / fs;
      const recovery = fastWeight * Math.exp(-dt / tauFast) + (1 - fastWeight) * Math.exp(-dt / tauSlow);
      artifacts[i] += amplitude * recovery;
    }
  }
  return artifacts;
}

/**
 * Generate impedance drift
 * Slow drift + occasional step changes (models electrode gel drying, patient movement)
 */
function generateImpedanceDrift(N, fs, rng) {
  const drift = new Float64Array(N);
  const duration = N / fs;

  // Slow continuous drift
  const driftFreq = 0.02 + rng() * 0.03; // Very low frequency
  const driftPhase = rng() * 2 * Math.PI;
  for (let i = 0; i < N; i++) {
    drift[i] = Math.sin(2 * Math.PI * driftFreq * (i / fs) + driftPhase);
  }

  // Occasional step changes (1-3 per recording)
  const nSteps = 1 + Math.floor(rng() * 2);
  for (let s = 0; s < nSteps; s++) {
    const stepTime = 0.2 + rng() * 0.6; // Steps occur in middle 60% of recording
    const stepIdx = Math.floor(stepTime * duration * fs);
    const stepAmp = (rng() - 0.5) * 0.5;

    for (let i = stepIdx; i < N; i++) {
      drift[i] += stepAmp;
    }
  }

  return drift;
}

export function deviceAndArtifactModel(phi, fs, seed, artifactParams = ARTIFACT_PRESETS.typical, deviceParams = DEVICE_PRESETS.diagnostic, enableNoise = true, enableFilters = true, ageY = 8) {
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
    // Generate correlated noise components
    const baselineNoise = generateColoredNoise(N, fs, rng);
    const powerlineNoise = generatePowerlineNoise(N, fs, rng, 60);

    // Generate electrode-specific artifacts
    const motionRA = artifactParams.motion ? generateMotionArtifacts(N, fs, rng, 0.2) : null;
    const motionLA = artifactParams.motion ? generateMotionArtifacts(N, fs, rng, 0.2) : null;
    const motionLL = artifactParams.motion ? generateMotionArtifacts(N, fs, rng, 0.15) : null;

    // Impedance drift (correlated across all electrodes with slight variation)
    const impedanceDrift = artifactParams.impedance ? generateImpedanceDrift(N, fs, rng) : null;

    // Apply artifacts to limb electrodes (correlated for Einthoven preservation)
    for (let i = 0; i < N; i++) {
      // Baseline wander - correlated across limb leads
      const bw = artifactParams.baseline * baselineNoise[i];

      // Power line interference - correlated across all electrodes
      const pl = artifactParams.powerline * powerlineNoise[i];

      // Motion artifacts - electrode-specific
      const motRA = motionRA ? artifactParams.motion * motionRA[i] : 0;
      const motLA = motionLA ? artifactParams.motion * motionLA[i] : 0;
      const motLL = motionLL ? artifactParams.motion * motionLL[i] : 0;

      // Impedance drift - mostly correlated with slight electrode variation
      const impDrift = impedanceDrift ? artifactParams.impedance * impedanceDrift[i] : 0;

      phiMod.phiRA[i] += bw + pl + motRA + impDrift;
      phiMod.phiLA[i] += bw + pl + motLA + impDrift * 0.95;
      phiMod.phiLL[i] += bw + pl + motLL + impDrift * 0.9;
    }

    // Precordial leads get some correlated baseline but independent motion
    if (artifactParams.baseline > 0 || artifactParams.powerline > 0) {
      for (let i = 0; i < N; i++) {
        const bw = artifactParams.baseline * baselineNoise[i] * 0.7; // Less baseline in precordial
        const pl = artifactParams.powerline * powerlineNoise[i];
        phiMod.phiV1[i] += bw + pl;
        phiMod.phiV2[i] += bw + pl;
        phiMod.phiV3[i] += bw + pl;
        phiMod.phiV4[i] += bw + pl;
        phiMod.phiV5[i] += bw + pl;
        phiMod.phiV6[i] += bw + pl;
        phiMod.phiV3R[i] += bw + pl;
        phiMod.phiV4R[i] += bw + pl;
        phiMod.phiV7[i] += bw + pl;
      }
    }

    // EMG noise - independent per electrode but scaled appropriately
    const emgScale = artifactParams.emg || 0;
    if (emgScale > 0) {
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
  }

  // Derive leads from modified electrode potentials
  let leads = deriveLeads(phiMod);

  // Apply age-dependent lead-specific amplitude calibration (Rijnbeek 2001)
  const cal = getLeadCalibration(ageY);

  // Precordial leads: individual calibration per lead
  for (const name of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    if (leads[name] && cal[name]) {
      const factor = cal[name];
      for (let i = 0; i < leads[name].length; i++) {
        leads[name][i] *= factor;
      }
    }
  }

  // Limb leads I, II, III, aVR, aVL, aVF: use SAME factor to preserve:
  // - Einthoven's law: I + III = II
  // - Augmented lead derivations: aVL = I - II/2, aVF = II/2 + III, aVR = -(I+II)/2
  // Use II calibration as reference (most reliable Rijnbeek data)
  const limbFactor = cal.II;
  for (const name of ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']) {
    if (leads[name]) {
      for (let i = 0; i < leads[name].length; i++) {
        leads[name][i] *= limbFactor;
      }
    }
  }

  // Apply device filtering and processing
  if (enableFilters) {
    const leadNames = Object.keys(leads);
    const filterOrder = deviceParams.filterOrder || 2;

    for (const name of leadNames) {
      // 1. Bandpass filter (diagnostic or monitor bandwidth)
      leads[name] = applyBandpass(leads[name], fs, deviceParams.hpCutoff, deviceParams.lpCutoff, filterOrder);

      // 2. Notch filter for powerline interference (if enabled)
      if (deviceParams.notchFreq) {
        leads[name] = applyNotchFilter(leads[name], fs, deviceParams.notchFreq, 30);
      }

      // 3. ADC simulation (quantization + clipping)
      if (deviceParams.adcBits && deviceParams.adcRangeUV) {
        leads[name] = simulateADC(leads[name], deviceParams.adcBits, deviceParams.adcRangeUV);
      }

      // 4. Downsampling (if output rate differs from native)
      if (deviceParams.outputFs && deviceParams.outputFs < fs) {
        leads[name] = downsample(leads[name], fs, deviceParams.outputFs);
      }
    }
  }

  // Return leads along with effective sampling rate
  const outputFs = (enableFilters && deviceParams.outputFs) ? deviceParams.outputFs : fs;
  return { leads, fs: outputFs };
}

// ============================================================================
// INTEGRATED SYNTHESIS FUNCTION (using all modules)
// ============================================================================

export function synthECGModular(ageY, dx, seed, options = {}) {
  const {
    enableNoise = true,
    enableFilters = true,
    artifactParams = ARTIFACT_PRESETS.typical,
    deviceParams = DEVICE_PRESETS.diagnostic,
    electrodeGeometry = DEFAULT_ELECTRODE_GEOMETRY,
    sex = null,  // 'male', 'female', or null (unspecified)
  } = options;

  const fs = 1000;
  const duration = 10.0;
  const N = Math.floor(duration * fs);

  // Get parameters with sex-specific adjustments
  const base = ageDefaults(ageY, sex);
  const params = applyDx(base, dx);
  const RR = 60 / params.HR;
  const QT = params.QTc * Math.sqrt(RR);

  // Module 1: Rhythm (with age-appropriate HRV)
  const beatSchedule = rhythmModel(params, dx, duration, seed, ageY);

  // Module 2: Morphology
  const vcg = morphologyModel(beatSchedule, params, dx, fs, N, seed, ageY);

  // Module 3: Lead Field (with age-dependent heart orientation)
  const electrodePotentials = leadFieldModel(vcg, electrodeGeometry, { ageY, seed });

  // Module 5: Device and Artifact (includes deriving leads + amplitude calibration)
  const deviceResult = deviceAndArtifactModel(
    electrodePotentials,
    fs,
    seed,
    enableNoise ? artifactParams : ARTIFACT_PRESETS.none,
    deviceParams,
    enableNoise,
    enableFilters,
    ageY
  );

  // Handle both old format (just leads) and new format ({leads, fs})
  const leads = deviceResult.leads || deviceResult;
  const outputFs = deviceResult.fs || fs;
  const outputN = Math.floor(duration * outputFs);

  // Convert to Int16 (microvolts)
  function toUV(x) {
    const len = x.length;
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      let v = Math.round(x[i] * 1000.0);
      v = clamp(v, -32768, 32767);
      out[i] = v;
    }
    return out;
  }

  // Apply sex-specific voltage scaling (males have ~10% higher voltages)
  const voltageFactor = params.voltageFactor || 1.0;

  const leads_uV = {};
  for (const name of Object.keys(leads)) {
    // Apply voltage factor before conversion
    const scaled = new Float64Array(leads[name].length);
    for (let i = 0; i < leads[name].length; i++) {
      scaled[i] = leads[name][i] * voltageFactor;
    }
    leads_uV[name] = toUV(scaled);
  }

  return {
    schema_version: ECG_SCHEMA_VERSION,
    fs: outputFs,
    duration_s: duration,
    targets: {
      synthetic: true,
      generator_version: "2.3.0-calibrated",
      age_years: ageY,
      sex: sex || "unspecified",
      dx,
      HR_bpm: params.HR,
      PR_ms: Math.round(params.PR * 1000),
      QRS_ms: Math.round(params.QRS * 1000),
      QT_ms: Math.round(QT * 1000),
      QTc_ms: Math.round(params.QTc * 1000),
      axes_deg: { P: params.Paxis, QRS: params.QRSaxis, T: params.Taxis },
      hrv: beatSchedule.hrvMetrics,
      device_mode: deviceParams.description || "unknown",
    },
    leads_uV,
  };
}
