import {
  normalizeECGData,
  validateECGData,
  physicsChecks,
  detectRPeaks,
  mean,
  buildMedianBeat,
  fiducialsFromMedian,
  buildFullFiducialsFromMedian,
  computeGlobalMeasurements,
} from "./ecg-core.js";

function analyze(rawMeta) {
  const meta = normalizeECGData(rawMeta);
  const validation = validateECGData(meta);

  const integrity = physicsChecks(meta.leads_uV);

  const warnings = [...validation.warnings];
  const errors = [...validation.errors];

  let rPeaks = [];
  let medBeat = null;
  let medFids = null;
  let fiducials = { rPeaks: [], qOn: [], qOff: [], pOn: [], tEnd: [] };
  let measures = null;

  if (meta.leads_uV && meta.leads_uV.II) {
    rPeaks = detectRPeaks(meta);

    medBeat = buildMedianBeat(meta, rPeaks, 0.25, 0.55);

    let rrMean = null;
    if (rPeaks.length >= 2) {
      const rrs = [];
      for (let i = 1; i < rPeaks.length; i++) rrs.push((rPeaks[i] - rPeaks[i - 1]) / meta.fs);
      rrMean = mean(rrs);
    }

    medFids = medBeat && medBeat.ok ? fiducialsFromMedian(medBeat, rrMean) : null;
    if (medFids && medBeat && medBeat.ok) {
      fiducials = buildFullFiducialsFromMedian(meta, rPeaks, medFids);
    } else {
      fiducials = { rPeaks, qOn: [], qOff: [], pOn: [], tEnd: [] };
      warnings.push("Median fiducials unavailable");
    }

    measures = computeGlobalMeasurements(meta, rPeaks, medBeat, medFids);
  } else {
    warnings.push("Lead II missing: cannot run R-peak detection");
  }

  return {
    schema_version: meta.schema_version,
    integrity,
    warnings,
    errors,
    rPeaks,
    medBeat: medBeat
      ? { ok: medBeat.ok, reason: medBeat.reason, beatsUsed: medBeat.beatsUsed, rIdxMed: medBeat.rIdxMed }
      : null,
    medianFiducials: medFids,
    fiducials,
    measures,
  };
}

self.onmessage = (evt) => {
  const msg = evt.data || {};
  const { id, type, payload } = msg;
  if (type !== "analyze") {
    self.postMessage({ id, ok: false, error: `Unknown worker message type: ${type}` });
    return;
  }

  try {
    const result = analyze(payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
