import { describe, it } from 'vitest';
import assert from 'assert';
import fs from 'fs/promises';
import {
  normalizeECGData,
  detectRPeaks,
  mean,
  buildMedianBeat,
  fiducialsFromMedian,
  buildFullFiducialsFromMedian,
  computeGlobalMeasurements,
} from '../viewer/js/ecg-core.js';

function approx(actual, expected, tol) {
  assert.ok(Number.isFinite(actual), `actual not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
}

async function loadJSON(relativePath) {
  return JSON.parse(await fs.readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

function analyze(meta) {
  const rPeaks = detectRPeaks(meta);
  const medBeat = buildMedianBeat(meta, rPeaks, 0.25, 0.55);
  assert.ok(medBeat.ok, medBeat.reason || 'median beat failed');

  let rrMean = null;
  if (rPeaks.length >= 2) {
    const rrs = [];
    for (let i = 1; i < rPeaks.length; i++) rrs.push((rPeaks[i] - rPeaks[i - 1]) / meta.fs);
    rrMean = mean(rrs);
  }
  const medFids = fiducialsFromMedian(medBeat, rrMean);
  const fiducials = buildFullFiducialsFromMedian(meta, rPeaks, medFids);
  const measures = computeGlobalMeasurements(meta, rPeaks, medBeat, medFids);
  return { rPeaks, fiducials, measures };
}

describe('Golden Tests', () => {
  it('should match golden expectations for all cases', async () => {
    const golden = await loadJSON('./golden.json');

    for (const c of golden.cases) {
      const raw = await loadJSON(c.path);
      const meta = normalizeECGData(raw);
      const res = analyze(meta);

      assert.strictEqual(res.rPeaks.length, c.expect.rPeaks, `${c.name}: rPeaks`);
      approx(res.measures.hr, c.expect.hr_bpm, 0.5);
      approx(res.measures.QRS, c.expect.qrs_ms, 10);
    }
  });
});
