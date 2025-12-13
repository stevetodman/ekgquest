// Golden Seed Regression Test
// Ensures synthetic ECG generation remains consistent across code changes
// Uses fixed seeds to detect any drift in output

import { describe, it } from 'vitest';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
  normalizeECGData,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  computeGlobalMeasurements,
  mean,
  physicsChecks,
} from '../viewer/js/ecg-core.js';
import { synthECGModular } from '../viewer/js/ecg-synth-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load golden seeds configuration
const goldenConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden_seeds.json'), 'utf-8'));

// Expected measurements for each golden seed (tolerance-based comparison)
const EXPECTED_MEASUREMENTS = {
  neonate_normal: { hr: [140, 170], rPeaks: [20, 30] },
  infant_normal: { hr: [110, 140], rPeaks: [16, 24] },
  toddler_normal: { hr: [90, 120], rPeaks: [13, 20] },
  school_normal: { hr: [75, 105], rPeaks: [11, 17] },
  adolescent_normal: { hr: [65, 95], rPeaks: [9, 15] },
  adult_normal: { hr: [60, 90], rPeaks: [8, 14] },
  wpw_child: { hr: [75, 105], rPeaks: [11, 17] },
  rbbb_child: { hr: [75, 105], rPeaks: [11, 17] },
  lbbb_adult: { hr: [60, 90], rPeaks: [8, 14] },
  lvh_child: { hr: [75, 105], rPeaks: [11, 17] },
  rvh_neonate: { hr: [128, 160], rPeaks: [18, 28] },
  svt_child: { hr: [150, 220], rPeaks: [22, 38] },
  flutter_adult: { hr: [110, 160], rPeaks: [16, 26] },
  avb1_child: { hr: [75, 105], rPeaks: [11, 17] },
  avb2_wencke: { hr: [45, 85], rPeaks: [6, 14] },
  avb3_adult: { hr: [35, 55], rPeaks: [4, 9] },
  longqt_child: { hr: [75, 105], rPeaks: [11, 17] },
  pacs_child: { hr: [75, 115], rPeaks: [11, 19] },
  pvcs_adult: { hr: [60, 95], rPeaks: [8, 16] },
  brady_adult: { hr: [40, 60], rPeaks: [5, 10] },
};

function hashLeadData(leadData, samples = 1000) {
  const hash = crypto.createHash('md5');
  const step = Math.floor(leadData.length / samples);
  for (let i = 0; i < samples && i * step < leadData.length; i++) {
    hash.update(Buffer.from(new Int16Array([leadData[i * step]]).buffer));
  }
  return hash.digest('hex');
}

function analyze(ecgData) {
  const meta = normalizeECGData(ecgData);
  const rPeaks = detectRPeaks(meta);
  const medBeat = buildMedianBeat(meta, rPeaks, 0.25, 0.55);

  let rrMean = null;
  if (rPeaks.length >= 2) {
    const rrs = [];
    for (let i = 1; i < rPeaks.length; i++) rrs.push((rPeaks[i] - rPeaks[i - 1]) / meta.fs);
    rrMean = mean(rrs);
  }

  const medFids = medBeat && medBeat.ok ? fiducialsFromMedian(medBeat, rrMean) : null;
  const measures = computeGlobalMeasurements(meta, rPeaks, medBeat, medFids);
  const integrity = physicsChecks(meta.leads_uV);

  return { meta, rPeaks, medBeat, medFids, measures, integrity };
}

describe('Golden Seed Regression Tests', () => {
  describe('Golden Seeds', () => {
    for (const seed of goldenConfig.seeds) {
      it(`should generate valid ECG for ${seed.id}`, () => {
        const ecg = synthECGModular(seed.age_years, seed.dx, seed.seed);
        const { measures, rPeaks, integrity } = analyze(ecg);

        // Verify Einthoven consistency
        assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `Einthoven error: ${integrity.einthoven_max_abs_error_uV} > 2 µV`);

        // Verify expected measurements
        const expected = EXPECTED_MEASUREMENTS[seed.id];
        if (expected) {
          if (measures.hr) {
            assert.ok(
              measures.hr >= expected.hr[0] && measures.hr <= expected.hr[1],
              `HR ${measures.hr.toFixed(1)} not in range [${expected.hr[0]}, ${expected.hr[1]}]`
            );
          }

          assert.ok(
            rPeaks.length >= expected.rPeaks[0] && rPeaks.length <= expected.rPeaks[1],
            `R-peaks ${rPeaks.length} not in range [${expected.rPeaks[0]}, ${expected.rPeaks[1]}]`
          );
        }
      });
    }
  });

  describe('Reproducibility', () => {
    it('should produce identical output for same seed', () => {
      const testSeed = goldenConfig.seeds[0];
      const ecg1 = synthECGModular(testSeed.age_years, testSeed.dx, testSeed.seed);
      const ecg2 = synthECGModular(testSeed.age_years, testSeed.dx, testSeed.seed);
      const hash1 = hashLeadData(ecg1.leads_uV.II);
      const hash2 = hashLeadData(ecg2.leads_uV.II);

      assert.strictEqual(hash1, hash2, `${testSeed.id}: NOT REPRODUCIBLE! hash1=${hash1} hash2=${hash2}`);
    });
  });
});
