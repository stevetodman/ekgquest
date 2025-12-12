import assert from "assert";
import fs from "fs/promises";
import {
  normalizeECGData,
  physicsChecks,
  detectRPeaks,
  buildMedianBeat,
  fiducialsFromMedian,
  buildFullFiducialsFromMedian,
  computeGlobalMeasurements,
} from "../viewer/js/ecg-core.js";

async function load(relativePath) {
  const raw = JSON.parse(await fs.readFile(new URL(relativePath, import.meta.url), "utf8"));
  return normalizeECGData(raw);
}

async function smoke(meta) {
  const integrity = physicsChecks(meta.leads_uV);
  Object.values(integrity).forEach((v) => assert.ok(Number.isFinite(v)));

  const rPeaks = detectRPeaks(meta);
  assert.ok(rPeaks.length >= 6, "expected multiple R peaks");

  const medBeat = buildMedianBeat(meta, rPeaks);
  assert.ok(medBeat.ok, medBeat.reason || "median beat failed");

  const fids = fiducialsFromMedian(medBeat, meta.duration_s ? meta.duration_s / (rPeaks.length || 1) : undefined);
  const fullFids = buildFullFiducialsFromMedian(meta, rPeaks, fids);
  assert.strictEqual(fullFids.rPeaks.length, rPeaks.length);

  const measures = computeGlobalMeasurements(meta, rPeaks, medBeat, fids);
  assert.ok(measures.QRS && measures.QRS > 0 && measures.QRS < 200, "QRS width out of range");
  assert.ok(measures.hr && measures.hr > 50 && measures.hr < 200, "HR out of range");

  return { rPeaks: rPeaks.length, hr: measures.hr, QRS: measures.QRS };
}

async function run() {
  const world = await load("../data/ecg_data_v5_world_class.json");
  const basic = await load("../data/ecg_data.json");

  const worldStats = await smoke(world);
  const basicStats = await smoke(basic);

  console.log("world-class sample", worldStats);
  console.log("basic sample", basicStats);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
