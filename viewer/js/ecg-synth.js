// ECG Synthesis Module - generates synthetic ECG waveforms with configurable parameters
import { ECG_SCHEMA_VERSION, clamp, lerp } from "./ecg-core.js";

// ---------- utilities ----------
function norm(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n === 0 ? [1, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
}

function axisDir(axisDeg, z) {
  const th = (axisDeg * Math.PI) / 180;
  return norm([Math.cos(th), Math.sin(th), z || 0]);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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

function highpass1(x, fs, fc) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const a = RC / (RC + dt);
  const y = new Float64Array(x.length);
  y[0] = 0;
  for (let i = 1; i < x.length; i++) y[i] = a * (y[i - 1] + x[i] - x[i - 1]);
  return y;
}

function lowpass1(x, fs, fc) {
  const dt = 1 / fs;
  const RC = 1 / (2 * Math.PI * fc);
  const a = dt / (RC + dt);
  const y = new Float64Array(x.length);
  y[0] = x[0];
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + a * (x[i] - y[i - 1]);
  return y;
}

function applyDiagnosticBand(x, fs) {
  let y = highpass1(x, fs, 0.05);
  y = lowpass1(y, fs, 150);
  return y;
}

function interpAnchors(age, anchors, key) {
  if (age <= anchors[0].age) return anchors[0][key];
  if (age >= anchors[anchors.length - 1].age) return anchors[anchors.length - 1][key];
  for (let i = 0; i < anchors.length - 1; i++) {
    const A = anchors[i],
      B = anchors[i + 1];
    if (age >= A.age && age <= B.age) {
      const u = (age - A.age) / (B.age - A.age);
      return lerp(A[key], B[key], u);
    }
  }
  return anchors[0][key];
}

// ---------- age defaults ----------
const AGE_ANCHORS = [
  { age: 0.0, HR: 140, PR: 0.1, QRS: 0.065, QTc: 0.41, Paxis: 65, QRSaxis: 125, Taxis: 85, rvDom: 1.0, juvenileT: 1.0, zQ2: 0.75, zT: -0.6 },
  { age: 1.0, HR: 120, PR: 0.11, QRS: 0.07, QTc: 0.41, Paxis: 60, QRSaxis: 105, Taxis: 70, rvDom: 0.85, juvenileT: 0.9, zQ2: 0.65, zT: -0.55 },
  { age: 4.0, HR: 100, PR: 0.12, QRS: 0.07, QTc: 0.41, Paxis: 60, QRSaxis: 75, Taxis: 50, rvDom: 0.65, juvenileT: 0.75, zQ2: 0.55, zT: -0.45 },
  { age: 8.0, HR: 85, PR: 0.14, QRS: 0.08, QTc: 0.41, Paxis: 55, QRSaxis: 60, Taxis: 45, rvDom: 0.45, juvenileT: 0.5, zQ2: 0.45, zT: -0.32 },
  { age: 16.0, HR: 70, PR: 0.16, QRS: 0.09, QTc: 0.41, Paxis: 55, QRSaxis: 50, Taxis: 40, rvDom: 0.25, juvenileT: 0.2, zQ2: 0.35, zT: -0.18 },
];

export function ageDefaults(ageY) {
  ageY = clamp(ageY, 0, 25);
  return {
    HR: interpAnchors(ageY, AGE_ANCHORS, "HR"),
    PR: interpAnchors(ageY, AGE_ANCHORS, "PR"),
    QRS: interpAnchors(ageY, AGE_ANCHORS, "QRS"),
    QTc: interpAnchors(ageY, AGE_ANCHORS, "QTc"),
    Paxis: interpAnchors(ageY, AGE_ANCHORS, "Paxis"),
    QRSaxis: interpAnchors(ageY, AGE_ANCHORS, "QRSaxis"),
    Taxis: interpAnchors(ageY, AGE_ANCHORS, "Taxis"),
    rvDom: interpAnchors(ageY, AGE_ANCHORS, "rvDom"),
    juvenileT: interpAnchors(ageY, AGE_ANCHORS, "juvenileT"),
    zQ2: interpAnchors(ageY, AGE_ANCHORS, "zQ2"),
    zT: interpAnchors(ageY, AGE_ANCHORS, "zT"),
  };
}

export const DIAGNOSES = [
  "Normal sinus",
  "WPW",
  "RBBB",
  "LVH",
  "RVH",
  "SVT (narrow)",
  "Atrial flutter (2:1)",
  "Long QT",
  "Pericarditis",
];

export function applyDx(p, dx) {
  const q = { ...p };
  if (dx === "WPW") {
    q.PR = Math.max(0.08, p.PR - 0.04);
    q.QRS = Math.min(0.12, p.QRS + 0.04);
  }
  if (dx === "RBBB") {
    q.QRS = Math.min(0.14, p.QRS + 0.04);
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
  if (dx === "Long QT") {
    q.QTc = 0.5;
  }
  return q;
}

// ---------- electrode geometry (simplified forward model) ----------
const R = {
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
  for (let i = 0; i < out.length; i++) out[i] = Vx[i] * r[0] + Vy[i] * r[1] + Vz[i] * r[2];
  return out;
}

// ---------- main synthesis function ----------
export function synthECG(ageY, dx, seed, enableNoise = true, enableFilters = true) {
  const fs = 1000;
  const duration = 10.0;
  const N = Math.floor(duration * fs);

  const base = ageDefaults(ageY);
  const p = applyDx(base, dx);
  const RR = 60 / p.HR;
  const QT = p.QTc * Math.sqrt(RR);

  const Vx = new Float64Array(N),
    Vy = new Float64Array(N),
    Vz = new Float64Array(N);

  const dP1 = norm([-0.35, 0.85, 0.22]);
  const dP2 = norm([0.55, 0.75, -0.15]);
  const dQ1 = norm([-0.95, 0.1, 0.9 * (0.6 + 0.4 * p.rvDom)]);
  const dQ2 = axisDir(p.QRSaxis, p.zQ2);
  const dQ3 = norm([0.45, -0.65, -0.8]);
  const dT1 = axisDir(p.Taxis, p.zT * (0.6 + 0.4 * p.juvenileT));
  const dT2 = norm([dT1[0] * 0.9, dT1[1] * 1.05, dT1[2] * 1.1]);

  const rng = mulberry32(Math.max(1, Math.floor(seed)));

  const beatStarts = [];
  let tt = 0.6;
  const rrJit = dx.includes("flutter") || dx.includes("SVT") ? 0.0 : 0.006;
  while (tt < duration - 0.8) {
    beatStarts.push(tt);
    const rsa = dx.includes("flutter") || dx.includes("SVT") ? 0 : 0.018 * Math.sin(2 * Math.PI * 0.22 * tt);
    const rr = RR * (1.0 + rsa) + randn(rng) * rrJit;
    tt += clamp(rr, 0.35, 1.2);
  }

  if (dx === "Atrial flutter (2:1)") {
    const f = 5.0,
      amp = 0.07;
    const dF = axisDir(p.Paxis, 0.1);
    for (let i = 0; i < N; i++) {
      const x = (i / fs) * f;
      const saw = 2 * (x - Math.floor(x + 0.5));
      const F = amp * saw;
      Vx[i] += F * dF[0];
      Vy[i] += F * dF[1];
      Vz[i] += F * dF[2];
    }
  }

  for (const t0 of beatStarts) {
    const aScale = 1.0 + randn(rng) * 0.02;
    const tJit = randn(rng) * 0.003;
    const qrsOn = t0 + p.PR;
    const qrsC = qrsOn + p.QRS / 2;

    if (dx !== "SVT (narrow)" && dx !== "Atrial flutter (2:1)") {
      const pCenter = qrsOn - 0.055 + tJit;
      addGaussian3(Vx, Vy, Vz, fs, pCenter - 0.01, 0.014, 0.075 * aScale, dP1);
      addGaussian3(Vx, Vy, Vz, fs, pCenter + 0.012, 0.016, 0.095 * aScale, dP2);
    }

    addGaussian3(Vx, Vy, Vz, fs, qrsC - 0.32 * p.QRS + tJit, 0.09 * p.QRS, 0.22 * aScale, dQ1);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.16 * p.QRS, 1.1 * aScale, dQ2);
    addGaussian3(Vx, Vy, Vz, fs, qrsC + 0.34 * p.QRS + tJit, 0.12 * p.QRS, 0.36 * aScale, dQ3);

    if (dx === "WPW") {
      const dDelta = norm([dQ1[0] * 0.6 + dQ2[0] * 0.4, dQ1[1] * 0.6 + dQ2[1] * 0.4, dQ1[2] * 0.6 + dQ2[2] * 0.4]);
      addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.012 + tJit, 0.022, 0.28 * aScale, dDelta);
    }
    if (dx === "RBBB") {
      const dLate = norm([-0.9, 0.0, 0.95]);
      addGaussian3(Vx, Vy, Vz, fs, qrsOn + 0.82 * p.QRS + tJit, 0.01 + 0.08 * p.QRS, 0.35 * aScale, dLate);
    }
    if (dx === "LVH") {
      addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.16 * p.QRS, 0.55 * aScale, axisDir(p.QRSaxis - 20, p.zQ2 * 0.8));
    }
    if (dx === "RVH") {
      addGaussian3(Vx, Vy, Vz, fs, qrsC + tJit, 0.14 * p.QRS, 0.45 * aScale, norm([-0.75, 0.2, 0.95]));
    }

    const tPeak = qrsOn + 0.62 * QT + tJit;
    addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.0, 0.1 * QT, 0.22 * aScale, dT1);
    addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.03, 0.14 * QT, 0.18 * aScale, dT2);
    addGaussian3(Vx, Vy, Vz, fs, tPeak + 0.16, 0.04, 0.015 * aScale, axisDir(p.Taxis, -0.1));

    if (dx === "Pericarditis") {
      const tau = 0.008;
      const dST = axisDir(p.Taxis, p.zT * 0.7);
      const dPR = axisDir(p.Paxis, 0.0);
      function sig(tt) {
        return 0.5 * (1 + Math.tanh(tt / tau));
      }
      const j = qrsOn + 0.04;
      const stEnd = qrsOn + 0.18;
      const prStart = t0 + 0.1;
      const prEnd = qrsOn - 0.01;
      const aST = 0.1 * aScale;
      const aPR = -0.04 * aScale;
      const i0 = Math.max(0, Math.floor((t0 + 0.05) * fs));
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

  // electrode potentials
  let phiRA = dotDipole(Vx, Vy, Vz, R.RA);
  let phiLA = dotDipole(Vx, Vy, Vz, R.LA);
  let phiLL = dotDipole(Vx, Vy, Vz, R.LL);
  let phiV1 = dotDipole(Vx, Vy, Vz, R.V1);
  let phiV2 = dotDipole(Vx, Vy, Vz, R.V2);
  let phiV3 = dotDipole(Vx, Vy, Vz, R.V3);
  let phiV4 = dotDipole(Vx, Vy, Vz, R.V4);
  let phiV5 = dotDipole(Vx, Vy, Vz, R.V5);
  let phiV6 = dotDipole(Vx, Vy, Vz, R.V6);
  let phiV3R = dotDipole(Vx, Vy, Vz, R.V3R);
  let phiV4R = dotDipole(Vx, Vy, Vz, R.V4R);
  let phiV7 = dotDipole(Vx, Vy, Vz, R.V7);

  // electrode noise (preserves Einthoven)
  if (enableNoise) {
    const phase1 = rng() * Math.PI * 2;
    const phase2 = rng() * Math.PI * 2;
    for (let i = 0; i < N; i++) {
      const tt = i / fs;
      const bw = 0.04 * Math.sin(2 * Math.PI * 0.25 * tt + phase1);
      const pl = 0.004 * Math.sin(2 * Math.PI * 60 * tt + phase2);
      phiRA[i] += bw + pl;
      phiLA[i] += bw + pl;
      phiLL[i] += bw + pl;
    }
    function addEMG(x, scale) {
      const nComp = 18;
      const freqs = [],
        phases = [];
      for (let k = 0; k < nComp; k++) {
        freqs.push(20 + (100 - 20) * rng());
        phases.push(2 * Math.PI * rng());
      }
      let envPh = 2 * Math.PI * rng();
      for (let i = 0; i < N; i++) {
        const tt = i / fs;
        const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.4 * tt + envPh);
        let s = 0;
        for (let k = 0; k < nComp; k++) s += Math.sin(2 * Math.PI * freqs[k] * tt + phases[k]);
        s = (s / nComp) * env * scale;
        x[i] += s;
      }
    }
    addEMG(phiRA, 0.003);
    addEMG(phiLA, 0.003);
    addEMG(phiLL, 0.003);
    addEMG(phiV1, 0.005);
    addEMG(phiV2, 0.005);
    addEMG(phiV3, 0.005);
    addEMG(phiV4, 0.004);
    addEMG(phiV5, 0.004);
    addEMG(phiV6, 0.004);
    addEMG(phiV3R, 0.005);
    addEMG(phiV4R, 0.005);
    addEMG(phiV7, 0.004);
  }

  const WCT = new Float64Array(N);
  for (let i = 0; i < N; i++) WCT[i] = (phiRA[i] + phiLA[i] + phiLL[i]) / 3.0;

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

  let I = diff(phiLA, phiRA);
  let II = diff(phiLL, phiRA);
  let III = diff(phiLL, phiLA);
  let aVR = comb(phiRA, phiLA, phiLL);
  let aVL = comb(phiLA, phiRA, phiLL);
  let aVF = comb(phiLL, phiRA, phiLA);

  let V1 = diff(phiV1, WCT);
  let V2 = diff(phiV2, WCT);
  let V3 = diff(phiV3, WCT);
  let V4 = diff(phiV4, WCT);
  let V5 = diff(phiV5, WCT);
  let V6 = diff(phiV6, WCT);
  let V3R = diff(phiV3R, WCT);
  let V4R = diff(phiV4R, WCT);
  let V7 = diff(phiV7, WCT);

  if (enableFilters) {
    I = applyDiagnosticBand(I, fs);
    II = applyDiagnosticBand(II, fs);
    III = applyDiagnosticBand(III, fs);
    aVR = applyDiagnosticBand(aVR, fs);
    aVL = applyDiagnosticBand(aVL, fs);
    aVF = applyDiagnosticBand(aVF, fs);
    V1 = applyDiagnosticBand(V1, fs);
    V2 = applyDiagnosticBand(V2, fs);
    V3 = applyDiagnosticBand(V3, fs);
    V4 = applyDiagnosticBand(V4, fs);
    V5 = applyDiagnosticBand(V5, fs);
    V6 = applyDiagnosticBand(V6, fs);
    V3R = applyDiagnosticBand(V3R, fs);
    V4R = applyDiagnosticBand(V4R, fs);
    V7 = applyDiagnosticBand(V7, fs);
  }

  function toUV(x) {
    const out = new Int16Array(N);
    for (let i = 0; i < N; i++) {
      let v = Math.round(x[i] * 1000.0);
      v = clamp(v, -32768, 32767);
      out[i] = v;
    }
    return out;
  }

  const leads_uV = {
    I: toUV(I),
    II: toUV(II),
    III: toUV(III),
    aVR: toUV(aVR),
    aVL: toUV(aVL),
    aVF: toUV(aVF),
    V1: toUV(V1),
    V2: toUV(V2),
    V3: toUV(V3),
    V4: toUV(V4),
    V5: toUV(V5),
    V6: toUV(V6),
    V3R: toUV(V3R),
    V4R: toUV(V4R),
    V7: toUV(V7),
  };

  return {
    schema_version: ECG_SCHEMA_VERSION,
    fs,
    duration_s: duration,
    targets: {
      synthetic: true,
      age_years: ageY,
      dx,
      HR_bpm: p.HR,
      PR_ms: Math.round(p.PR * 1000),
      QRS_ms: Math.round(p.QRS * 1000),
      QT_ms: Math.round(QT * 1000),
      QTc_ms: Math.round(p.QTc * 1000),
      axes_deg: { P: p.Paxis, QRS: p.QRSaxis, T: p.Taxis },
    },
    leads_uV,
  };
}

// Generate a random case with specified parameters or random ones
export function generateRandomCase(options = {}) {
  const {
    ageMin = 0,
    ageMax = 16,
    dx = DIAGNOSES[Math.floor(Math.random() * DIAGNOSES.length)],
    seed = Math.floor(Math.random() * 100000) + 1,
    enableNoise = true,
    enableFilters = true,
  } = options;

  const age = ageMin + Math.random() * (ageMax - ageMin);
  return synthECG(age, dx, seed, enableNoise, enableFilters);
}
