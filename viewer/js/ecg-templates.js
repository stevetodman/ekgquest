/**
 * ECG Template Engine
 *
 * Provides template-based waveform generation as an alternative to parametric
 * Gaussian pulses. Templates are real waveform shapes that can be warped and
 * scaled to produce more realistic morphology with natural variations.
 *
 * Architecture:
 * - Templates stored as normalized samples (amplitude -1 to 1, fs=500Hz)
 * - Selected based on diagnosis and weighted randomization
 * - Warped to target duration via cubic interpolation
 * - Scaled to target amplitude with age/beat-to-beat variation
 */

// Feature flag - set to false to use parametric generation (default)
export const USE_TEMPLATES = false;

// Template library - will be populated from JSON or inline data
let TEMPLATE_LIBRARY = null;
let libraryLoadPromise = null;
let recentlyUsed = new Set();
const MAX_RECENT = 10;

/**
 * Load template library from JSON file or use embedded templates
 */
export async function loadTemplateLibrary(jsonPath = null) {
  if (TEMPLATE_LIBRARY) return TEMPLATE_LIBRARY;

  if (libraryLoadPromise) return libraryLoadPromise;

  libraryLoadPromise = (async () => {
    if (jsonPath) {
      try {
        const response = await fetch(jsonPath);
        if (response.ok) {
          TEMPLATE_LIBRARY = await response.json();
          return TEMPLATE_LIBRARY;
        }
      } catch (e) {
        console.warn('Failed to load template library from JSON, using embedded templates:', e);
      }
    }

    // Fallback to embedded templates
    TEMPLATE_LIBRARY = getEmbeddedTemplates();
    return TEMPLATE_LIBRARY;
  })();

  return libraryLoadPromise;
}

/**
 * Get loaded library (sync, returns null if not loaded)
 */
export function getTemplateLibrary() {
  return TEMPLATE_LIBRARY;
}

/**
 * Check if templates are available
 */
export function templatesReady() {
  return TEMPLATE_LIBRARY !== null && USE_TEMPLATES;
}

/**
 * Select a template from the library
 * @param {string} category - 'qrs', 'p', or 't'
 * @param {string} diagnosis - diagnosis name or 'normal'
 * @param {object} options - { age, rng }
 * @returns {object} template with samples, duration_ms, fs
 */
export function selectTemplate(category, diagnosis, options = {}) {
  const { age = 8, rng = Math.random } = options;

  if (!TEMPLATE_LIBRARY) {
    console.warn('Template library not loaded');
    return null;
  }

  const categoryKey = `${category}_templates`;
  const categoryData = TEMPLATE_LIBRARY[categoryKey];

  if (!categoryData) {
    console.warn(`No templates for category: ${category}`);
    return null;
  }

  // Map diagnosis to template group
  const group = getTemplateGroup(category, diagnosis);
  const templates = categoryData[group] || categoryData.normal;

  if (!templates || templates.length === 0) {
    console.warn(`No templates for ${category}/${group}`);
    return null;
  }

  // Weighted random selection
  const weights = templates.map((t, i) => {
    let w = 1.0;

    // Penalize recently used templates
    if (recentlyUsed.has(t.id)) {
      w *= 0.3;
    }

    // Prefer pediatric templates for young ages
    if (age < 1 && t.metadata?.pediatric) {
      w *= 2.0;
    }

    // Prefer adult templates for older ages
    if (age > 18 && t.metadata?.adult) {
      w *= 1.5;
    }

    return w;
  });

  const template = weightedRandomChoice(templates, weights, rng);

  // Track recent usage
  if (template) {
    recentlyUsed.add(template.id);
    if (recentlyUsed.size > MAX_RECENT) {
      const first = recentlyUsed.values().next().value;
      recentlyUsed.delete(first);
    }
  }

  return template;
}

/**
 * Map diagnosis to template group
 */
function getTemplateGroup(category, diagnosis) {
  const dx = (diagnosis || '').toLowerCase();

  if (category === 'qrs') {
    if (dx.includes('rbbb')) return 'rbbb';
    if (dx.includes('lbbb')) return 'lbbb';
    if (dx.includes('lvh')) return 'lvh';
    if (dx.includes('rvh')) return 'rvh';
    if (dx.includes('wpw')) return 'wpw';
    if (dx.includes('pvc')) return 'pvc';
    if (dx.includes('lafb')) return 'lafb';
    return 'normal';
  }

  if (category === 'p') {
    if (dx.includes('flutter')) return 'flutter';
    if (dx.includes('avb') || dx.includes('block')) return 'normal';
    if (dx.includes('rae') || dx.includes('pulmonale')) return 'peaked';
    if (dx.includes('lae') || dx.includes('mitrale')) return 'bifid';
    return 'normal';
  }

  if (category === 't') {
    if (dx.includes('hyperkalemia')) return 'peaked';
    if (dx.includes('ischemia')) return 'inverted';
    if (dx.includes('lvh') || dx.includes('rvh')) return 'strain';
    return 'normal';
  }

  return 'normal';
}

/**
 * Weighted random selection
 */
function weightedRandomChoice(items, weights, rng) {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * totalWeight;

  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }

  return items[items.length - 1];
}

/**
 * Warp template to target duration using cubic interpolation
 * @param {object} template - template with samples, duration_ms, fs
 * @param {number} targetDurationMs - desired duration in ms
 * @param {number} targetFs - target sample rate
 * @param {function} rng - random number generator
 * @returns {Float64Array} warped samples
 */
export function warpTemplate(template, targetDurationMs, targetFs, rng = Math.random) {
  const { samples, duration_ms: sourceDurationMs, fs: sourceFs } = template;

  // Add subtle duration jitter (±5%)
  const jitter = 1.0 + 0.05 * (rng() * 2 - 1);
  const ratio = (targetDurationMs / sourceDurationMs) * jitter;

  // Calculate output length
  const sourceLen = samples.length;
  const targetLen = Math.round(targetDurationMs * targetFs / 1000);

  // Resample with cubic interpolation
  const output = new Float64Array(targetLen);

  for (let i = 0; i < targetLen; i++) {
    // Map target index to source position
    const srcPos = (i / targetLen) * sourceLen;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    // Get 4 surrounding points for cubic interpolation
    const p0 = samples[Math.max(0, srcIdx - 1)];
    const p1 = samples[srcIdx];
    const p2 = samples[Math.min(sourceLen - 1, srcIdx + 1)];
    const p3 = samples[Math.min(sourceLen - 1, srcIdx + 2)];

    // Catmull-Rom spline interpolation
    output[i] = cubicInterpolate(p0, p1, p2, p3, frac);
  }

  return output;
}

/**
 * Catmull-Rom cubic interpolation
 */
function cubicInterpolate(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;

  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Scale template amplitude
 * @param {Float64Array} samples - waveform samples
 * @param {number} targetAmplitude - desired peak amplitude (mV)
 * @param {number} age - patient age in years
 * @param {function} rng - random number generator
 * @returns {Float64Array} scaled samples
 */
export function scaleTemplate(samples, targetAmplitude, age = 8, rng = Math.random) {
  // Find current peak amplitude
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(samples[i]));
  }

  if (maxAbs === 0) return samples;

  const baseRatio = targetAmplitude / maxAbs;

  // Age-dependent amplitude variation (children have higher relative amplitudes)
  const ageVar = age < 1 ? 1.2 : (age < 5 ? 1.1 : 1.0);

  // Beat-to-beat variation (±5%)
  const beatVar = 1.0 + 0.05 * (rng() * 2 - 1);

  const finalScale = baseRatio * ageVar * beatVar;

  const output = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    output[i] = samples[i] * finalScale;
  }

  return output;
}

/**
 * Add micro-variations to template for realism
 * @param {Float64Array} samples - waveform samples
 * @param {number} intensity - variation intensity (0-1)
 * @param {function} rng - random number generator
 * @returns {Float64Array} modified samples
 */
export function addMicroVariations(samples, intensity = 0.02, rng = Math.random) {
  const output = new Float64Array(samples.length);

  // Low-frequency variation (baseline wander component)
  const lowFreq = 0.5 + rng() * 0.5;

  for (let i = 0; i < samples.length; i++) {
    // High-frequency noise
    const hfNoise = (rng() * 2 - 1) * intensity * 0.3;

    // Low-frequency drift
    const lfDrift = Math.sin(i * lowFreq / samples.length * Math.PI * 2) * intensity * 0.5;

    output[i] = samples[i] * (1 + hfNoise + lfDrift);
  }

  return output;
}

/**
 * Get complete waveform from template with all transformations
 * @param {string} category - 'qrs', 'p', or 't'
 * @param {string} diagnosis - diagnosis name
 * @param {object} params - { targetDurationMs, targetAmplitude, targetFs, age }
 * @param {function} rng - random number generator
 * @returns {Float64Array|null} processed waveform or null
 */
export function getTemplateWaveform(category, diagnosis, params, rng = Math.random) {
  const {
    targetDurationMs,
    targetAmplitude,
    targetFs = 500,
    age = 8
  } = params;

  const template = selectTemplate(category, diagnosis, { age, rng });
  if (!template) return null;

  // Warp to target duration
  let waveform = warpTemplate(template, targetDurationMs, targetFs, rng);

  // Scale to target amplitude
  waveform = scaleTemplate(waveform, targetAmplitude, age, rng);

  // Add micro-variations for realism
  waveform = addMicroVariations(waveform, 0.015, rng);

  return waveform;
}

/**
 * Project template onto VCG axes
 * Templates are stored as scalar waveforms - this projects them onto the
 * 3D vector cardiogram space using direction vectors
 * @param {Float64Array} waveform - 1D waveform
 * @param {Array} direction - [x, y, z] direction vector
 * @returns {object} { Vx, Vy, Vz } components
 */
export function projectToVCG(waveform, direction) {
  const [dx, dy, dz] = direction;
  const len = waveform.length;

  const Vx = new Float64Array(len);
  const Vy = new Float64Array(len);
  const Vz = new Float64Array(len);

  for (let i = 0; i < len; i++) {
    Vx[i] = waveform[i] * dx;
    Vy[i] = waveform[i] * dy;
    Vz[i] = waveform[i] * dz;
  }

  return { Vx, Vy, Vz };
}

/**
 * Add template waveform to existing VCG arrays at specified position
 * @param {Float64Array} targetVx - target Vx array
 * @param {Float64Array} targetVy - target Vy array
 * @param {Float64Array} targetVz - target Vz array
 * @param {Float64Array} waveform - template waveform
 * @param {Array} direction - [x, y, z] direction vector
 * @param {number} startSample - starting sample index
 * @param {number} fs - sample rate
 */
export function addTemplateToVCG(targetVx, targetVy, targetVz, waveform, direction, startSample, fs) {
  const [dx, dy, dz] = direction;
  const len = waveform.length;
  const N = targetVx.length;

  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= 0 && idx < N) {
      targetVx[idx] += waveform[i] * dx;
      targetVy[idx] += waveform[i] * dy;
      targetVz[idx] += waveform[i] * dz;
    }
  }
}

/**
 * Embedded templates for fallback when JSON not available
 * These are carefully crafted to have realistic characteristics
 */
function getEmbeddedTemplates() {
  return {
    version: "1.0",
    source: "Embedded synthetic templates with realistic morphology",

    qrs_templates: {
      normal: [
        createNormalQRSTemplate(1, 0),
        createNormalQRSTemplate(2, 0.1),
        createNormalQRSTemplate(3, -0.05),
        createNormalQRSTemplate(4, 0.08),
        createNormalQRSTemplate(5, -0.03),
      ],
      rbbb: [
        createRBBBTemplate(1),
        createRBBBTemplate(2),
      ],
      lbbb: [
        createLBBBTemplate(1),
        createLBBBTemplate(2),
      ],
      lvh: [
        createLVHTemplate(1),
        createLVHTemplate(2),
      ],
      pvc: [
        createPVCTemplate(1),
        createPVCTemplate(2),
      ],
    },

    p_templates: {
      normal: [
        createNormalPTemplate(1),
        createNormalPTemplate(2),
        createNormalPTemplate(3),
      ],
      peaked: [
        createPeakedPTemplate(1),
      ],
      bifid: [
        createBifidPTemplate(1),
      ],
    },

    t_templates: {
      normal: [
        createNormalTTemplate(1),
        createNormalTTemplate(2),
        createNormalTTemplate(3),
      ],
      inverted: [
        createInvertedTTemplate(1),
      ],
      peaked: [
        createPeakedTTemplate(1),
      ],
    },
  };
}

// Template creation helpers - generate realistic waveform shapes
// These use multiple Gaussians with added irregularities

function createNormalQRSTemplate(id, variation = 0) {
  // ~100ms QRS at 500Hz = 50 samples
  const fs = 500;
  const duration_ms = 100;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Q wave (small negative)
  addGaussianToArray(samples, 10, 3, -0.15 + variation * 0.05);

  // R wave (large positive) with subtle notch
  addGaussianToArray(samples, 22, 5, 1.0 + variation * 0.1);
  addGaussianToArray(samples, 26, 2, -0.08 * (1 + variation)); // Micro-notch

  // S wave (moderate negative)
  addGaussianToArray(samples, 32, 4, -0.35 + variation * 0.08);

  // Small terminal deflection (J-point return)
  addGaussianToArray(samples, 40, 3, 0.05);

  return {
    id: `qrs_normal_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'normal', variation }
  };
}

function createRBBBTemplate(id) {
  const fs = 500;
  const duration_ms = 140; // Prolonged QRS
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Initial r wave
  addGaussianToArray(samples, 15, 4, 0.4);

  // S wave
  addGaussianToArray(samples, 28, 5, -0.5);

  // RSR' pattern - late R'
  addGaussianToArray(samples, 48, 8, 0.7);

  // Terminal slurring
  addGaussianToArray(samples, 60, 5, 0.15);

  return {
    id: `qrs_rbbb_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'rbbb' }
  };
}

function createLBBBTemplate(id) {
  const fs = 500;
  const duration_ms = 160; // Wide QRS
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Broad notched R wave
  addGaussianToArray(samples, 25, 10, 0.6);
  addGaussianToArray(samples, 40, 8, 0.5); // Notch
  addGaussianToArray(samples, 55, 12, 0.8);

  // Delayed S descent
  addGaussianToArray(samples, 70, 6, -0.2);

  return {
    id: `qrs_lbbb_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'lbbb' }
  };
}

function createLVHTemplate(id) {
  const fs = 500;
  const duration_ms = 110;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Small Q
  addGaussianToArray(samples, 12, 3, -0.12);

  // Tall R (high voltage)
  addGaussianToArray(samples, 28, 6, 1.5);

  // Deep S
  addGaussianToArray(samples, 42, 5, -0.4);

  return {
    id: `qrs_lvh_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'lvh' }
  };
}

function createPVCTemplate(id) {
  const fs = 500;
  const duration_ms = 180; // Very wide
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Bizarre wide complex
  addGaussianToArray(samples, 30, 15, -0.6);
  addGaussianToArray(samples, 55, 12, 1.2);
  addGaussianToArray(samples, 75, 10, -0.4);

  return {
    id: `qrs_pvc_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'pvc' }
  };
}

function createNormalPTemplate(id) {
  const fs = 500;
  const duration_ms = 100;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Smooth biphasic P wave
  addGaussianToArray(samples, 20, 8, 0.08);
  addGaussianToArray(samples, 32, 10, 0.12);

  return {
    id: `p_normal_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'normal' }
  };
}

function createPeakedPTemplate(id) {
  const fs = 500;
  const duration_ms = 80;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Tall peaked P (P pulmonale)
  addGaussianToArray(samples, 20, 5, 0.25);

  return {
    id: `p_peaked_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'peaked' }
  };
}

function createBifidPTemplate(id) {
  const fs = 500;
  const duration_ms = 120;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Bifid P (P mitrale)
  addGaussianToArray(samples, 18, 6, 0.08);
  addGaussianToArray(samples, 35, 5, 0.06);
  addGaussianToArray(samples, 48, 7, 0.1);

  return {
    id: `p_bifid_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'bifid' }
  };
}

function createNormalTTemplate(id) {
  const fs = 500;
  const duration_ms = 200;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Asymmetric T wave (gradual upslope, steeper downslope)
  addGaussianToArray(samples, 45, 25, 0.25);
  addGaussianToArray(samples, 55, 15, 0.15);

  return {
    id: `t_normal_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'normal' }
  };
}

function createInvertedTTemplate(id) {
  const fs = 500;
  const duration_ms = 200;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Inverted T
  addGaussianToArray(samples, 50, 20, -0.2);
  addGaussianToArray(samples, 60, 15, -0.15);

  return {
    id: `t_inverted_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'inverted' }
  };
}

function createPeakedTTemplate(id) {
  const fs = 500;
  const duration_ms = 160;
  const n = Math.round(duration_ms * fs / 1000);
  const samples = new Array(n).fill(0);

  // Peaked T (hyperkalemia pattern)
  addGaussianToArray(samples, 40, 12, 0.5);

  return {
    id: `t_peaked_${String(id).padStart(2, '0')}`,
    duration_ms,
    fs,
    samples,
    metadata: { type: 'peaked' }
  };
}

/**
 * Add Gaussian curve to array (for template creation)
 */
function addGaussianToArray(arr, center, sigma, amplitude) {
  for (let i = 0; i < arr.length; i++) {
    const x = i - center;
    arr[i] += amplitude * Math.exp(-(x * x) / (2 * sigma * sigma));
  }
}

// Initialize with embedded templates on module load
loadTemplateLibrary();
