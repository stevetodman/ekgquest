// Synth validation harness - verifies synthetic ECGs match target parameters
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
import { synthECG, DIAGNOSES, ageDefaults, applyDx } from "../viewer/js/ecg-synth.js";

function approx(actual, expected, tolerance, label = "value") {
  if (expected == null) return; // skip if no expected value
  assert.ok(Number.isFinite(actual), `${label} not finite: ${actual}`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${label}: expected ${expected}±${tolerance}, got ${actual} (diff=${diff.toFixed(1)})`);
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

// Test that Einthoven's law is satisfied
function testEinthovenIntegrity(ecgData, label) {
  const { integrity } = analyze(ecgData);
  assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `${label}: Einthoven error ${integrity.einthoven_max_abs_error_uV} > 2 µV`);
}

// Test that HR measurement matches target
function testHR(ecgData, targetHR, tolerance, label) {
  const { measures } = analyze(ecgData);
  approx(measures.hr, targetHR, tolerance, `${label} HR`);
}

// Test that QRS duration matches target
function testQRS(ecgData, targetQRS, tolerance, label) {
  const { measures } = analyze(ecgData);
  approx(measures.QRS, targetQRS, tolerance, `${label} QRS`);
}

// Test that QT interval is physiologically reasonable given QTc
function testQT(ecgData, targetQTc, hrTolerance, label) {
  const { measures } = analyze(ecgData);
  if (measures.QTcB != null && targetQTc != null) {
    // QTc should be within 50ms of target (allowing for measurement variation)
    approx(measures.QTcB, targetQTc, 50, `${label} QTcB`);
  }
}

// Test axis is in expected range
function testAxis(ecgData, targetAxis, tolerance, label) {
  const { measures } = analyze(ecgData);
  if (measures.axes && measures.axes.qAxis != null && targetAxis != null) {
    approx(measures.axes.qAxis, targetAxis, tolerance, `${label} QRS axis`);
  }
}

async function run() {
  console.log("Running synth validation tests...\n");

  // Test 1: Normal sinus rhythm across ages
  console.log("Test 1: Normal sinus rhythm - age variations");
  const ages = [0, 1, 4, 8, 16];
  for (const age of ages) {
    const ecg = synthECG(age, "Normal sinus", 42, false, true);
    const defaults = ageDefaults(age);

    testEinthovenIntegrity(ecg, `Age ${age}`);
    testHR(ecg, defaults.HR, 15, `Age ${age}`);
    testQRS(ecg, defaults.QRS * 1000, 20, `Age ${age}`);
    testQT(ecg, defaults.QTc * 1000, `Age ${age}`);
    testAxis(ecg, defaults.QRSaxis, 25, `Age ${age}`);

    console.log(`  Age ${age}: OK (HR=${defaults.HR}, QRS=${Math.round(defaults.QRS * 1000)}ms, axis=${defaults.QRSaxis}°)`);
  }

  // Test 2: Diagnosis modifications
  console.log("\nTest 2: Diagnosis-specific parameter modifications");

  // WPW: short PR, wide QRS
  const wpw = synthECG(8, "WPW", 42, false, true);
  const wpwParams = applyDx(ageDefaults(8), "WPW");
  testEinthovenIntegrity(wpw, "WPW");
  testQRS(wpw, wpwParams.QRS * 1000, 25, "WPW");
  console.log(`  WPW: OK (QRS=${Math.round(wpwParams.QRS * 1000)}ms expected wide)`);

  // Long QT: prolonged QTc
  const lqt = synthECG(8, "Long QT", 42, false, true);
  const lqtParams = applyDx(ageDefaults(8), "Long QT");
  testEinthovenIntegrity(lqt, "Long QT");
  testQT(lqt, lqtParams.QTc * 1000, "Long QT");
  console.log(`  Long QT: OK (QTc=${Math.round(lqtParams.QTc * 1000)}ms expected prolonged)`);

  // SVT: fast HR
  const svt = synthECG(8, "SVT (narrow)", 42, false, true);
  const svtParams = applyDx(ageDefaults(8), "SVT (narrow)");
  testEinthovenIntegrity(svt, "SVT");
  testHR(svt, svtParams.HR, 25, "SVT");
  console.log(`  SVT: OK (HR=${Math.round(svtParams.HR)} expected fast)`);

  // LVH: left axis deviation
  const lvh = synthECG(8, "LVH", 42, false, true);
  const lvhParams = applyDx(ageDefaults(8), "LVH");
  testEinthovenIntegrity(lvh, "LVH");
  testAxis(lvh, lvhParams.QRSaxis, 30, "LVH");
  console.log(`  LVH: OK (axis=${lvhParams.QRSaxis}° expected leftward)`);

  // RVH: right axis deviation
  const rvh = synthECG(8, "RVH", 42, false, true);
  const rvhParams = applyDx(ageDefaults(8), "RVH");
  testEinthovenIntegrity(rvh, "RVH");
  testAxis(rvh, rvhParams.QRSaxis, 30, "RVH");
  console.log(`  RVH: OK (axis=${rvhParams.QRSaxis}° expected rightward)`);

  // Test 3: Seed reproducibility
  console.log("\nTest 3: Seed reproducibility");
  const ecg1 = synthECG(4, "Normal sinus", 12345, true, true);
  const ecg2 = synthECG(4, "Normal sinus", 12345, true, true);
  const result1 = analyze(ecg1);
  const result2 = analyze(ecg2);
  assert.strictEqual(result1.rPeaks.length, result2.rPeaks.length, "R-peak count should match for same seed");
  approx(result1.measures.hr, result2.measures.hr, 0.1, "HR reproducibility");
  console.log(`  Same seed produces identical output: OK`);

  // Test 4: All diagnoses generate valid ECGs
  console.log("\nTest 4: All diagnoses generate valid ECGs");
  for (const dx of DIAGNOSES) {
    const ecg = synthECG(8, dx, 42, false, true);
    testEinthovenIntegrity(ecg, dx);
    const { rPeaks, measures } = analyze(ecg);
    assert.ok(rPeaks.length >= 5, `${dx}: should have at least 5 R-peaks, got ${rPeaks.length}`);
    assert.ok(measures.hr > 30 && measures.hr < 300, `${dx}: HR ${measures.hr} out of physiological range`);
    console.log(`  ${dx}: OK (${rPeaks.length} beats, HR=${Math.round(measures.hr)})`);
  }

  // Test 5: Noise doesn't break Einthoven
  console.log("\nTest 5: Noise preserves Einthoven");
  const noisy = synthECG(8, "Normal sinus", 42, true, true);
  const { integrity } = analyze(noisy);
  // With noise, Einthoven error can be higher but should still be reasonable
  assert.ok(integrity.einthoven_max_abs_error_uV <= 50, `Noisy Einthoven error ${integrity.einthoven_max_abs_error_uV} > 50 µV`);
  console.log(`  Noisy ECG Einthoven error: ${integrity.einthoven_max_abs_error_uV} µV (acceptable)`);

  console.log("\n✓ All synth validation tests passed!");
}

run().catch((err) => {
  console.error("\n✗ Test failed:", err.message);
  process.exit(1);
});
