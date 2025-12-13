// Synth Population QA Harness
// Generates many ECGs and validates physics consistency + truth recovery
// This test ensures no regressions in synthesis quality

import { describe, it } from 'vitest';
import assert from 'assert';
import {
  normalizeECGData,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  computeGlobalMeasurements,
  mean,
  physicsChecks,
} from '../viewer/js/ecg-core.js';
import { synthECGModular, getHRVParams, DIAGNOSES } from '../viewer/js/ecg-synth-modules.js';

// Configuration
const GOLDEN_SEEDS = [42, 123, 456, 789, 1000, 2024, 31415, 99999];

// Age bins for testing
const AGE_BINS = [
  { name: 'neonate', min: 0, max: 0.5, typical: 0.1 },
  { name: 'infant', min: 0.5, max: 2, typical: 1 },
  { name: 'toddler', min: 2, max: 6, typical: 4 },
  { name: 'school', min: 6, max: 12, typical: 8 },
  { name: 'adolescent', min: 12, max: 18, typical: 15 },
  { name: 'adult', min: 18, max: 65, typical: 35 },
];

// Tolerances for truth recovery
const TOLERANCES = {
  HR: 5,
  PR: 25,
  QRS: 25,
  QT: 40,
  QTc: 50,
  axis: 70,
};

// Physics check thresholds
const PHYSICS_THRESHOLDS = {
  einthoven_max_error_uV: 2,
};

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

function computeStats(values) {
  if (values.length === 0) return { mean: 0, std: 0, min: 0, max: 0 };
  const n = values.length;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / n;
  return {
    mean: m,
    std: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

describe('Synth Population QA', () => {
  describe('Gate A: Physics / Internal Consistency', () => {
    it('should satisfy Einthoven consistency for all diagnoses', () => {
      for (const dx of DIAGNOSES) {
        for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
          const ecg = synthECGModular(8, dx, seed);
          const { integrity } = analyze(ecg);
          assert.ok(
            integrity.einthoven_max_abs_error_uV <= PHYSICS_THRESHOLDS.einthoven_max_error_uV,
            `Einthoven ${dx} seed=${seed}: error=${integrity.einthoven_max_abs_error_uV}µV`
          );
        }
      }
    });

    it('should have valid physics consistency across age bins', () => {
      for (const ageBin of AGE_BINS) {
        const ecg = synthECGModular(ageBin.typical, 'Normal sinus', 42);
        const { integrity } = analyze(ecg);
        // Verify Einthoven consistency (no clipped_samples in JS physicsChecks)
        assert.ok(
          integrity.einthoven_max_abs_error_uV <= 2,
          `Einthoven error at age ${ageBin.name}: ${integrity.einthoven_max_abs_error_uV} µV`
        );
      }
    });

    it('should have reasonable amplitude for all age bins', () => {
      for (const ageBin of AGE_BINS) {
        for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
          const ecg = synthECGModular(ageBin.typical, 'Normal sinus', seed);
          const leadII = ecg.leads_uV.II;
          const maxAmp = Math.max(...leadII);
          const minAmp = Math.min(...leadII);
          const peakToPeak = maxAmp - minAmp;

          assert.ok(
            peakToPeak >= 200 && peakToPeak <= 4000,
            `Amplitude ${ageBin.name} seed=${seed}: p2p=${peakToPeak}µV`
          );
        }
      }
    });
  });

  describe('Gate B: Truth Recovery', () => {
    it('should recover heart rate within tolerance', () => {
      for (const ageBin of AGE_BINS) {
        for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
          const ecg = synthECGModular(ageBin.typical, 'Normal sinus', seed);
          const { measures } = analyze(ecg);
          const targetHR = ecg.targets.HR_bpm;

          if (measures.hr) {
            assert.ok(
              Math.abs(measures.hr - targetHR) <= TOLERANCES.HR,
              `HR ${ageBin.name} seed=${seed}: expected ${targetHR}, got ${measures.hr?.toFixed(1)}`
            );
          }
        }
      }
    });

    it('should recover QRS duration for narrow QRS diagnoses', () => {
      const narrowQRSDx = DIAGNOSES.filter((dx) => !dx.includes('BBB') && !dx.includes('WPW') && !dx.includes('PVC'));
      for (const dx of narrowQRSDx.slice(0, 5)) {
        for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
          const ecg = synthECGModular(8, dx, seed);
          const { measures } = analyze(ecg);
          const targetQRS = ecg.targets.QRS_ms;

          if (measures.QRS) {
            assert.ok(
              Math.abs(measures.QRS - targetQRS) <= TOLERANCES.QRS,
              `QRS ${dx} seed=${seed}: expected ${targetQRS}, got ${measures.QRS?.toFixed(0)}`
            );
          }
        }
      }
    });

    it('should recover QRS axis within tolerance', () => {
      for (const ageBin of AGE_BINS) {
        for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
          const ecg = synthECGModular(ageBin.typical, 'Normal sinus', seed);
          const { measures } = analyze(ecg);
          const targetAxis = ecg.targets.axes_deg.QRS;

          if (measures.axes && measures.axes.qAxis != null) {
            const error = Math.abs(measures.axes.qAxis - targetAxis);
            const wrappedError = Math.min(error, 360 - error);
            assert.ok(
              wrappedError <= TOLERANCES.axis,
              `Axis ${ageBin.name} seed=${seed}: expected ${targetAxis}°, got ${measures.axes.qAxis.toFixed(0)}°`
            );
          }
        }
      }
    });
  });

  describe('Gate C: HRV Realism', () => {
    it('should include HRV metrics for all age bins', () => {
      for (const ageBin of AGE_BINS) {
        const ecg = synthECGModular(ageBin.typical, 'Normal sinus', 42);
        assert.ok(ecg.targets.hrv, `HRV should exist for age ${ageBin.name}`);
        assert.ok(ecg.targets.hrv.SDNN >= 0, `SDNN should be non-negative for age ${ageBin.name}`);
      }
    });

    it('should have higher HRV in younger patients', () => {
      const neonateECG = synthECGModular(0.1, 'Normal sinus', 42);
      const adultECG = synthECGModular(35, 'Normal sinus', 42);

      const neonateSDNN = neonateECG.targets.hrv?.SDNN || 0;
      const adultSDNN = adultECG.targets.hrv?.SDNN || 0;

      assert.ok(
        neonateSDNN > adultSDNN,
        `Neonate SDNN (${neonateSDNN}) should be > adult SDNN (${adultSDNN})`
      );
    });
  });

  describe('Gate D: Seed Reproducibility', () => {
    it('should produce identical output for same seed', () => {
      for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
        const ecg1 = synthECGModular(8, 'Normal sinus', seed);
        const ecg2 = synthECGModular(8, 'Normal sinus', seed);

        for (let i = 0; i < 100; i++) {
          assert.strictEqual(ecg1.leads_uV.II[i], ecg2.leads_uV.II[i], `Seed ${seed} not reproducible at sample ${i}`);
        }
      }
    });
  });

  describe('Population Statistics', () => {
    it('should generate valid population with reasonable statistics', () => {
      const popStats = {
        hr: [],
        qrs: [],
        rPeakCount: [],
        einthovenError: [],
      };

      const sampleSize = 20;
      for (let i = 0; i < sampleSize; i++) {
        const age = AGE_BINS[i % AGE_BINS.length].typical;
        const dx = DIAGNOSES[i % DIAGNOSES.length];
        const seed = 1000 + i;

        const ecg = synthECGModular(age, dx, seed);
        const { measures, rPeaks, integrity } = analyze(ecg);

        if (measures.hr) popStats.hr.push(measures.hr);
        if (measures.QRS) popStats.qrs.push(measures.QRS);
        popStats.rPeakCount.push(rPeaks.length);
        popStats.einthovenError.push(integrity.einthoven_max_abs_error_uV);
      }

      // Verify reasonable population statistics
      const hrStats = computeStats(popStats.hr);
      const qrsStats = computeStats(popStats.qrs);
      const einthovenStats = computeStats(popStats.einthovenError);

      assert.ok(hrStats.mean > 50 && hrStats.mean < 180, `Mean HR ${hrStats.mean} should be reasonable`);
      assert.ok(qrsStats.mean > 40 && qrsStats.mean < 200, `Mean QRS ${qrsStats.mean} should be reasonable`);
      assert.ok(einthovenStats.max <= 2, `Max Einthoven error ${einthovenStats.max} should be <= 2 µV`);
    });
  });
});
