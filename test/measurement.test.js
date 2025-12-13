import assert from "assert";
import fs from "fs/promises";

import {
  normalizeECGData,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  buildFullFiducialsFromMedian,
  computeGlobalMeasurements,
  mean,
} from "../viewer/js/ecg-core.js";

function approx(actual, expected, tol, label = "value") {
  assert.ok(Number.isFinite(actual), `${label} not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}±${tol}, got ${actual}`);
}

async function load(relativePath) {
  const raw = JSON.parse(await fs.readFile(new URL(relativePath, import.meta.url), "utf8"));
  return normalizeECGData(raw);
}

function analyze(meta) {
  const rPeaks = detectRPeaks(meta);
  const medBeat = buildMedianBeat(meta, rPeaks, 0.25, 0.55);
  assert.ok(medBeat.ok, medBeat.reason || "median beat failed");

  let rrMean = null;
  if (rPeaks.length >= 2) {
    const rrs = [];
    for (let i = 1; i < rPeaks.length; i++) rrs.push((rPeaks[i] - rPeaks[i - 1]) / meta.fs);
    rrMean = mean(rrs);
  }
  const medFids = fiducialsFromMedian(medBeat, rrMean);
  const fiducials = buildFullFiducialsFromMedian(meta, rPeaks, medFids);
  const measures = computeGlobalMeasurements(meta, rPeaks, medBeat, medFids);
  return { rPeaks, medBeat, medFids, fiducials, measures };
}

function assertRoundTrip(fiducials, rPeaks, medFids) {
  assert.strictEqual(fiducials.qOn.length, rPeaks.length, "qOn length mismatch");
  assert.strictEqual(fiducials.qOff.length, rPeaks.length, "qOff length mismatch");
  if (medFids.rel_qOn != null) {
    for (let i = 0; i < Math.min(4, rPeaks.length); i++) {
      approx(fiducials.qOn[i] - rPeaks[i], medFids.rel_qOn, 1, "qOn rel");
    }
  }
  if (medFids.rel_qOff != null) {
    for (let i = 0; i < Math.min(4, rPeaks.length); i++) {
      approx(fiducials.qOff[i] - rPeaks[i], medFids.rel_qOff, 1, "qOff rel");
    }
  }
  if (medFids.rel_tEnd != null) {
    for (let i = 0; i < Math.min(4, rPeaks.length); i++) {
      approx(fiducials.tEnd[i] - rPeaks[i], medFids.rel_tEnd, 2, "tEnd rel");
    }
  }
}

async function run() {
  const world = await load("../data/ecg_data_v5_world_class.json");
  const worldRes = analyze(world);
  assert.strictEqual(worldRes.rPeaks.length, 15, "world rPeaks count");
  approx(worldRes.medFids.rel_qOn, -28, 1, "world rel_qOn");
  approx(worldRes.medFids.rel_qOff, 29, 1, "world rel_qOff");
  approx(worldRes.medFids.rel_tEnd, 364, 2, "world rel_tEnd");
  approx(worldRes.measures.QRS, 57, 2, "world QRS");
  approx(worldRes.measures.QT, 392, 3, "world QT");
  approx(worldRes.measures.QTcB, 505.8, 3, "world QTcB");
  approx(worldRes.measures.QTcF, 464.6, 3, "world QTcF");
  approx(worldRes.measures.QTcFram, 453.5, 2, "world QTcFram");
  approx(worldRes.measures.axes.qAxis, 70.6, 1, "world QRS axis");
  approx(worldRes.measures.axes.tAxis, 49.9, 1, "world T axis");
  assertRoundTrip(worldRes.fiducials, worldRes.rPeaks, worldRes.medFids);

  const basic = await load("../data/ecg_data.json");
  const basicRes = analyze(basic);
  assert.strictEqual(basicRes.rPeaks.length, 16, "basic rPeaks count");
  approx(basicRes.medFids.rel_qOn, -50, 2, "basic rel_qOn");
  approx(basicRes.medFids.rel_qOff, 50, 2, "basic rel_qOff");
  approx(basicRes.medFids.rel_tEnd, 327, 2, "basic rel_tEnd");
  approx(basicRes.measures.QRS, 100, 3, "basic QRS");
  approx(basicRes.measures.QT, 377, 3, "basic QT");
  approx(basicRes.measures.QTcB, 486.7, 3, "basic QTcB");
  approx(basicRes.measures.QTcF, 447.0, 3, "basic QTcF");
  approx(basicRes.measures.QTcFram, 438.6, 3, "basic QTcFram");
  assert.ok(basicRes.measures.axes.qAxis != null, "basic axis should be present");
  assertRoundTrip(basicRes.fiducials, basicRes.rPeaks, basicRes.medFids);

  console.log("measurement harness ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
