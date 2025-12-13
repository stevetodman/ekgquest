// Shared ECG utilities: schema normalization, integrity checks, detection, and measurements.

export const ECG_SCHEMA_VERSION = 1;
const VIEWER_REQUIRED_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function lerp(a, b, u) {
  return a + (b - a) * u;
}

export function medianOfSmallArray(arr) {
  const copy = [...arr].sort((x, y) => x - y);
  return copy[(copy.length / 2) | 0];
}

export function medianWindow(arr, i0, i1) {
  const L = arr.length;
  i0 = clamp(i0 | 0, 0, L - 1);
  i1 = clamp(i1 | 0, 0, L - 1);
  if (i1 <= i0) return arr[i0] || 0;
  const tmp = [];
  for (let i = i0; i <= i1; i++) tmp.push(arr[i]);
  return medianOfSmallArray(tmp);
}

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

function toInt16(arr) {
  if (arr instanceof Int16Array) return arr;
  const out = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const v = Number.isFinite(arr[i]) ? arr[i] : 0;
    out[i] = v;
  }
  return out;
}

// Normalizes any raw ECG JSON object into the canonical schema.
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

export async function fetchECG(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  const raw = await res.json();
  const meta = normalizeECGData(raw);
  meta.integrity = { ...physicsChecks(meta.leads_uV), ...meta.integrity };
  return meta;
}

// Einthoven and augmented-lead consistency checks.
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

// Simple derivative + MWA-based R-peak detection on Lead II.
export function detectRPeaks(meta) {
  const fs = meta.fs;
  const x = meta.leads_uV.II;
  const n = x.length;
  const sq = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = x[i] - x[i - 1];
    sq[i] = d * d;
  }
  const win = Math.max(1, Math.floor(0.08 * fs));
  const mwa = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += sq[i];
    if (i >= win) s -= sq[i - win];
    mwa[i] = s / win;
  }
  let maxM = 0;
  for (let i = 0; i < n; i++) if (mwa[i] > maxM) maxM = mwa[i];
  const thr = 0.35 * maxM;
  const refractory = Math.floor(0.25 * fs);

  const rPeaks = [];
  let i = win;
  while (i < n - 2) {
    if (mwa[i] > thr && mwa[i] > mwa[i - 1] && mwa[i] >= mwa[i + 1]) {
      const L = Math.max(0, i - Math.floor(0.05 * fs));
      const R = Math.min(n - 1, i + Math.floor(0.05 * fs));
      let best = -1,
        r = i;
      for (let k = L; k <= R; k++) {
        const a = Math.abs(x[k]);
        if (a > best) {
          best = a;
          r = k;
        }
      }
      if (rPeaks.length === 0 || r - rPeaks[rPeaks.length - 1] > Math.floor(0.3 * fs))
        rPeaks.push(r);
      i = r + refractory;
    } else i++;
  }

  // Fallback: if we know the target HR but detected too few beats, seed peaks near expected RR
  const targetHR = meta.targets && meta.targets.HR_bpm;
  if (targetHR && rPeaks.length < Math.max(3, Math.floor((n / fs) * (targetHR / 60) * 0.9))) {
    const expectedRR = Math.max(0.3, 60 / targetHR) * fs;
    const minGap = Math.max(0.2 * fs, expectedRR * 0.45);
    for (let start = 0; start < n; start += expectedRR) {
      const w = Math.min(n - 1, Math.floor(start + expectedRR * 0.8));
      let bestIdx = null,
        bestAmp = 0;
      for (let k = Math.floor(Math.max(0, start - expectedRR * 0.2)); k <= w; k++) {
        const a = Math.abs(x[k]);
        if (a > bestAmp) {
          bestAmp = a;
          bestIdx = k;
        }
      }
      if (bestIdx != null) {
        // Insert if not near an existing peak
        let canInsert = true;
        let pos = 0;
        while (pos < rPeaks.length && rPeaks[pos] < bestIdx) pos++;
        const leftDiff = pos > 0 ? bestIdx - rPeaks[pos - 1] : Infinity;
        const rightDiff = pos < rPeaks.length ? rPeaks[pos] - bestIdx : Infinity;
        if (leftDiff < minGap || rightDiff < minGap) canInsert = false;
        if (canInsert) {
          rPeaks.splice(pos, 0, bestIdx);
        }
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
