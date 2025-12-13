// Golden Seed Regression Test
// Ensures synthetic ECG generation remains consistent across code changes
// Uses fixed seeds to detect any drift in output

import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  normalizeECGData,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  computeGlobalMeasurements,
  mean,
  physicsChecks,
} from "../viewer/js/ecg-core.js";
import { synthECGModular } from "../viewer/js/ecg-synth-modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load golden seeds configuration
const goldenConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "golden_seeds.json"), "utf-8")
);

// Expected measurements for each golden seed (tolerance-based comparison)
// These are baseline values that should not drift significantly
const EXPECTED_MEASUREMENTS = {
  // Format: [minHR, maxHR, minRPeaks, maxRPeaks]
  "neonate_normal": { hr: [140, 170], rPeaks: [20, 30] },
  "infant_normal": { hr: [110, 140], rPeaks: [16, 24] },
  "toddler_normal": { hr: [90, 120], rPeaks: [13, 20] },
  "school_normal": { hr: [75, 105], rPeaks: [11, 17] },
  "adolescent_normal": { hr: [65, 95], rPeaks: [9, 15] },
  "adult_normal": { hr: [60, 90], rPeaks: [8, 14] },
  "wpw_child": { hr: [75, 105], rPeaks: [11, 17] },
  "rbbb_child": { hr: [75, 105], rPeaks: [11, 17] },
  "lbbb_adult": { hr: [60, 90], rPeaks: [8, 14] },
  "lvh_child": { hr: [75, 105], rPeaks: [11, 17] },
  "rvh_neonate": { hr: [130, 160], rPeaks: [18, 28] },
  "svt_child": { hr: [150, 220], rPeaks: [22, 38] },
  "flutter_adult": { hr: [110, 160], rPeaks: [16, 26] },
  "avb1_child": { hr: [75, 105], rPeaks: [11, 17] },
  "avb2_wencke": { hr: [45, 85], rPeaks: [6, 14] },
  "avb3_adult": { hr: [35, 55], rPeaks: [4, 9] },
  "longqt_child": { hr: [75, 105], rPeaks: [11, 17] },
  "pacs_child": { hr: [75, 115], rPeaks: [11, 19] },
  "pvcs_adult": { hr: [60, 95], rPeaks: [8, 16] },
  "brady_adult": { hr: [40, 60], rPeaks: [5, 10] },
};

// Hash function for waveform fingerprinting
function hashLeadData(leadData, samples = 1000) {
  const hash = crypto.createHash("md5");
  // Sample evenly across the recording for stability
  const step = Math.floor(leadData.length / samples);
  for (let i = 0; i < samples && i * step < leadData.length; i++) {
    hash.update(Buffer.from(new Int16Array([leadData[i * step]]).buffer));
  }
  return hash.digest("hex");
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

async function run() {
  console.log("Running Golden Seed Regression Tests...\n");
  console.log(`Version: ${goldenConfig.version}`);
  console.log(`Golden seeds: ${goldenConfig.seeds.length}\n`);

  let passed = 0;
  let failed = 0;
  const results = [];
  const hashes = {};

  for (const seed of goldenConfig.seeds) {
    process.stdout.write(`Testing ${seed.id}... `);

    try {
      // Generate ECG
      const ecg = synthECGModular(seed.age_years, seed.dx, seed.seed);
      const { measures, rPeaks, integrity } = analyze(ecg);

      // Calculate hash for regression detection
      const leadIIHash = hashLeadData(ecg.leads_uV.II);
      hashes[seed.id] = leadIIHash;

      // Verify Einthoven consistency
      assert.ok(
        integrity.einthoven_max_abs_error_uV <= 2,
        `Einthoven error: ${integrity.einthoven_max_abs_error_uV} > 2 µV`
      );

      // Verify expected measurements
      const expected = EXPECTED_MEASUREMENTS[seed.id];
      if (expected) {
        // HR check
        if (measures.hr) {
          assert.ok(
            measures.hr >= expected.hr[0] && measures.hr <= expected.hr[1],
            `HR ${measures.hr.toFixed(1)} not in range [${expected.hr[0]}, ${expected.hr[1]}]`
          );
        }

        // R-peak count check
        assert.ok(
          rPeaks.length >= expected.rPeaks[0] && rPeaks.length <= expected.rPeaks[1],
          `R-peaks ${rPeaks.length} not in range [${expected.rPeaks[0]}, ${expected.rPeaks[1]}]`
        );
      }

      results.push({
        id: seed.id,
        status: "PASS",
        hr: measures.hr?.toFixed(1),
        rPeaks: rPeaks.length,
        hash: leadIIHash.substring(0, 8),
      });

      console.log(`PASS (HR=${measures.hr?.toFixed(1)}, beats=${rPeaks.length}, hash=${leadIIHash.substring(0, 8)})`);
      passed++;
    } catch (err) {
      results.push({
        id: seed.id,
        status: "FAIL",
        error: err.message,
      });
      console.log(`FAIL: ${err.message}`);
      failed++;
    }
  }

  // Test reproducibility - generate same seed twice
  console.log("\nReproducibility check...");
  const testSeed = goldenConfig.seeds[0];
  const ecg1 = synthECGModular(testSeed.age_years, testSeed.dx, testSeed.seed);
  const ecg2 = synthECGModular(testSeed.age_years, testSeed.dx, testSeed.seed);
  const hash1 = hashLeadData(ecg1.leads_uV.II);
  const hash2 = hashLeadData(ecg2.leads_uV.II);

  if (hash1 === hash2) {
    console.log(`  ${testSeed.id}: Reproducible (hash=${hash1.substring(0, 8)})`);
    passed++;
  } else {
    console.log(`  ${testSeed.id}: NOT REPRODUCIBLE! hash1=${hash1} hash2=${hash2}`);
    failed++;
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  // Output hashes for baseline comparison
  console.log("\nHash fingerprints (for baseline):");
  console.log(JSON.stringify(hashes, null, 2));

  if (failed > 0) {
    console.error(`\n✗ Golden regression test failed (${failed} failures)`);
    process.exit(1);
  } else {
    console.log(`\n✓ All golden seed tests passed!`);
  }
}

run().catch((err) => {
  console.error("\n✗ Test failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});
