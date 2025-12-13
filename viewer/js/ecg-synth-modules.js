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
// MODULE 1: RHYTHM MODEL
// Generates beat schedule based on rhythm type and heart rate
// Input: params, seed
// Output: beatSchedule array of { pTime, qrsTime, hasPWave, hasQRS, isPVC, prInterval }
// ============================================================================

export function rhythmModel(params, dx, duration, seed) {
  const rng = mulberry32(Math.max(1, Math.floor(seed)));
  const RR = 60 / params.HR;

  // Generate P wave times (atrial rhythm)
  const pWaveTimes = [];
  let tt = 0.6;
  const rrJit = dx.includes("flutter") || dx.includes("SVT") || dx.includes("AVB") ? 0.0 : 0.006;

  while (tt < duration - 0.8) {
    pWaveTimes.push(tt);
    const rsa = dx.includes("flutter") || dx.includes("SVT") ? 0 : 0.018 * Math.sin(2 * Math.PI * 0.22 * tt);
    const rr = RR * (1.0 + rsa) + randn(rng) * rrJit;
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
    // Normal rhythm with occasional early P waves
    for (let i = 0; i < pWaveTimes.length; i++) {
      const pT = pWaveTimes[i];
      beats.push({ pTime: pT, qrsTime: pT + params.PR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR });
      if (i > 0 && i % 5 === 3 && pT + RR * 0.65 < duration - 0.5) {
        const pacTime = pT + RR * 0.65;
        beats.push({ pTime: pacTime, qrsTime: pacTime + params.PR * 0.9, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR * 0.9 });
      }
    }
  } else if (dx === "PVCs") {
    // Normal rhythm with occasional PVCs
    for (let i = 0; i < pWaveTimes.length; i++) {
      const pT = pWaveTimes[i];
      beats.push({ pTime: pT, qrsTime: pT + params.PR, hasPWave: true, hasQRS: true, isPVC: false, prInterval: params.PR });
      if (i > 0 && i % 4 === 2 && pT + RR * 0.7 < duration - 0.5) {
        const pvcTime = pT + RR * 0.7;
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

  return {
    beats,
    RR,
    pWaveTimes,
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

  // Module 1: Rhythm
  const beatSchedule = rhythmModel(params, dx, duration, seed);

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
      generator_version: "2.0.0-modular",
      age_years: ageY,
      dx,
      HR_bpm: params.HR,
      PR_ms: Math.round(params.PR * 1000),
      QRS_ms: Math.round(params.QRS * 1000),
      QT_ms: Math.round(QT * 1000),
      QTc_ms: Math.round(params.QTc * 1000),
      axes_deg: { P: params.Paxis, QRS: params.QRSaxis, T: params.Taxis },
    },
    leads_uV,
  };
}

// Re-export for convenience
export { DIAGNOSES, ageDefaults, applyDx };
