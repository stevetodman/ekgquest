// Shared ECG utilities: schema normalization, integrity checks, detection, and measurements.

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * @typedef {Object} LeadsUV
 * @property {Int16Array} I - Lead I signal in µV
 * @property {Int16Array} II - Lead II signal in µV
 * @property {Int16Array} III - Lead III signal in µV
 * @property {Int16Array} aVR - Augmented aVR signal in µV
 * @property {Int16Array} aVL - Augmented aVL signal in µV
 * @property {Int16Array} aVF - Augmented aVF signal in µV
 * @property {Int16Array} V1 - Precordial V1 signal in µV
 * @property {Int16Array} V2 - Precordial V2 signal in µV
 * @property {Int16Array} V3 - Precordial V3 signal in µV
 * @property {Int16Array} V4 - Precordial V4 signal in µV
 * @property {Int16Array} V5 - Precordial V5 signal in µV
 * @property {Int16Array} V6 - Precordial V6 signal in µV
 * @property {Int16Array} [V3R] - Right precordial V3R (optional)
 * @property {Int16Array} [V4R] - Right precordial V4R (optional)
 * @property {Int16Array} [V7] - Posterior V7 (optional)
 */

/**
 * @typedef {Object} ECGTargets
 * @property {number} HR_bpm - Heart rate in beats per minute
 * @property {number} PR_ms - PR interval in milliseconds
 * @property {number} QRS_ms - QRS duration in milliseconds
 * @property {number} QTc_ms - Corrected QT interval in milliseconds
 * @property {{P: number, QRS: number, T: number}} axes_deg - Axis angles in degrees
 * @property {{SDNN: number, RMSSD: number, pNN50: number}} hrv - HRV metrics
 * @property {boolean} synthetic - True if synthetically generated
 * @property {string} dx - Diagnosis string
 * @property {number} [ageY] - Age in years
 * @property {string} [sex] - Sex (male/female)
 */

/**
 * @typedef {Object} ECGIntegrity
 * @property {number} [einthoven_max_abs_error_uV] - Max Einthoven law error
 * @property {number} [avr_relation_max_abs_error_uV] - Max aVR relation error
 * @property {number} [avl_relation_max_abs_error_uV] - Max aVL relation error
 * @property {number} [avf_relation_max_abs_error_uV] - Max aVF relation error
 * @property {number} [augmented_sum_max_abs_error_uV] - Max augmented sum error
 */

/**
 * @typedef {Object} ECGMeta
 * @property {number} schema_version - Schema version (currently 1)
 * @property {number} fs - Sample rate in Hz
 * @property {number} duration_s - Duration in seconds
 * @property {LeadsUV} leads_uV - Lead signals in microvolts
 * @property {ECGTargets} targets - Ground truth targets
 * @property {ECGIntegrity} integrity - Physics integrity checks
 */

/**
 * @typedef {Object} ValidationResult
 * @property {string[]} errors - Critical errors
 * @property {string[]} warnings - Non-critical warnings
 */

/**
 * @typedef {Object} MedianBeat
 * @property {boolean} ok - Whether median beat was successfully computed
 * @property {string} [reason] - Failure reason if not ok
 * @property {number} [beatsUsed] - Number of beats used
 * @property {number} [rIdxMed] - R-peak index in median beat
 * @property {number} [fs] - Sample rate
 * @property {Object.<string, Float64Array>} [medianLeads_uV] - Median lead signals
 */

/**
 * @typedef {Object} MedianFiducials
 * @property {number} med_rIdx - R-peak index
 * @property {number} med_qOn - QRS onset index
 * @property {number} med_qOff - QRS offset index
 * @property {number|null} med_pOn - P-wave onset (null if not found)
 * @property {number|null} med_tEnd - T-wave end (null if not found)
 */

/**
 * @typedef {Object} GlobalMeasurements
 * @property {number|null} rr - Mean RR interval in seconds
 * @property {number|null} hr - Heart rate in bpm
 * @property {number|null} PR - PR interval in ms
 * @property {number|null} QRS - QRS duration in ms
 * @property {number|null} QT - QT interval in ms
 * @property {number|null} QTcB - Bazett-corrected QT in ms
 * @property {number|null} QTcF - Fridericia-corrected QT in ms
 * @property {number|null} QTcFram - Framingham-corrected QT in ms
 * @property {{pAxis: number|null, qAxis: number|null, tAxis: number|null}} axes - Axis measurements
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const ECG_SCHEMA_VERSION = 1;
const VIEWER_REQUIRED_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clamp a value between min and max
 * @param {number} x - Value to clamp
 * @param {number} a - Minimum value
 * @param {number} b - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} u - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export function lerp(a, b, u) {
  return a + (b - a) * u;
}

/**
 * Compute median of a small array (modifies array order)
 * @param {number[]} arr - Input array
 * @returns {number} Median value
 */
export function medianOfSmallArray(arr) {
  const copy = [...arr].sort((x, y) => x - y);
  return copy[(copy.length / 2) | 0];
}

/**
 * Compute median of a window in an array
 * @param {number[]|Int16Array|Float64Array} arr - Input array
 * @param {number} i0 - Start index
 * @param {number} i1 - End index
 * @returns {number} Median value in window
 */
export function medianWindow(arr, i0, i1) {
  const L = arr.length;
  i0 = clamp(i0 | 0, 0, L - 1);
  i1 = clamp(i1 | 0, 0, L - 1);
  if (i1 <= i0) return arr[i0] || 0;
  const tmp = [];
  for (let i = i0; i <= i1; i++) tmp.push(arr[i]);
  return medianOfSmallArray(tmp);
}

/**
 * Compute mean of an array, ignoring null/undefined values
 * @param {(number|null)[]} arr - Input array
 * @returns {number|null} Mean value or null if empty
 */
export function mean(arr) {
  if (!arr || arr.length === 0) return null;
  let s = 0;
  let n = 0;
  for (const v of arr) {
    if (v == null) continue;
    s += v;
    n++;
  }
  return n === 0 ? null : s / n;
}

/**
 * Convert array to Int16Array
 * @param {number[]|Int16Array} arr - Input array
 * @returns {Int16Array} Int16 typed array
 */
function toInt16(arr) {
  if (arr instanceof Int16Array) return arr;
  const out = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = Number.isFinite(arr[i]) ? arr[i] : 0;
    out[i] = v;
  }
  return out;
}

// ============================================================================
// SCHEMA NORMALIZATION
// ============================================================================

/**
 * Normalizes any raw ECG JSON object into the canonical schema.
 * Converts all lead arrays to Int16Array and validates structure.
 * @param {Object} raw - Raw ECG data (may have various formats)
 * @returns {ECGMeta} Normalized ECG data
 * @throws {Error} If required fields are missing or invalid
 */
export function normalizeECGData(raw) {
  if (!raw) throw new Error("ECG payload is empty");
  if (!raw.fs) throw new Error("ECG payload missing fs");

  const rawVersion = raw.schema_version ?? raw.schemaVersion ?? 0;
  let schema_version = Number(rawVersion);
  if (!Number.isFinite(schema_version) || schema_version <= 0) schema_version = ECG_SCHEMA_VERSION;
  if (schema_version !== ECG_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema_version ${schema_version} (expected ${ECG_SCHEMA_VERSION})`);
  }

  const leadsRaw = raw.leads_uV || raw.leads;
  if (!leadsRaw || Object.keys(leadsRaw).length === 0) {
    throw new Error("ECG payload missing leads");
  }

  const leadNames = Object.keys(leadsRaw);
  const leads_uV = {};
  const refLen = leadsRaw[leadNames[0]].length;
  for (const name of leadNames) {
    const arr = leadsRaw[name];
    if (!arr) throw new Error(`Lead ${name} missing samples`);
    if (arr.length !== refLen) {
      throw new Error(`Lead ${name} length ${arr.length} differs from ${refLen}`);
    }
    leads_uV[name] = toInt16(arr);
  }

  const fs = raw.fs;
  const duration_s = raw.duration_s ?? (refLen && fs ? refLen / fs : null);

  return {
    schema_version,
    fs,
    duration_s,
    leads_uV,
    targets: raw.targets || {},
    integrity: raw.integrity || {},
  };
}

/**
 * Validates ECG data structure and content.
 * @param {ECGMeta} meta - Normalized ECG data
 * @returns {ValidationResult} Validation errors and warnings
 */
export function validateECGData(meta) {
  const errors = [];
  const warnings = [];

  if (!meta) {
    errors.push("ECG meta is missing");
    return { errors, warnings };
  }
  if (meta.schema_version !== ECG_SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version ${meta.schema_version}`);
  }
  if (!Number.isFinite(meta.fs) || meta.fs <= 0) errors.push("Invalid fs");
  if (!meta.leads_uV || typeof meta.leads_uV !== "object") errors.push("Missing leads_uV");

  const leadNames = meta.leads_uV ? Object.keys(meta.leads_uV) : [];
  if (leadNames.length === 0) errors.push("No leads present");
  if (meta.leads_uV && !meta.leads_uV.II) warnings.push("Missing lead II (limits R-peak detection)");

  if (Number.isFinite(meta.duration_s) && meta.duration_s <= 0) warnings.push("Non-positive duration_s");
  if (meta.fs && meta.leads_uV && meta.leads_uV.I) {
    const inferred = meta.leads_uV.I.length / meta.fs;
    if (meta.duration_s != null && Math.abs(meta.duration_s - inferred) > 0.05) {
      warnings.push("duration_s does not match sample count");
    }
  }

  const limbRequired = ["I", "II", "III", "aVR", "aVL", "aVF"];
  const missingLimb = limbRequired.filter((k) => !meta.leads_uV || !meta.leads_uV[k]);
  if (missingLimb.length) warnings.push(`Missing limb leads: ${missingLimb.join(", ")}`);

  const missingViewerLeads = VIEWER_REQUIRED_LEADS.filter((k) => !meta.leads_uV || !meta.leads_uV[k]);
  if (missingViewerLeads.length) warnings.push(`Missing leads (viewer): ${missingViewerLeads.join(", ")}`);

  const syntheticFlag = meta.targets ? meta.targets.synthetic : undefined;
  if (syntheticFlag !== true && syntheticFlag !== false) warnings.push("targets.synthetic missing (boolean required)");

  return { errors, warnings };
}

/**
 * Fetch ECG data from a URL and normalize it.
 * @param {string} url - URL to fetch ECG JSON from
 * @returns {Promise<ECGMeta>} Normalized ECG data with integrity checks
 * @throws {Error} If fetch fails or data is invalid
 */
export async function fetchECG(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  const raw = await res.json();
  const meta = normalizeECGData(raw);
  meta.integrity = { ...physicsChecks(meta.leads_uV), ...meta.integrity };
  return meta;
}

// ============================================================================
// PHYSICS INTEGRITY CHECKS
// ============================================================================

/**
 * Verify Einthoven's law and augmented lead relationships.
 * Einthoven: II = I + III (within tolerance)
 * Augmented: aVR + aVL + aVF = 0 (within tolerance)
 * @param {LeadsUV} L - Lead signals
 * @returns {ECGIntegrity} Maximum errors in µV
 */
export function physicsChecks(L) {
  const required = ["I", "II", "III", "aVR", "aVL", "aVF"];
  const missing = required.filter((k) => !L || !L[k]);
  if (missing.length) return { missing_leads: missing };

  const n = L.I.length;
  let maxE = 0,
    maxAVR = 0,
    maxAVL = 0,
    maxAVF = 0,
    maxSum = 0;
  for (let i = 0; i < n; i++) {
    const I = L.I[i],
      II = L.II[i],
      III = L.III[i];
    const aVR = L.aVR[i],
      aVL = L.aVL[i],
      aVF = L.aVF[i];
    const e = Math.abs(I + III - II);
    if (e > maxE) maxE = e;
    const avr = Math.abs(aVR - (-(I + II) / 2));
    const avl = Math.abs(aVL - (I - II / 2));
    const avf = Math.abs(aVF - (II - I / 2));
    const s = Math.abs(aVR + aVL + aVF);
    if (avr > maxAVR) maxAVR = avr;
    if (avl > maxAVL) maxAVL = avl;
    if (avf > maxAVF) maxAVF = avf;
    if (s > maxSum) maxSum = s;
  }
  return {
    einthoven_max_abs_error_uV: Math.round(maxE),
    avr_relation_max_abs_error_uV: Math.round(maxAVR),
    avl_relation_max_abs_error_uV: Math.round(maxAVL),
    avf_relation_max_abs_error_uV: Math.round(maxAVF),
    augmented_sum_max_abs_error_uV: Math.round(maxSum),
  };
}

// Single-lead derivative + MWA-based R-peak detection
// preferPositive: if true, prefer positive peaks (R-wave) over negative (S-wave)
function detectRPeaksSingleLead(signal, fs, threshold = 0.35, preferPositive = true) {
  const n = signal.length;
  if (n < 10) return [];

  // Squared derivative
  const sq = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = signal[i] - signal[i - 1];
    sq[i] = d * d;
  }

  // Moving window average
  const win = Math.max(1, Math.floor(0.08 * fs));
  const mwa = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += sq[i];
    if (i >= win) s -= sq[i - win];
    mwa[i] = s / win;
  }

  // Find threshold
  let maxM = 0;
  for (let i = 0; i < n; i++) if (mwa[i] > maxM) maxM = mwa[i];
  const thr = threshold * maxM;
  const refractory = Math.floor(0.25 * fs);

  // Detect peaks
  const peaks = [];
  let i = win;
  while (i < n - 2) {
    if (mwa[i] > thr && mwa[i] > mwa[i - 1] && mwa[i] >= mwa[i + 1]) {
      // Refine to actual signal peak - look for R-wave (positive) or S-wave (negative)
      const L = Math.max(0, i - Math.floor(0.05 * fs));
      const R = Math.min(n - 1, i + Math.floor(0.05 * fs));

      // Find both positive max and negative min in the window
      let posMax = -Infinity, posPeak = i;
      let negMin = Infinity, negPeak = i;
      for (let k = L; k <= R; k++) {
        if (signal[k] > posMax) { posMax = signal[k]; posPeak = k; }
        if (signal[k] < negMin) { negMin = signal[k]; negPeak = k; }
      }

      // Choose the peak: prefer positive (R-wave) if it's significant,
      // otherwise use the largest absolute deflection
      let r;
      if (preferPositive && posMax > 0 && posMax >= Math.abs(negMin) * 0.3) {
        // Use positive peak if it's at least 30% of the negative deflection
        r = posPeak;
      } else if (!preferPositive && negMin < 0 && Math.abs(negMin) >= posMax * 0.3) {
        // Use negative peak if requested and significant
        r = negPeak;
      } else {
        // Fallback: use largest absolute deflection
        r = Math.abs(posMax) >= Math.abs(negMin) ? posPeak : negPeak;
      }

      if (peaks.length === 0 || r - peaks[peaks.length - 1] > Math.floor(0.3 * fs)) {
        peaks.push(r);
      }
      i = r + refractory;
    } else i++;
  }

  return peaks;
}

// Multi-lead R-peak detection with consensus voting
// Uses multiple leads for robustness, especially for arrhythmias
export function detectRPeaks(meta) {
  const fs = meta.fs;
  const leads = meta.leads_uV;
  if (!leads) return [];

  // Priority order for R-peak detection (best leads first)
  // II, aVF, I are typically positive; V1-V2 have large deflections
  const leadPriority = ['II', 'aVF', 'I', 'V2', 'V1', 'V3', 'III', 'V4', 'V5', 'V6'];
  const availableLeads = leadPriority.filter(l => leads[l] && leads[l].length > 0);

  if (availableLeads.length === 0) return [];

  const n = leads[availableLeads[0]].length;

  // Detect peaks in each available lead
  const allPeakSets = [];
  for (const leadName of availableLeads.slice(0, 4)) { // Use up to 4 leads
    const signal = leads[leadName];
    const peaks = detectRPeaksSingleLead(signal, fs, 0.30);
    if (peaks.length > 0) {
      allPeakSets.push({ lead: leadName, peaks });
    }
  }

  if (allPeakSets.length === 0) return [];

  // If only one lead available, use it directly
  if (allPeakSets.length === 1) {
    return applyHRFallback(allPeakSets[0].peaks, meta, n, fs);
  }

  // Consensus: merge peaks from all leads
  // A peak is confirmed if detected in multiple leads within a small window
  const tolerance = Math.floor(0.04 * fs); // 40ms tolerance
  const candidatePeaks = new Map(); // index -> vote count

  for (const { peaks } of allPeakSets) {
    for (const p of peaks) {
      // Find or create a candidate near this peak
      let found = false;
      for (const [idx, count] of candidatePeaks) {
        if (Math.abs(idx - p) <= tolerance) {
          // Vote for existing candidate (use average position)
          const newIdx = Math.round((idx * count + p) / (count + 1));
          candidatePeaks.delete(idx);
          candidatePeaks.set(newIdx, count + 1);
          found = true;
          break;
        }
      }
      if (!found) {
        candidatePeaks.set(p, 1);
      }
    }
  }

  // Accept peaks with at least 2 votes (or 1 if only 1-2 leads available)
  const minVotes = allPeakSets.length <= 2 ? 1 : 2;
  let consensusPeaks = [];
  for (const [idx, count] of candidatePeaks) {
    if (count >= minVotes) {
      consensusPeaks.push(idx);
    }
  }
  consensusPeaks.sort((a, b) => a - b);

  // Remove peaks that are too close together
  const minGap = Math.floor(0.25 * fs);
  const filtered = [];
  for (const p of consensusPeaks) {
    if (filtered.length === 0 || p - filtered[filtered.length - 1] > minGap) {
      filtered.push(p);
    }
  }

  return applyHRFallback(filtered, meta, n, fs);
}

// Fallback: if we know the target HR but detected too few beats, seed peaks
function applyHRFallback(rPeaks, meta, n, fs) {
  const targetHR = meta.targets && meta.targets.HR_bpm;
  const primaryLead = meta.leads_uV.II || meta.leads_uV.I || meta.leads_uV.V2;

  if (!targetHR || !primaryLead) return rPeaks;

  const expectedBeats = Math.floor((n / fs) * (targetHR / 60) * 0.9);
  if (rPeaks.length >= Math.max(3, expectedBeats)) return rPeaks;

  const expectedRR = Math.max(0.3, 60 / targetHR) * fs;
  const minGap = Math.max(0.2 * fs, expectedRR * 0.45);

  for (let start = 0; start < n; start += expectedRR) {
    const w = Math.min(n - 1, Math.floor(start + expectedRR * 0.8));
    let bestIdx = null, bestAmp = 0;
    for (let k = Math.floor(Math.max(0, start - expectedRR * 0.2)); k <= w; k++) {
      const a = Math.abs(primaryLead[k]);
      if (a > bestAmp) { bestAmp = a; bestIdx = k; }
    }
    if (bestIdx != null) {
      let pos = 0;
      while (pos < rPeaks.length && rPeaks[pos] < bestIdx) pos++;
      const leftDiff = pos > 0 ? bestIdx - rPeaks[pos - 1] : Infinity;
      const rightDiff = pos < rPeaks.length ? rPeaks[pos] - bestIdx : Infinity;
      if (leftDiff >= minGap && rightDiff >= minGap) {
        rPeaks.splice(pos, 0, bestIdx);
      }
    }
  }

  return rPeaks;
}

export function buildMedianBeat(meta, rPeaks, preSec = 0.25, postSec = 0.55) {
  const fs = meta.fs;
  const pre = Math.floor(preSec * fs);
  const post = Math.floor(postSec * fs);
  const L = pre + post + 1;

  const leads = Object.keys(meta.leads_uV);
  const segments = {};
  for (const lead of leads) segments[lead] = [];

  const validR = [];
  for (const r of rPeaks) {
    const s0 = r - pre;
    const s1 = r + post;
    if (s0 < 0 || s1 >= meta.leads_uV.II.length) continue;
    validR.push(r);
    for (const lead of leads) {
      const seg = meta.leads_uV[lead].slice(s0, s1 + 1);
      segments[lead].push(seg);
    }
  }

  const nb = validR.length;
  if (nb < 3) {
    return { ok: false, reason: "Not enough clean beats for median", beatsUsed: nb };
  }

  const medianLeads = {};
  for (const lead of leads) {
    const segs = segments[lead];
    const med = new Int16Array(L);
    const tmp = new Array(nb);
    for (let j = 0; j < L; j++) {
      for (let b = 0; b < nb; b++) tmp[b] = segs[b][j];
      tmp.sort((a, b) => a - b);
      med[j] = tmp[(nb / 2) | 0];
    }
    medianLeads[lead] = med;
  }

  const center = pre;
  const medII = medianLeads.II;
  const w = Math.floor(0.02 * fs);
  let rIdx = center,
    best = -1;
  for (let i = center - w; i <= center + w; i++) {
    if (i < 0 || i >= L) continue;
    const a = Math.abs(medII[i]);
    if (a > best) {
      best = a;
      rIdx = i;
    }
  }

  return {
    ok: true,
    fs,
    pre,
    post,
    L,
    center,
    rIdxMed: rIdx,
    beatsUsed: nb,
    validRPeaks: validR,
    medianLeads_uV: medianLeads,
    targetQRS_ms: meta.targets && meta.targets.QRS_ms ? meta.targets.QRS_ms : null,
  };
}

export function fiducialsFromMedian(medBeat, rrMeanSec) {
  const fs = medBeat.fs;
  const x = medBeat.medianLeads_uV.II;
  const L = x.length;
  const r = medBeat.rIdxMed;

  const b0 = r - Math.floor(0.22 * fs);
  const b1 = r - Math.floor(0.18 * fs);
  const base = medianWindow(x, b0, b1);

  const amp = Math.abs(x[r] - base);
  const targetQrs = medBeat.targetQRS_ms ? (medBeat.targetQRS_ms / 1000) * fs : null;
  const minQrs = targetQrs ? Math.max(Math.floor(0.6 * targetQrs), Math.floor(0.035 * fs)) : Math.floor(0.1 * fs);
  const maxQrs = targetQrs ? Math.min(Math.floor(1.6 * targetQrs), Math.floor(0.18 * fs)) : Math.floor(0.16 * fs);
  const preWin = Math.floor((targetQrs ? 0.12 : 0.16) * fs);
  const postWin = Math.floor((targetQrs ? 0.12 : 0.16) * fs);
  const slopeCons = Math.max(2, Math.floor(0.004 * fs));

  // Slope-based onset/offset: find where slope falls back to baseline around R
  let maxSlope = 0;
  for (let i = Math.max(1, r - preWin); i <= Math.min(L - 2, r + postWin); i++) {
    const s = Math.abs(x[i + 1] - x[i]);
    if (s > maxSlope) maxSlope = s;
  }
  const slopeThr = (targetQrs ? 0.08 : 0.035) * maxSlope;

  let qOn = Math.max(0, r - Math.floor(0.05 * fs));
  let seenHigh = false;
  let lowCount = 0;
  for (let i = r; i > Math.max(1, r - preWin); i--) {
    const s = Math.abs(x[i] - x[i - 1]);
    if (s > slopeThr) {
      seenHigh = true;
      lowCount = 0;
    } else if (seenHigh) {
      lowCount++;
      if (lowCount >= slopeCons) {
        qOn = i;
        break;
      }
    }
  }

  let qOff = Math.min(L - 1, r + Math.floor(0.06 * fs));
  seenHigh = false;
  lowCount = 0;
  for (let i = r; i < Math.min(L - 2, r + postWin); i++) {
    const s = Math.abs(x[i + 1] - x[i]);
    if (s > slopeThr) {
      seenHigh = true;
      lowCount = 0;
    } else if (seenHigh) {
      lowCount++;
      if (lowCount >= slopeCons) {
        qOff = i;
        break;
      }
    }
  }

  // Enforce plausible QRS width window
  let width = qOff - qOn;
  if (width < minQrs) {
    const center = r;
    qOn = clamp(center - Math.floor(minQrs * 0.5), 0, L - 1);
    qOff = clamp(qOn + minQrs, 0, L - 1);
  } else if (width > maxQrs) {
    const center = Math.floor((qOn + qOff) / 2);
    qOn = clamp(center - Math.floor(maxQrs / 2), 0, L - 1);
    qOff = clamp(qOn + maxQrs, 0, L - 1);
  }

  let count = 0;
  const pL = Math.max(0, qOn - Math.floor(0.2 * fs));
  const pR = Math.max(0, qOn - Math.floor(0.04 * fs));
  let pOn = null;
  if (pR > pL + 10) {
    const pBase = medianWindow(x, qOn - Math.floor(0.26 * fs), qOn - Math.floor(0.22 * fs));
    let peakAmp = 0,
      peakIdx = null;
    for (let i = pL; i <= pR; i++) {
      const a = Math.abs(x[i] - pBase);
      if (a > peakAmp) {
        peakAmp = a;
        peakIdx = i;
      }
    }
    if (peakAmp >= 25) {
      const thrP = Math.max(15, 0.1 * peakAmp);
      count = 0;
      let pon = pL;
      for (let i = peakIdx; i >= pL; i--) {
        if (Math.abs(x[i] - pBase) < thrP) count++;
        else count = 0;
        if (count >= Math.floor(0.008 * fs)) {
          pon = i + count;
          break;
        }
      }
      pOn = pon;
    }
  }

  const rr = rrMeanSec || 0.6;
  const tL = Math.min(L - 1, qOff + Math.floor(0.06 * fs));
  const tR = Math.min(L - 1, qOn + Math.floor(Math.min(0.8 * rr, 0.6) * fs));
  let tEnd = null;
  if (tR > tL + 30) {
    let peakAmp = 0,
      peakIdx = null;
    for (let i = tL; i <= tR; i++) {
      const a = Math.abs(x[i] - base);
      if (a > peakAmp) {
        peakAmp = a;
        peakIdx = i;
      }
    }
    if (peakAmp >= 40) {
      const thrT = Math.max(20, 0.1 * peakAmp);
      count = 0;
      let tend = tR;
      for (let i = peakIdx; i <= tR; i++) {
        if (Math.abs(x[i] - base) < thrT) count++;
        else count = 0;
        if (count >= Math.floor(0.02 * fs)) {
          tend = i - count;
          break;
        }
      }
      tEnd = tend;
    }
  }

  const rel = (idx) => (idx == null ? null : idx - r);
  return {
    med_base_uV: base,
    med_rIdx: r,
    med_qOn: qOn,
    med_qOff: qOff,
    med_pOn: pOn,
    med_tEnd: tEnd,
    rel_qOn: rel(qOn),
    rel_qOff: rel(qOff),
    rel_pOn: rel(pOn),
    rel_tEnd: rel(tEnd),
  };
}

export function buildFullFiducialsFromMedian(meta, rPeaks, medFids) {
  const fs = meta.fs;
  const n = meta.leads_uV.II.length;
  const qOn = [],
    qOff = [],
    pOn = [],
    tEnd = [];
  for (const r of rPeaks) {
    const on = medFids.rel_qOn == null ? null : clamp(r + medFids.rel_qOn, 0, n - 1);
    const off = medFids.rel_qOff == null ? null : clamp(r + medFids.rel_qOff, 0, n - 1);
    const pon = medFids.rel_pOn == null ? null : clamp(r + medFids.rel_pOn, 0, n - 1);
    const tend = medFids.rel_tEnd == null ? null : clamp(r + medFids.rel_tEnd, 0, n - 1);
    qOn.push(on);
    qOff.push(off);
    pOn.push(pon);
    tEnd.push(tend);
  }
  return { rPeaks, qOn, qOff, pOn, tEnd };
}

export function computeAxesFromMedian(medBeat, medFids) {
  const fs = medBeat.fs;
  const I = medBeat.medianLeads_uV.I;
  const aVF = medBeat.medianLeads_uV.aVF;

  const r = medFids.med_rIdx;
  const qOn = medFids.med_qOn,
    qOff = medFids.med_qOff;
  const pOn = medFids.med_pOn,
    tEnd = medFids.med_tEnd;

  const baseI = medianWindow(I, r - Math.floor(0.22 * fs), r - Math.floor(0.18 * fs));
  const baseF = medianWindow(aVF, r - Math.floor(0.22 * fs), r - Math.floor(0.18 * fs));

  function area(arr, b, e, base) {
    b = clamp(b, 0, arr.length - 1);
    e = clamp(e, 0, arr.length - 1);
    if (e <= b) return 0;
    let s = 0;
    for (let i = b; i <= e; i++) s += arr[i] - base;
    return s;
  }

  const qAreaI = area(I, qOn, qOff, baseI);
  const qAreaF = area(aVF, qOn, qOff, baseF);

  let pAreaI = 0,
    pAreaF = 0;
  if (pOn != null) {
    const pEnd = Math.max(pOn, qOn - Math.floor(0.04 * fs));
    pAreaI = area(I, pOn, pEnd, baseI);
    pAreaF = area(aVF, pOn, pEnd, baseF);
  }

  let tAreaI = 0,
    tAreaF = 0;
  if (tEnd != null) {
    const tStart = qOff + Math.floor(0.06 * fs);
    tAreaI = area(I, tStart, tEnd, baseI);
    tAreaF = area(aVF, tStart, tEnd, baseF);
  }

  function axisFromAreas(ax, ay) {
    if (ax === 0 && ay === 0) return null;
    let ang = (Math.atan2(ay, ax) * 180) / Math.PI;
    if (ang > 180) ang -= 360;
    if (ang <= -180) ang += 360;
    return ang;
  }
  return {
    pAxis: axisFromAreas(pAreaI, pAreaF),
    qAxis: axisFromAreas(qAreaI, qAreaF),
    tAxis: axisFromAreas(tAreaI, tAreaF),
  };
}

export function computeGlobalMeasurements(meta, rPeaks, medBeat, medFids) {
  const fs = meta.fs;

  let rr = null,
    hr = null;
  if (rPeaks.length >= 2) {
    const rrs = [];
    for (let i = 1; i < rPeaks.length; i++) rrs.push((rPeaks[i] - rPeaks[i - 1]) / fs);
    rr = mean(rrs);
    hr = 60 / rr;
  }

  let PR = null,
    QRS = null,
    QT = null;
  if (medBeat && medBeat.ok && medFids) {
    if (medFids.med_pOn != null) PR = ((medFids.med_qOn - medFids.med_pOn) / fs) * 1000;
    QRS = ((medFids.med_qOff - medFids.med_qOn) / fs) * 1000;
    if (medFids.med_tEnd != null) QT = ((medFids.med_tEnd - medFids.med_qOn) / fs) * 1000;
  }

  let QTcB = null,
    QTcF = null,
    QTcFram = null;
  if (rr != null && QT != null) {
    const QTsec = QT / 1000;
    QTcB = (QTsec / Math.sqrt(rr)) * 1000;
    QTcF = (QTsec / Math.cbrt(rr)) * 1000;
    QTcFram = (QTsec + 0.154 * (1 - rr)) * 1000;
  }

  let axes = { pAxis: null, qAxis: null, tAxis: null };
  if (medBeat && medBeat.ok && medFids) {
    axes = computeAxesFromMedian(medBeat, medFids);
  }

  return { rr, hr, PR, QRS, QT, QTcB, QTcF, QTcFram, axes };
}

export function fmtMs(x) {
  return x == null || !isFinite(x) ? "—" : `${Math.round(x)} ms`;
}

export function fmtBpm(x) {
  return x == null || !isFinite(x) ? "—" : `${Math.round(x)} bpm`;
}

export function fmtDeg(x) {
  return x == null || !isFinite(x) ? "—" : `${Math.round(x)}°`;
}
