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

  // Test Module 1: Rhythm Model
  console.log("\nTest 2: Module 1 - Rhythm Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42);

    assert.ok(beatSchedule.beats.length > 0, "Should generate beats");
    assert.ok(beatSchedule.RR > 0, "Should have RR interval");
    assert.ok(beatSchedule.pWaveTimes.length > 0, "Should have P wave times");

    // All normal beats should have P wave and QRS
    const normalBeats = beatSchedule.beats.filter(b => b.hasPWave && b.hasQRS);
    assert.ok(normalBeats.length > 0, "Should have normal beats");
    console.log(`  Normal sinus: ${beatSchedule.beats.length} beats, RR=${beatSchedule.RR.toFixed(3)}s`);

    // Test 3rd degree AVB - should have separate P waves and QRS
    const avb3Params = applyDx(ageDefaults(8), "3rd degree AVB");
    const avb3Schedule = rhythmModel(avb3Params, "3rd degree AVB", duration, 42);
    const pOnly = avb3Schedule.beats.filter(b => b.hasPWave && !b.hasQRS);
    const qrsOnly = avb3Schedule.beats.filter(b => !b.hasPWave && b.hasQRS);
    assert.ok(pOnly.length > 0, "3rd degree AVB should have P-only beats");
    assert.ok(qrsOnly.length > 0, "3rd degree AVB should have QRS-only beats");
    console.log(`  3rd degree AVB: ${pOnly.length} P-only, ${qrsOnly.length} QRS-only`);

    // Test PVCs - should have beats marked as PVC
    const pvcParams = applyDx(ageDefaults(8), "PVCs");
    const pvcSchedule = rhythmModel(pvcParams, "PVCs", duration, 42);
    const pvcs = pvcSchedule.beats.filter(b => b.isPVC);
    assert.ok(pvcs.length > 0, "PVCs should have PVC beats");
    console.log(`  PVCs: ${pvcs.length} PVC beats`);
  }

  // Test Module 2: Morphology Model
  console.log("\nTest 3: Module 2 - Morphology Model");
  {
    const params = applyDx(ageDefaults(8), "Normal sinus");
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42);
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
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42);
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
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42);
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
    const beatSchedule = rhythmModel(params, "Normal sinus", duration, 42);
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
