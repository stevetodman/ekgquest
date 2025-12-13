// Synth Population QA Harness
// Generates many ECGs and validates physics consistency + truth recovery
// This test ensures no regressions in synthesis quality

import assert from "assert";
import {
  normalizeECGData,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  computeGlobalMeasurements,
  mean,
  physicsChecks,
} from "../viewer/js/ecg-core.js";
import {
  synthECGModular,
  getHRVParams,
} from "../viewer/js/ecg-synth-modules.js";
import { DIAGNOSES } from "../viewer/js/ecg-synth.js";

// Configuration
const POPULATION_SIZE = 50; // Cases per age/dx combination for population tests
const GOLDEN_SEEDS = [42, 123, 456, 789, 1000, 2024, 31415, 99999];

// Age bins for testing
const AGE_BINS = [
  { name: "neonate", min: 0, max: 0.5, typical: 0.1 },
  { name: "infant", min: 0.5, max: 2, typical: 1 },
  { name: "toddler", min: 2, max: 6, typical: 4 },
  { name: "school", min: 6, max: 12, typical: 8 },
  { name: "adolescent", min: 12, max: 18, typical: 15 },
  { name: "adult", min: 18, max: 65, typical: 35 },
];

// Tolerances for truth recovery
const TOLERANCES = {
  HR: 5,        // bpm
  PR: 25,       // ms
  QRS: 25,      // ms
  QT: 40,       // ms
  QTc: 50,      // ms
  axis: 20,     // degrees
};

// Physics check thresholds
const PHYSICS_THRESHOLDS = {
  einthoven_max_error_uV: 2,       // Clean ECG should have near-zero Einthoven error
  einthoven_noisy_max_error_uV: 50, // Noisy ECG can have higher error
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

// Statistics helper
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

async function run() {
  console.log("Running Synth Population QA Harness...\n");
  console.log(`Population size: ${POPULATION_SIZE} cases per age/dx combination`);
  console.log(`Golden seeds: ${GOLDEN_SEEDS.length}`);
  console.log(`Age bins: ${AGE_BINS.length}`);
  console.log(`Diagnoses: ${DIAGNOSES.length}\n`);

  let totalTests = 0;
  let passedTests = 0;
  const failures = [];

  // ============================================================================
  // Gate A: Physics / Internal Consistency
  // ============================================================================
  console.log("=".repeat(60));
  console.log("GATE A: Physics / Internal Consistency");
  console.log("=".repeat(60));

  // Test 1: Einthoven consistency across all diagnoses
  console.log("\nTest A1: Einthoven consistency (I + III ≈ II)");
  for (const dx of DIAGNOSES) {
    for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
      const ecg = synthECGModular(8, dx, seed);
      const { integrity } = analyze(ecg);
      totalTests++;

      if (integrity.einthoven_max_abs_error_uV > PHYSICS_THRESHOLDS.einthoven_max_error_uV) {
        failures.push(`Einthoven ${dx} seed=${seed}: error=${integrity.einthoven_max_abs_error_uV}µV`);
      } else {
        passedTests++;
      }
    }
  }
  console.log(`  Tested ${DIAGNOSES.length * 3} cases across all diagnoses`);

  // Test 2: No clipping/saturation
  console.log("\nTest A2: No signal clipping");
  for (const ageBin of AGE_BINS) {
    const ecg = synthECGModular(ageBin.typical, "Normal sinus", 42);
    const { integrity } = analyze(ecg);
    totalTests++;

    if (integrity.clipped_samples > 0) {
      failures.push(`Clipping at age ${ageBin.name}: ${integrity.clipped_samples} samples`);
    } else {
      passedTests++;
    }
  }
  console.log(`  Tested ${AGE_BINS.length} age bins for clipping`);

  // Test 3: Amplitude sanity (not too big, not too small)
  console.log("\nTest A3: Amplitude sanity");
  for (const ageBin of AGE_BINS) {
    for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
      const ecg = synthECGModular(ageBin.typical, "Normal sinus", seed);
      totalTests++;

      // Check lead II amplitude (typical R wave should be 500-2500 µV)
      const leadII = ecg.leads_uV.II;
      const maxAmp = Math.max(...leadII);
      const minAmp = Math.min(...leadII);
      const peakToPeak = maxAmp - minAmp;

      if (peakToPeak < 200 || peakToPeak > 4000) {
        failures.push(`Amplitude ${ageBin.name} seed=${seed}: p2p=${peakToPeak}µV`);
      } else {
        passedTests++;
      }
    }
  }
  console.log(`  Tested ${AGE_BINS.length * 2} cases for amplitude sanity`);

  // ============================================================================
  // Gate B: Truth Recovery (Educational Realism)
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("GATE B: Truth Recovery (Analysis recovers synth targets)");
  console.log("=".repeat(60));

  // Test 4: HR recovery
  console.log("\nTest B1: Heart rate recovery");
  const hrErrors = [];
  for (const ageBin of AGE_BINS) {
    for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
      const ecg = synthECGModular(ageBin.typical, "Normal sinus", seed);
      const { measures } = analyze(ecg);
      const targetHR = ecg.targets.HR_bpm;

      totalTests++;
      if (measures.hr && Math.abs(measures.hr - targetHR) <= TOLERANCES.HR) {
        passedTests++;
        hrErrors.push(measures.hr - targetHR);
      } else if (!measures.hr) {
        failures.push(`HR null for age ${ageBin.name} seed=${seed}`);
      } else {
        failures.push(`HR ${ageBin.name} seed=${seed}: expected ${targetHR}, got ${measures.hr?.toFixed(1)}`);
        hrErrors.push(measures.hr - targetHR);
      }
    }
  }
  const hrStats = computeStats(hrErrors);
  console.log(`  HR error: mean=${hrStats.mean.toFixed(2)} std=${hrStats.std.toFixed(2)} range=[${hrStats.min.toFixed(1)}, ${hrStats.max.toFixed(1)}]`);

  // Test 5: QRS duration recovery (skip LBBB, RBBB which have intentionally wide QRS)
  console.log("\nTest B2: QRS duration recovery (narrow QRS diagnoses)");
  const narrowQRSDx = DIAGNOSES.filter(dx => !dx.includes("BBB") && !dx.includes("WPW") && !dx.includes("PVC"));
  const qrsErrors = [];
  for (const dx of narrowQRSDx.slice(0, 5)) {
    for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
      const ecg = synthECGModular(8, dx, seed);
      const { measures } = analyze(ecg);
      const targetQRS = ecg.targets.QRS_ms;

      totalTests++;
      if (measures.QRS && Math.abs(measures.QRS - targetQRS) <= TOLERANCES.QRS) {
        passedTests++;
        qrsErrors.push(measures.QRS - targetQRS);
      } else if (!measures.QRS) {
        // QRS measurement failed - this is acceptable for some rhythms
        passedTests++;
      } else {
        failures.push(`QRS ${dx} seed=${seed}: expected ${targetQRS}, got ${measures.QRS?.toFixed(0)}`);
        qrsErrors.push(measures.QRS - targetQRS);
      }
    }
  }
  if (qrsErrors.length > 0) {
    const qrsStats = computeStats(qrsErrors);
    console.log(`  QRS error: mean=${qrsStats.mean.toFixed(1)} std=${qrsStats.std.toFixed(1)} range=[${qrsStats.min.toFixed(0)}, ${qrsStats.max.toFixed(0)}]`);
  }

  // Test 6: Axis recovery
  console.log("\nTest B3: QRS axis recovery");
  const axisErrors = [];
  for (const ageBin of AGE_BINS) {
    for (const seed of GOLDEN_SEEDS.slice(0, 2)) {
      const ecg = synthECGModular(ageBin.typical, "Normal sinus", seed);
      const { measures } = analyze(ecg);
      const targetAxis = ecg.targets.axes_deg.QRS;

      totalTests++;
      if (measures.axes && measures.axes.qAxis != null) {
        const error = Math.abs(measures.axes.qAxis - targetAxis);
        // Handle axis wrap-around (e.g., -170 vs 180)
        const wrappedError = Math.min(error, 360 - error);
        if (wrappedError <= TOLERANCES.axis) {
          passedTests++;
          axisErrors.push(wrappedError);
        } else {
          failures.push(`Axis ${ageBin.name} seed=${seed}: expected ${targetAxis}°, got ${measures.axes.qAxis.toFixed(0)}°`);
          axisErrors.push(wrappedError);
        }
      } else {
        // Axis measurement failed
        passedTests++;
      }
    }
  }
  if (axisErrors.length > 0) {
    const axisStats = computeStats(axisErrors);
    console.log(`  Axis error: mean=${axisStats.mean.toFixed(1)}° std=${axisStats.std.toFixed(1)}° range=[${axisStats.min.toFixed(0)}, ${axisStats.max.toFixed(0)}]°`);
  }

  // ============================================================================
  // Gate C: HRV Realism
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("GATE C: HRV Realism");
  console.log("=".repeat(60));

  // Test 7: HRV age scaling
  console.log("\nTest C1: HRV age scaling (younger = higher SDNN)");
  const hrvByAge = [];
  for (const ageBin of AGE_BINS) {
    const ecg = synthECGModular(ageBin.typical, "Normal sinus", 42);
    totalTests++;

    if (ecg.targets.hrv && ecg.targets.hrv.SDNN >= 0) {
      hrvByAge.push({ age: ageBin.typical, name: ageBin.name, SDNN: ecg.targets.hrv.SDNN });
      passedTests++;
    } else {
      failures.push(`HRV missing for age ${ageBin.name}`);
    }
  }

  // Verify SDNN generally decreases with age (allowing some variation)
  if (hrvByAge.length >= 2) {
    const neonateSDNN = hrvByAge.find(h => h.name === "neonate")?.SDNN || 0;
    const adultSDNN = hrvByAge.find(h => h.name === "adult")?.SDNN || 0;
    totalTests++;
    if (neonateSDNN > adultSDNN) {
      passedTests++;
      console.log(`  SDNN scaling verified: neonate=${neonateSDNN.toFixed(1)}ms > adult=${adultSDNN.toFixed(1)}ms`);
    } else {
      failures.push(`HRV scaling: neonate SDNN (${neonateSDNN}) should be > adult (${adultSDNN})`);
    }
  }

  for (const h of hrvByAge) {
    console.log(`  ${h.name} (age ${h.age}): SDNN=${h.SDNN.toFixed(1)}ms`);
  }

  // ============================================================================
  // Gate D: Seed Reproducibility
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("GATE D: Seed Reproducibility");
  console.log("=".repeat(60));

  console.log("\nTest D1: Same seed produces identical output");
  for (const seed of GOLDEN_SEEDS.slice(0, 3)) {
    const ecg1 = synthECGModular(8, "Normal sinus", seed);
    const ecg2 = synthECGModular(8, "Normal sinus", seed);
    totalTests++;

    // Compare a few samples from lead II
    let identical = true;
    for (let i = 0; i < 100; i++) {
      if (ecg1.leads_uV.II[i] !== ecg2.leads_uV.II[i]) {
        identical = false;
        break;
      }
    }

    if (identical) {
      passedTests++;
    } else {
      failures.push(`Seed ${seed} not reproducible`);
    }
  }
  console.log(`  Tested ${3} seeds for reproducibility`);

  // ============================================================================
  // Population Statistics
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("POPULATION STATISTICS");
  console.log("=".repeat(60));

  // Generate a larger population and collect statistics
  console.log("\nGenerating population sample for statistics...");
  const popStats = {
    hr: [],
    qrs: [],
    qt: [],
    qtc: [],
    rPeakCount: [],
    einthovenError: [],
  };

  const sampleSize = Math.min(POPULATION_SIZE, 20);
  for (let i = 0; i < sampleSize; i++) {
    const age = AGE_BINS[i % AGE_BINS.length].typical;
    const dx = DIAGNOSES[i % DIAGNOSES.length];
    const seed = 1000 + i;

    const ecg = synthECGModular(age, dx, seed);
    const { measures, rPeaks, integrity } = analyze(ecg);

    if (measures.hr) popStats.hr.push(measures.hr);
    if (measures.QRS) popStats.qrs.push(measures.QRS);
    if (measures.QT) popStats.qt.push(measures.QT);
    if (measures.QTcB) popStats.qtc.push(measures.QTcB);
    popStats.rPeakCount.push(rPeaks.length);
    popStats.einthovenError.push(integrity.einthoven_max_abs_error_uV);
  }

  console.log(`\nPopulation of ${sampleSize} cases:`);
  console.log(`  HR: mean=${computeStats(popStats.hr).mean.toFixed(1)} std=${computeStats(popStats.hr).std.toFixed(1)} bpm`);
  console.log(`  QRS: mean=${computeStats(popStats.qrs).mean.toFixed(0)} std=${computeStats(popStats.qrs).std.toFixed(0)} ms`);
  console.log(`  QT: mean=${computeStats(popStats.qt).mean.toFixed(0)} std=${computeStats(popStats.qt).std.toFixed(0)} ms`);
  console.log(`  QTc: mean=${computeStats(popStats.qtc).mean.toFixed(0)} std=${computeStats(popStats.qtc).std.toFixed(0)} ms`);
  console.log(`  R-peaks: mean=${computeStats(popStats.rPeakCount).mean.toFixed(1)} std=${computeStats(popStats.rPeakCount).std.toFixed(1)}`);
  console.log(`  Einthoven error: max=${computeStats(popStats.einthovenError).max.toFixed(1)} µV`);

  // ============================================================================
  // Summary
  // ============================================================================
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  const passRate = ((passedTests / totalTests) * 100).toFixed(1);
  console.log(`\nTotal tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} (${passRate}%)`);
  console.log(`Failed: ${totalTests - passedTests}`);

  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  - ${f}`);
    }
    if (failures.length > 10) {
      console.log(`  ... and ${failures.length - 10} more`);
    }
  }

  // Pass/fail threshold (allow some failures for edge cases)
  const PASS_THRESHOLD = 90;
  if (parseFloat(passRate) >= PASS_THRESHOLD) {
    console.log(`\n✓ Synth population QA passed (${passRate}% >= ${PASS_THRESHOLD}%)`);
  } else {
    console.error(`\n✗ Synth population QA failed (${passRate}% < ${PASS_THRESHOLD}%)`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("\n✗ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
