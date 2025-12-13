// Test for modular synthesis architecture
// Verifies each module can be tested in isolation

import assert from "assert";
import {
  rhythmModel,
  morphologyModel,
  leadFieldModel,
  deriveLeads,
  deviceAndArtifactModel,
  synthECGModular,
  DEFAULT_ELECTRODE_GEOMETRY,
  DEVICE_PRESETS,
  ARTIFACT_PRESETS,
  norm,
  axisDir,
  mulberry32,
  randn,
  // Wave basis toolkit (Step 2)
  gaussianWave,
  asymmetricGaussian,
  generalizedGaussian,
  hermiteFunction,
  hermiteQRS,
  biphasicWave,
  sigmoid,
  phaseWave,
  WAVE_PRESETS,
  applyWavePreset,
  // HRV toolkit (Step 3)
  getHRVParams,
  modulateRR,
  computeHRVMetrics,
  EctopyStateMachine,
} from "../viewer/js/ecg-synth-modules.js";
import { ageDefaults, applyDx, DIAGNOSES } from "../viewer/js/ecg-synth.js";
import { normalizeECGData, detectRPeaks, physicsChecks } from "../viewer/js/ecg-core.js";

const fs = 1000;
const duration = 10.0;
const N = Math.floor(duration * fs);

function approx(actual, expected, tolerance, label = "value") {
  if (expected == null) return;
  assert.ok(Number.isFinite(actual), `${label} not finite: ${actual}`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${label}: expected ${expected}±${tolerance}, got ${actual}`);
}

async function run() {
  console.log("Testing modular synthesis architecture...\n");

  // Test utilities
  console.log("Test 1: Utility functions");
  {
    const v = norm([3, 4, 0]);
    approx(Math.hypot(...v), 1.0, 0.001, "norm length");
    console.log("  norm(): OK");

    const d = axisDir(60, 0.5);
    approx(Math.hypot(...d), 1.0, 0.001, "axisDir length");
    console.log("  axisDir(): OK");

    const rng = mulberry32(12345);
    const vals = [rng(), rng(), rng()];
    assert.ok(vals.every(v => v >= 0 && v < 1), "RNG values in [0,1)");
    console.log("  mulberry32(): OK");

    const rng2 = mulberry32(12345);
    const vals2 = [rng2(), rng2(), rng2()];
    assert.deepStrictEqual(vals, vals2, "RNG is deterministic");
    console.log("  RNG determinism: OK");
  }

  // Test Wave Basis Toolkit (Step 2)
  console.log("\nTest 1b: Wave Basis Toolkit");
  {
    // Test standard Gaussian
    const gPeak = gaussianWave(0.5, 0.5, 0.1, 1.0);
    approx(gPeak, 1.0, 0.001, "Gaussian peak");
    const gTail = gaussianWave(1.0, 0.5, 0.1, 1.0);
    assert.ok(gTail < 0.001, "Gaussian tail should be near zero");
    console.log("  gaussianWave(): OK");

    // Test asymmetric Gaussian
    const agLeft = asymmetricGaussian(0.4, 0.5, 0.05, 0.1, 1.0);
    const agRight = asymmetricGaussian(0.6, 0.5, 0.05, 0.1, 1.0);
    assert.ok(agLeft < agRight, "Asymmetric Gaussian: narrower left sigma = steeper rise");
    console.log("  asymmetricGaussian(): OK");

    // Test generalized Gaussian (shape parameter)
    const ggSharp = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 1.5); // sharper
    const ggNormal = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 2.0); // standard
    const ggFlat = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 3.0); // flatter
    assert.ok(ggSharp < ggNormal, "Lower p = sharper drop");
    assert.ok(ggNormal < ggFlat, "Higher p = flatter top");
    console.log("  generalizedGaussian(): OK");

    // Test Hermite functions
    const h0 = hermiteFunction(0, 0);
    const h1_at_0 = hermiteFunction(0, 1);
    const h1_at_1 = hermiteFunction(1, 1);
    assert.ok(h0 > 0, "H0 at center should be positive");
    approx(h1_at_0, 0, 0.001, "H1 at center should be zero (odd function)");
    assert.ok(h1_at_1 > 0, "H1 at t=1 should be positive");
    console.log("  hermiteFunction(): OK");

    // Test Hermite QRS
    const qrs = hermiteQRS(0, 0.02, [0, 1, 0.2, 0]);
    assert.ok(Number.isFinite(qrs), "Hermite QRS should produce finite value");
    console.log("  hermiteQRS(): OK");

    // Test biphasic wave
    const bp = biphasicWave(0.5, 0.4, 0.6, 0.05, 0.05, -0.5, 0.5);
    assert.ok(Number.isFinite(bp), "Biphasic wave should produce finite value");
    console.log("  biphasicWave(): OK");

    // Test sigmoid
    const sigLow = sigmoid(0.4, 0.5, 0.01);
    const sigMid = sigmoid(0.5, 0.5, 0.01);
    const sigHigh = sigmoid(0.6, 0.5, 0.01);
    assert.ok(sigLow < 0.1, "Sigmoid before transition should be low");
    approx(sigMid, 0.5, 0.01, "Sigmoid at center should be 0.5");
    assert.ok(sigHigh > 0.9, "Sigmoid after transition should be high");
    console.log("  sigmoid(): OK");

    // Test phase wave
    const pw = phaseWave(0.5, 0.5, 0.1, 1.0);
    approx(pw, 1.0, 0.001, "Phase wave at peak");
    console.log("  phaseWave(): OK");

    // Test wave presets exist
    assert.ok(WAVE_PRESETS.P_NORMAL, "P_NORMAL preset should exist");
    assert.ok(WAVE_PRESETS.QRS_NARROW, "QRS_NARROW preset should exist");
    assert.ok(WAVE_PRESETS.T_NORMAL, "T_NORMAL preset should exist");
    console.log("  WAVE_PRESETS: OK");

    // Test applyWavePreset
    const Vx = new Float64Array(1000);
    const Vy = new Float64Array(1000);
    const Vz = new Float64Array(1000);
    applyWavePreset(Vx, Vy, Vz, 1000, 0.5, WAVE_PRESETS.P_NORMAL, [1, 0, 0], 1.0);
    const maxVx = Math.max(...Vx);
    assert.ok(maxVx > 0, "applyWavePreset should add to signal");
    console.log("  applyWavePreset(): OK");
  }

  // Test HRV Toolkit (Step 3)
  console.log("\nTest 1c: HRV Toolkit");
  {
    // Test getHRVParams for different ages
    const hrvNeonate = getHRVParams(0.5);
    const hrvChild = getHRVParams(8);
    const hrvAdult = getHRVParams(35);
    const hrvElderly = getHRVParams(70);

    // Neonates should have highest RSA amplitude
    assert.ok(hrvNeonate.rsaAmp > hrvChild.rsaAmp, "Neonate RSA > Child RSA");
    assert.ok(hrvChild.rsaAmp > hrvAdult.rsaAmp, "Child RSA > Adult RSA");
    assert.ok(hrvAdult.rsaAmp > hrvElderly.rsaAmp, "Adult RSA > Elderly RSA");
    console.log("  getHRVParams() age scaling: OK");

    // Respiratory frequency should be higher in younger patients
    assert.ok(hrvNeonate.rsaFreq > hrvChild.rsaFreq, "Neonate resp rate > Child");
    assert.ok(hrvChild.rsaFreq > hrvAdult.rsaFreq, "Child resp rate > Adult");
    console.log("  getHRVParams() respiratory scaling: OK");

    // Test modulateRR
    const rng = mulberry32(12345);
    const phases = { rsa: 0, lf: Math.PI / 2, vlf: Math.PI };
    const RR0 = 0.8; // 75 bpm

    // Generate several RR intervals
    const rrIntervals = [];
    for (let t = 0; t < 10; t += 0.8) {
      const rr = modulateRR(RR0, t, hrvAdult, phases, rng);
      rrIntervals.push(rr);
      assert.ok(rr > 0.3 && rr < 1.5, `RR ${rr} should be in physiological range`);
    }
    console.log("  modulateRR(): OK");

    // Test that RR intervals vary (HRV exists)
    const rrMean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const rrVariance = rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - rrMean, 2), 0) / rrIntervals.length;
    assert.ok(rrVariance > 0.0001, "RR intervals should have variance (HRV)");
    console.log(`  RR variability: mean=${rrMean.toFixed(3)}, variance=${rrVariance.toFixed(6)}`);

    // Test computeHRVMetrics
    const hrvMetrics = computeHRVMetrics(rrIntervals);
    assert.ok(hrvMetrics.meanRR > 0, "meanRR should be positive");
    assert.ok(hrvMetrics.SDNN >= 0, "SDNN should be non-negative");
    assert.ok(hrvMetrics.RMSSD >= 0, "RMSSD should be non-negative");
    assert.ok(hrvMetrics.pNN50 >= 0 && hrvMetrics.pNN50 <= 100, "pNN50 should be 0-100%");
    console.log(`  computeHRVMetrics(): SDNN=${hrvMetrics.SDNN.toFixed(1)}ms, RMSSD=${hrvMetrics.RMSSD.toFixed(1)}ms`);

    // Test EctopyStateMachine
    const ectopyRng = mulberry32(54321);
    const pvcMachine = new EctopyStateMachine(ectopyRng, 'PVC', 0.15);
    let ectopicCount = 0;
    for (let i = 0; i < 50; i++) {
      const { isEctopic, couplingInterval } = pvcMachine.nextBeat(i);
      if (isEctopic) {
        ectopicCount++;
        assert.ok(couplingInterval >= 0.5 && couplingInterval <= 0.8, "Coupling interval in range");
      }
    }
    assert.ok(ectopicCount > 0, "Should generate some ectopic beats");
    assert.ok(ectopicCount < 25, "Should not generate too many ectopic beats");
    console.log(`  EctopyStateMachine: ${ectopicCount}/50 ectopic beats`);

    // Test 'none' ectopy type
    const noEctopy = new EctopyStateMachine(ectopyRng, 'none', 0.15);
    let noEctopyCount = 0;
    for (let i = 0; i < 20; i++) {
      if (noEctopy.nextBeat(i).isEctopic) noEctopyCount++;
    }
    assert.strictEqual(noEctopyCount, 0, "No ectopy when type is 'none'");
    console.log("  EctopyStateMachine 'none' mode: OK");
  }

  // Test Module 1: Rhythm Model
  console.log("\nTest 2: Module 1 - Rhythm Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42, 8);

    assert.ok(beatSchedule.beats.length > 0, "Should generate beats");
    assert.ok(beatSchedule.RR > 0, "Should have RR interval");
    assert.ok(beatSchedule.pWaveTimes.length > 0, "Should have P wave times");
    assert.ok(beatSchedule.rrIntervals.length > 0, "Should have RR intervals array");
    assert.ok(beatSchedule.hrvParams, "Should have HRV params");
    assert.ok(beatSchedule.hrvMetrics, "Should have HRV metrics");

    // Verify HRV metrics are computed
    assert.ok(beatSchedule.hrvMetrics.SDNN > 0, "SDNN should be positive for normal sinus");
    console.log(`  HRV metrics: SDNN=${beatSchedule.hrvMetrics.SDNN.toFixed(1)}ms, RMSSD=${beatSchedule.hrvMetrics.RMSSD.toFixed(1)}ms`);

    // All normal beats should have P wave and QRS
    const normalBeats = beatSchedule.beats.filter(b => b.hasPWave && b.hasQRS);
    assert.ok(normalBeats.length > 0, "Should have normal beats");
    console.log(`  Normal sinus: ${beatSchedule.beats.length} beats, RR=${beatSchedule.RR.toFixed(3)}s`);

    // Test 3rd degree AVB - should have separate P waves and QRS (no HRV due to complete block)
    const avb3Params = applyDx(ageDefaults(8), "3rd degree AVB");
    const avb3Schedule = rhythmModel(avb3Params, "3rd degree AVB", duration, 42, 8);
    const pOnly = avb3Schedule.beats.filter(b => b.hasPWave && !b.hasQRS);
    const qrsOnly = avb3Schedule.beats.filter(b => !b.hasPWave && b.hasQRS);
    assert.ok(pOnly.length > 0, "3rd degree AVB should have P-only beats");
    assert.ok(qrsOnly.length > 0, "3rd degree AVB should have QRS-only beats");
    console.log(`  3rd degree AVB: ${pOnly.length} P-only, ${qrsOnly.length} QRS-only`);

    // Test PVCs - should have beats marked as PVC (using state machine)
    const pvcParams = applyDx(ageDefaults(8), "PVCs");
    const pvcSchedule = rhythmModel(pvcParams, "PVCs", duration, 42, 8);
    const pvcs = pvcSchedule.beats.filter(b => b.isPVC);
    assert.ok(pvcs.length > 0, "PVCs should have PVC beats");
    console.log(`  PVCs: ${pvcs.length} PVC beats`);

    // Test PACs - should have early beats with shortened coupling
    const pacParams = applyDx(ageDefaults(8), "PACs");
    const pacSchedule = rhythmModel(pacParams, "PACs", duration, 42, 8);
    const pacs = pacSchedule.beats.filter(b => b.isPAC);
    assert.ok(pacs.length > 0, "PACs should have PAC beats");
    console.log(`  PACs: ${pacs.length} PAC beats`);
  }

  // Test Module 2: Morphology Model
  console.log("\nTest 3: Module 2 - Morphology Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42, 8);
    const vcg = morphologyModel(beatSchedule, params, "Normal sinus", fs, N, 42);

    assert.ok(vcg.Vx instanceof Float64Array, "Vx should be Float64Array");
    assert.ok(vcg.Vy instanceof Float64Array, "Vy should be Float64Array");
    assert.ok(vcg.Vz instanceof Float64Array, "Vz should be Float64Array");
    assert.strictEqual(vcg.Vx.length, N, "Vx length should match N");

    // Check VCG has non-zero values (waveforms generated)
    const maxVx = Math.max(...vcg.Vx.map(Math.abs));
    const maxVy = Math.max(...vcg.Vy.map(Math.abs));
    const maxVz = Math.max(...vcg.Vz.map(Math.abs));
    assert.ok(maxVx > 0.1, "Vx should have significant amplitude");
    assert.ok(maxVy > 0.1, "Vy should have significant amplitude");
    console.log(`  VCG generated: maxVx=${maxVx.toFixed(3)}, maxVy=${maxVy.toFixed(3)}, maxVz=${maxVz.toFixed(3)}`);
  }

  // Test Module 3: Lead Field Model
  console.log("\nTest 4: Module 3 - Lead Field Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42, 8);
    const vcg = morphologyModel(beatSchedule, params, "Normal sinus", fs, N, 42);
    const phi = leadFieldModel(vcg);

    assert.ok(phi.phiRA instanceof Float64Array, "phiRA should be Float64Array");
    assert.ok(phi.phiLA instanceof Float64Array, "phiLA should be Float64Array");
    assert.ok(phi.phiLL instanceof Float64Array, "phiLL should be Float64Array");
    assert.ok(phi.phiV1 instanceof Float64Array, "phiV1 should be Float64Array");

    // Check electrode potentials have values
    const maxRA = Math.max(...phi.phiRA.map(Math.abs));
    const maxV1 = Math.max(...phi.phiV1.map(Math.abs));
    assert.ok(maxRA > 0, "phiRA should have non-zero values");
    assert.ok(maxV1 > 0, "phiV1 should have non-zero values");
    console.log(`  Electrode potentials: maxRA=${maxRA.toFixed(3)}, maxV1=${maxV1.toFixed(3)}`);

    // Test custom electrode geometry
    const customGeometry = { ...DEFAULT_ELECTRODE_GEOMETRY };
    customGeometry.V1 = norm([-0.8, 0.0, 1.0]); // Slightly different V1 position
    const phiCustom = leadFieldModel(vcg, customGeometry);
    assert.ok(phiCustom.phiV1 instanceof Float64Array, "Custom geometry should work");
    console.log("  Custom electrode geometry: OK");
  }

  // Test Module 4: Derive Leads
  console.log("\nTest 5: Module 4 - Derive Leads");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42, 8);
    const vcg = morphologyModel(beatSchedule, params, "Normal sinus", fs, N, 42);
    const phi = leadFieldModel(vcg);
    const leads = deriveLeads(phi);

    // Check all 15 leads exist
    const expectedLeads = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6", "V3R", "V4R", "V7"];
    for (const lead of expectedLeads) {
      assert.ok(leads[lead] instanceof Float64Array, `Lead ${lead} should be Float64Array`);
      assert.strictEqual(leads[lead].length, N, `Lead ${lead} length should match N`);
    }
    console.log(`  All ${expectedLeads.length} leads derived`);

    // Verify Einthoven's law: I + III = II
    let maxError = 0;
    for (let i = 0; i < N; i++) {
      const err = Math.abs((leads.I[i] + leads.III[i]) - leads.II[i]);
      maxError = Math.max(maxError, err);
    }
    assert.ok(maxError < 0.001, `Einthoven error ${maxError} should be < 0.001`);
    console.log(`  Einthoven's law verified: max error = ${maxError.toExponential(2)}`);
  }

  // Test Module 5: Device and Artifact Model
  console.log("\nTest 6: Module 5 - Device and Artifact Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42, 8);
    const vcg = morphologyModel(beatSchedule, params, "Normal sinus", fs, N, 42);
    const phi = leadFieldModel(vcg);

    // Test with no noise
    const leadsClean = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.none, DEVICE_PRESETS.diagnostic, false, true);
    assert.ok(leadsClean.I instanceof Float64Array, "Clean leads should work");

    // Test with typical noise
    const leadsNoisy = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.typical, DEVICE_PRESETS.diagnostic, true, true);
    assert.ok(leadsNoisy.I instanceof Float64Array, "Noisy leads should work");

    // Test monitor mode
    const leadsMonitor = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.typical, DEVICE_PRESETS.monitor, true, true);
    assert.ok(leadsMonitor.I instanceof Float64Array, "Monitor mode should work");

    console.log("  All device/artifact presets work");
  }

  // Test integrated synthesis
  console.log("\nTest 7: Integrated Modular Synthesis");
  {
    const ecg = synthECGModular(8, "Normal sinus", 42);

    assert.strictEqual(ecg.fs, 1000, "Sample rate should be 1000");
    assert.strictEqual(ecg.duration_s, 10.0, "Duration should be 10s");
    assert.ok(ecg.targets.synthetic === true, "Should be marked synthetic");
    assert.ok(ecg.targets.generator_version, "Should have generator version");
    assert.ok(ecg.targets.generator_version.includes("hrv"), "Generator version should include 'hrv'");

    // Verify HRV metrics are included in output
    assert.ok(ecg.targets.hrv, "Should include HRV metrics in targets");
    assert.ok(ecg.targets.hrv.SDNN >= 0, "SDNN should be present and non-negative");
    assert.ok(ecg.targets.hrv.RMSSD >= 0, "RMSSD should be present and non-negative");
    console.log(`  HRV in output: SDNN=${ecg.targets.hrv.SDNN.toFixed(1)}ms, RMSSD=${ecg.targets.hrv.RMSSD.toFixed(1)}ms`);

    // Verify with analysis pipeline
    const meta = normalizeECGData(ecg);
    const rPeaks = detectRPeaks(meta);
    const integrity = physicsChecks(meta.leads_uV);

    assert.ok(rPeaks.length >= 5, `Should have R-peaks, got ${rPeaks.length}`);
    assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `Einthoven error ${integrity.einthoven_max_abs_error_uV} > 2 µV`);

    console.log(`  Generated ECG: ${rPeaks.length} beats, Einthoven err=${integrity.einthoven_max_abs_error_uV} µV`);
  }

  // Test all diagnoses with modular synthesis
  console.log("\nTest 8: All diagnoses with modular synthesis");
  {
    for (const dx of DIAGNOSES) {
      const ecg = synthECGModular(8, dx, 42);
      const meta = normalizeECGData(ecg);
      const rPeaks = detectRPeaks(meta);
      const integrity = physicsChecks(meta.leads_uV);

      assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `${dx}: Einthoven error ${integrity.einthoven_max_abs_error_uV} > 2 µV`);
      console.log(`  ${dx}: OK (${rPeaks.length} beats)`);
    }
  }

  // Test seed reproducibility
  console.log("\nTest 9: Seed reproducibility");
  {
    const ecg1 = synthECGModular(4, "Normal sinus", 12345);
    const ecg2 = synthECGModular(4, "Normal sinus", 12345);

    const meta1 = normalizeECGData(ecg1);
    const meta2 = normalizeECGData(ecg2);
    const rPeaks1 = detectRPeaks(meta1);
    const rPeaks2 = detectRPeaks(meta2);

    assert.strictEqual(rPeaks1.length, rPeaks2.length, "R-peak count should match for same seed");

    // Compare a few lead values
    let maxDiff = 0;
    for (let i = 0; i < 100; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(meta1.leads_uV.II[i] - meta2.leads_uV.II[i]));
    }
    assert.strictEqual(maxDiff, 0, "Same seed should produce identical output");
    console.log("  Seed reproducibility: OK");
  }

  console.log("\n✓ All modular synthesis tests passed!");
}

run().catch((err) => {
  console.error("\n✗ Test failed:", err.message);
  process.exit(1);
});
