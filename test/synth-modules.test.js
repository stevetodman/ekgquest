// Test for modular synthesis architecture
// Verifies each module can be tested in isolation

import { describe, it } from 'vitest';
import assert from 'assert';
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
  // Lead-field model (Step 4)
  getHeartOrientationParams,
  createRotationMatrix,
  generateHeartOrientation,
  // Device model (Step 6)
  calcBiquadCoeffs,
  applyBiquad,
  applyNotchFilter,
  applyLowpass2,
  applyHighpass2,
  simulateADC,
  downsample,
  // Pediatric priors (Step 7)
  PEDIATRIC_PRIORS,
  getAgeBin,
  samplePediatricPriors,
  computeZScore,
  checkNormalLimits,
  // Beat-to-beat jitter
  generateBeatJitter,
  // Diagnoses and parameter modifiers
  ageDefaults,
  applyDx,
  DIAGNOSES,
} from '../viewer/js/ecg-synth-modules.js';
import { normalizeECGData, detectRPeaks, physicsChecks } from '../viewer/js/ecg-core.js';

const fs = 1000;
const duration = 10.0;
const N = Math.floor(duration * fs);

function approx(actual, expected, tolerance, label = 'value') {
  if (expected == null) return;
  assert.ok(Number.isFinite(actual), `${label} not finite: ${actual}`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${label}: expected ${expected}±${tolerance}, got ${actual}`);
}

describe('Modular Synthesis Architecture', () => {
  describe('Utility Functions', () => {
    it('norm() should normalize vectors', () => {
      const v = norm([3, 4, 0]);
      approx(Math.hypot(...v), 1.0, 0.001, 'norm length');
    });

    it('axisDir() should create unit direction vectors', () => {
      const d = axisDir(60, 0.5);
      approx(Math.hypot(...d), 1.0, 0.001, 'axisDir length');
    });

    it('mulberry32() should generate deterministic random numbers', () => {
      const rng = mulberry32(12345);
      const vals = [rng(), rng(), rng()];
      assert.ok(vals.every((v) => v >= 0 && v < 1), 'RNG values in [0,1)');

      const rng2 = mulberry32(12345);
      const vals2 = [rng2(), rng2(), rng2()];
      assert.deepStrictEqual(vals, vals2, 'RNG is deterministic');
    });
  });

  describe('Wave Basis Toolkit', () => {
    it('gaussianWave() should produce correct waveform', () => {
      const gPeak = gaussianWave(0.5, 0.5, 0.1, 1.0);
      approx(gPeak, 1.0, 0.001, 'Gaussian peak');
      const gTail = gaussianWave(1.0, 0.5, 0.1, 1.0);
      assert.ok(gTail < 0.001, 'Gaussian tail should be near zero');
    });

    it('asymmetricGaussian() should have asymmetric slopes', () => {
      const agLeft = asymmetricGaussian(0.4, 0.5, 0.05, 0.1, 1.0);
      const agRight = asymmetricGaussian(0.6, 0.5, 0.05, 0.1, 1.0);
      assert.ok(agLeft < agRight, 'Asymmetric Gaussian: narrower left sigma = steeper rise');
    });

    it('generalizedGaussian() should vary with shape parameter', () => {
      const ggSharp = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 1.5);
      const ggNormal = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 2.0);
      const ggFlat = generalizedGaussian(0.45, 0.5, 0.1, 1.0, 3.0);
      assert.ok(ggSharp < ggNormal, 'Lower p = sharper drop');
      assert.ok(ggNormal < ggFlat, 'Higher p = flatter top');
    });

    it('hermiteFunction() should produce correct values', () => {
      const h0 = hermiteFunction(0, 0);
      const h1_at_0 = hermiteFunction(0, 1);
      const h1_at_1 = hermiteFunction(1, 1);
      assert.ok(h0 > 0, 'H0 at center should be positive');
      approx(h1_at_0, 0, 0.001, 'H1 at center should be zero (odd function)');
      assert.ok(h1_at_1 > 0, 'H1 at t=1 should be positive');
    });

    it('hermiteQRS() should produce finite values', () => {
      const qrs = hermiteQRS(0, 0.02, [0, 1, 0.2, 0]);
      assert.ok(Number.isFinite(qrs), 'Hermite QRS should produce finite value');
    });

    it('biphasicWave() should produce finite values', () => {
      const bp = biphasicWave(0.5, 0.4, 0.6, 0.05, 0.05, -0.5, 0.5);
      assert.ok(Number.isFinite(bp), 'Biphasic wave should produce finite value');
    });

    it('sigmoid() should transition correctly', () => {
      const sigLow = sigmoid(0.4, 0.5, 0.01);
      const sigMid = sigmoid(0.5, 0.5, 0.01);
      const sigHigh = sigmoid(0.6, 0.5, 0.01);
      assert.ok(sigLow < 0.1, 'Sigmoid before transition should be low');
      approx(sigMid, 0.5, 0.01, 'Sigmoid at center should be 0.5');
      assert.ok(sigHigh > 0.9, 'Sigmoid after transition should be high');
    });

    it('phaseWave() should produce correct amplitude at peak', () => {
      const pw = phaseWave(0.5, 0.5, 0.1, 1.0);
      approx(pw, 1.0, 0.001, 'Phase wave at peak');
    });

    it('WAVE_PRESETS should have required presets', () => {
      assert.ok(WAVE_PRESETS.P_NORMAL, 'P_NORMAL preset should exist');
      assert.ok(WAVE_PRESETS.QRS_NARROW, 'QRS_NARROW preset should exist');
      assert.ok(WAVE_PRESETS.T_NORMAL, 'T_NORMAL preset should exist');
    });

    it('applyWavePreset() should add to signal', () => {
      const Vx = new Float64Array(1000);
      const Vy = new Float64Array(1000);
      const Vz = new Float64Array(1000);
      applyWavePreset(Vx, Vy, Vz, 1000, 0.5, WAVE_PRESETS.P_NORMAL, [1, 0, 0], 1.0);
      const maxVx = Math.max(...Vx);
      assert.ok(maxVx > 0, 'applyWavePreset should add to signal');
    });
  });

  describe('HRV Toolkit', () => {
    it('getHRVParams() should scale with age', () => {
      const hrvNeonate = getHRVParams(0.5);
      const hrvChild = getHRVParams(8);
      const hrvAdult = getHRVParams(35);
      const hrvElderly = getHRVParams(70);

      assert.ok(hrvNeonate.rsaAmp > hrvChild.rsaAmp, 'Neonate RSA > Child RSA');
      assert.ok(hrvChild.rsaAmp > hrvAdult.rsaAmp, 'Child RSA > Adult RSA');
      assert.ok(hrvAdult.rsaAmp > hrvElderly.rsaAmp, 'Adult RSA > Elderly RSA');
      assert.ok(hrvNeonate.rsaFreq > hrvChild.rsaFreq, 'Neonate resp rate > Child');
      assert.ok(hrvChild.rsaFreq > hrvAdult.rsaFreq, 'Child resp rate > Adult');
    });

    it('modulateRR() should produce physiological RR intervals', () => {
      const rng = mulberry32(12345);
      const phases = { rsa: 0, lf: Math.PI / 2, vlf: Math.PI };
      const hrvAdult = getHRVParams(35);
      const RR0 = 0.8;

      const rrIntervals = [];
      for (let t = 0; t < 10; t += 0.8) {
        const rr = modulateRR(RR0, t, hrvAdult, phases, rng);
        rrIntervals.push(rr);
        assert.ok(rr > 0.3 && rr < 1.5, `RR ${rr} should be in physiological range`);
      }

      const rrMean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
      const rrVariance = rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - rrMean, 2), 0) / rrIntervals.length;
      assert.ok(rrVariance > 0.0001, 'RR intervals should have variance (HRV)');
    });

    it('computeHRVMetrics() should compute valid metrics', () => {
      const rrIntervals = [0.8, 0.82, 0.78, 0.81, 0.79, 0.83, 0.77, 0.8];
      const hrvMetrics = computeHRVMetrics(rrIntervals);
      assert.ok(hrvMetrics.meanRR > 0, 'meanRR should be positive');
      assert.ok(hrvMetrics.SDNN >= 0, 'SDNN should be non-negative');
      assert.ok(hrvMetrics.RMSSD >= 0, 'RMSSD should be non-negative');
      assert.ok(hrvMetrics.pNN50 >= 0 && hrvMetrics.pNN50 <= 100, 'pNN50 should be 0-100%');
    });

    it('EctopyStateMachine should generate ectopic beats', () => {
      const ectopyRng = mulberry32(54321);
      const pvcMachine = new EctopyStateMachine(ectopyRng, 'PVC', 0.15);
      let ectopicCount = 0;
      for (let i = 0; i < 50; i++) {
        const { isEctopic, couplingInterval } = pvcMachine.nextBeat(i);
        if (isEctopic) {
          ectopicCount++;
          assert.ok(couplingInterval >= 0.5 && couplingInterval <= 0.8, 'Coupling interval in range');
        }
      }
      assert.ok(ectopicCount > 0, 'Should generate some ectopic beats');
      assert.ok(ectopicCount < 25, 'Should not generate too many ectopic beats');
    });

    it('EctopyStateMachine none mode should produce no ectopy', () => {
      const ectopyRng = mulberry32(54321);
      const noEctopy = new EctopyStateMachine(ectopyRng, 'none', 0.15);
      let noEctopyCount = 0;
      for (let i = 0; i < 20; i++) {
        if (noEctopy.nextBeat(i).isEctopic) noEctopyCount++;
      }
      assert.strictEqual(noEctopyCount, 0, "No ectopy when type is 'none'");
    });
  });

  describe('Lead-Field Model', () => {
    it('getHeartOrientationParams() should scale with age', () => {
      const orientNeonate = getHeartOrientationParams(0.5);
      const orientChild = getHeartOrientationParams(8);
      const orientAdult = getHeartOrientationParams(35);

      assert.ok(orientNeonate.roll > orientChild.roll, 'Neonate roll > Child roll');
      assert.ok(orientChild.roll > orientAdult.roll, 'Child roll > Adult roll');
    });

    it('createRotationMatrix() should produce valid rotation matrix', () => {
      const R = createRotationMatrix(0.1, 0.05, 0.08);
      assert.strictEqual(R.length, 9, 'Rotation matrix should have 9 elements');
      const row1Norm = Math.sqrt(R[0] * R[0] + R[1] * R[1] + R[2] * R[2]);
      assert.ok(Math.abs(row1Norm - 1) < 0.001, 'First row should be unit vector');
    });

    it('generateHeartOrientation() should be reproducible', () => {
      const orient1 = generateHeartOrientation(8, 12345);
      const orient2 = generateHeartOrientation(8, 12345);
      assert.strictEqual(orient1.roll, orient2.roll, 'Same seed should produce same roll');
      assert.strictEqual(orient1.pitch, orient2.pitch, 'Same seed should produce same pitch');
      assert.strictEqual(orient1.yaw, orient2.yaw, 'Same seed should produce same yaw');
    });

    it('generateHeartOrientation() should vary with seed', () => {
      const orient1 = generateHeartOrientation(8, 12345);
      const orient3 = generateHeartOrientation(8, 54321);
      assert.ok(orient1.roll !== orient3.roll || orient1.pitch !== orient3.pitch, 'Different seeds should produce different orientations');
    });

    it('leadFieldModel() rotation should affect output', () => {
      const params = applyDx(ageDefaults(0.5), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 0.5);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);

      const phiRotated = leadFieldModel(vcg, DEFAULT_ELECTRODE_GEOMETRY, { ageY: 0.5, seed: 42, applyRotation: true });
      const phiNoRotate = leadFieldModel(vcg, DEFAULT_ELECTRODE_GEOMETRY, { applyRotation: false });

      const leadsRotated = deriveLeads(phiRotated);
      const leadsNoRotate = deriveLeads(phiNoRotate);
      let maxDiff = 0;
      for (let i = 0; i < 1000; i++) {
        const diff = Math.abs(leadsRotated.II[i] - leadsNoRotate.II[i]);
        maxDiff = Math.max(maxDiff, diff);
      }
      assert.ok(maxDiff > 0.001, `Rotation should change lead signals (maxDiff=${maxDiff})`);
    });
  });

  describe('Device Model Components', () => {
    it('calcBiquadCoeffs() should compute filter coefficients', () => {
      const lpCoeffs = calcBiquadCoeffs('lowpass', 40, 1000, 0.7071);
      assert.ok(lpCoeffs.b0 !== undefined, 'Should have b0 coefficient');
      assert.ok(lpCoeffs.a1 !== undefined, 'Should have a1 coefficient');

      const hpCoeffs = calcBiquadCoeffs('highpass', 0.5, 1000, 0.7071);
      assert.ok(hpCoeffs.b0 !== undefined, 'Should have b0 coefficient');

      const notchCoeffs = calcBiquadCoeffs('notch', 60, 1000, 30);
      assert.ok(notchCoeffs.b0 !== undefined, 'Should have b0 coefficient');
    });

    it('applyBiquad() should filter signals', () => {
      const lpCoeffs = calcBiquadCoeffs('lowpass', 40, 1000, 0.7071);
      const testSignal = new Float64Array(100);
      for (let i = 0; i < 100; i++) {
        testSignal[i] = Math.sin((2 * Math.PI * 50 * i) / 1000);
      }
      const filteredSignal = applyBiquad(testSignal, lpCoeffs);
      assert.strictEqual(filteredSignal.length, testSignal.length, 'Filtered signal should have same length');
      assert.ok(filteredSignal instanceof Float64Array, 'Should return Float64Array');
    });

    it('applyNotchFilter() should attenuate 60 Hz', () => {
      const noisySignal = new Float64Array(1000);
      for (let i = 0; i < 1000; i++) {
        noisySignal[i] = Math.sin((2 * Math.PI * 10 * i) / 1000) + 0.5 * Math.sin((2 * Math.PI * 60 * i) / 1000);
      }
      const notchedSignal = applyNotchFilter(noisySignal, 1000, 60, 30);
      let power60Before = 0,
        power60After = 0;
      for (let i = 0; i < 1000; i++) {
        const carrier = Math.sin((2 * Math.PI * 60 * i) / 1000);
        power60Before += noisySignal[i] * carrier;
        power60After += notchedSignal[i] * carrier;
      }
      assert.ok(Math.abs(power60After) < Math.abs(power60Before) * 0.3, 'Notch should reduce 60 Hz power');
    });

    it('applyLowpass2() and applyHighpass2() should work', () => {
      const testSignal = new Float64Array(100);
      for (let i = 0; i < 100; i++) {
        testSignal[i] = Math.sin((2 * Math.PI * 50 * i) / 1000);
      }
      const lpFiltered = applyLowpass2(testSignal, 1000, 40);
      assert.strictEqual(lpFiltered.length, testSignal.length, 'LP2 output length should match');

      const hpFiltered = applyHighpass2(testSignal, 1000, 0.5);
      assert.strictEqual(hpFiltered.length, testSignal.length, 'HP2 output length should match');
    });

    it('simulateADC() should quantize and clip', () => {
      const analogSignal = new Float64Array(100);
      for (let i = 0; i < 100; i++) {
        analogSignal[i] = 5 * Math.sin((2 * Math.PI * i) / 100);
      }
      const quantized16 = simulateADC(analogSignal, 16, 10000);
      const quantized12 = simulateADC(analogSignal, 12, 10000);
      let maxDiff16 = 0,
        maxDiff12 = 0;
      for (let i = 0; i < 100; i++) {
        maxDiff16 = Math.max(maxDiff16, Math.abs(quantized16[i] - analogSignal[i]));
        maxDiff12 = Math.max(maxDiff12, Math.abs(quantized12[i] - analogSignal[i]));
      }
      assert.ok(maxDiff12 > maxDiff16, '12-bit ADC should have larger quantization error than 16-bit');

      const largeSignal = new Float64Array([15, -15, 5, -5]);
      const clipped = simulateADC(largeSignal, 16, 10000);
      assert.ok(Math.abs(clipped[0]) <= 10, 'Should clip at +10mV');
      assert.ok(Math.abs(clipped[1]) <= 10, 'Should clip at -10mV');
    });

    it('downsample() should reduce sample count', () => {
      const hiRate = new Float64Array(1000);
      for (let i = 0; i < 1000; i++) {
        hiRate[i] = Math.sin((2 * Math.PI * 10 * i) / 1000);
      }
      const loRate500 = downsample(hiRate, 1000, 500);
      assert.strictEqual(loRate500.length, 500, 'Downsample 1000→500 should halve samples');
      const loRate250 = downsample(hiRate, 1000, 250);
      assert.strictEqual(loRate250.length, 250, 'Downsample 1000→250 should quarter samples');
      const noDownsample = downsample(hiRate, 1000, 1000);
      assert.strictEqual(noDownsample, hiRate, 'Same rate should return original array');
    });
  });

  describe('Pediatric Priors', () => {
    it('PEDIATRIC_PRIORS should have required structure', () => {
      assert.ok(PEDIATRIC_PRIORS.age_bins.length > 0, 'Should have age bins');
      assert.ok(PEDIATRIC_PRIORS.morphology, 'Should have morphology data');
      assert.ok(PEDIATRIC_PRIORS.sex_adjustments, 'Should have sex adjustments');
    });

    it('getAgeBin() should return correct age bins', () => {
      const neonateBin = getAgeBin(0.02);
      assert.strictEqual(neonateBin.id, 'neonate', '0.02 years should be neonate');
      const toddlerBin = getAgeBin(2);
      assert.strictEqual(toddlerBin.id, 'toddler', '2 years should be toddler');
      const adolescentBin = getAgeBin(14);
      assert.strictEqual(adolescentBin.id, 'adolescent', '14 years should be adolescent');
      const adultBin = getAgeBin(35);
      assert.strictEqual(adultBin.id, 'young_adult', '35 years should be young_adult');
    });

    it('samplePediatricPriors() should produce reproducible age-appropriate values', () => {
      const priors1 = samplePediatricPriors(8, 12345);
      assert.ok(priors1.HR > 0 && priors1.HR < 200, 'HR should be reasonable');
      assert.ok(priors1.PR > 0 && priors1.PR < 0.3, 'PR should be reasonable');
      assert.ok(priors1.QRS > 0 && priors1.QRS < 0.2, 'QRS should be reasonable');
      assert.ok(priors1._ageBin, 'Should include age bin');

      const priors2 = samplePediatricPriors(8, 12345);
      assert.strictEqual(priors1.HR, priors2.HR, 'Same seed should produce same HR');
      assert.strictEqual(priors1.QRS, priors2.QRS, 'Same seed should produce same QRS');

      const neonatePriors = samplePediatricPriors(0.05, 99);
      const adultPriors = samplePediatricPriors(35, 99);
      assert.ok(neonatePriors.HR > adultPriors.HR, 'Neonate HR should be higher than adult');
      assert.ok(neonatePriors.QRSaxis > adultPriors.QRSaxis, 'Neonate QRS axis should be more rightward');
      assert.ok(neonatePriors.rvDom > adultPriors.rvDom, 'Neonate RV dominance should be higher');
    });

    it('sex adjustments should affect QTc', () => {
      const malePriors = samplePediatricPriors(12, 555, 'male');
      const femalePriors = samplePediatricPriors(12, 555, 'female');
      assert.ok(malePriors.QTc < femalePriors.QTc, 'Male QTc should be shorter than female');
    });

    it('computeZScore() should calculate z-scores', () => {
      const hrZscore = computeZScore('HR', 80, 8);
      assert.ok(typeof hrZscore === 'number', 'Z-score should be a number');
      const extremeZ = computeZScore('HR', 150, 35);
      assert.ok(Math.abs(extremeZ) > 2, 'HR 150 in adult should have large z-score');
    });

    it('checkNormalLimits() should detect abnormal values', () => {
      const normalCheck = checkNormalLimits('HR', 80, 8);
      assert.ok(normalCheck.normal !== null, 'Should return normal status');
      assert.ok(normalCheck.interpretation, 'Should return interpretation');

      const tachyCheck = checkNormalLimits('HR', 170, 8);
      assert.ok(!tachyCheck.normal, 'HR 170 at age 8 should be abnormal');
      assert.ok(tachyCheck.zScore > 2, 'HR 170 at age 8 should have z>2');
    });
  });

  describe('Beat-to-Beat Jitter', () => {
    it('generateBeatJitter() should produce valid jitter', () => {
      const rng = mulberry32(12345);
      const jitter1 = generateBeatJitter(0, 10, rng, 15, 0.5);
      const jitter2 = generateBeatJitter(1, 10, rng, 15, 1.5);

      assert.ok('ampJitter' in jitter1, 'Should have ampJitter');
      assert.ok('timeJitterQRS' in jitter1, 'Should have timeJitterQRS');
      assert.ok('qrsDurationFactor' in jitter1, 'Should have qrsDurationFactor');
      assert.ok('dirJitter' in jitter1, 'Should have dirJitter');
      assert.ok('pAmpFactor' in jitter1, 'Should have pAmpFactor');
      assert.ok('tAmpFactor' in jitter1, 'Should have tAmpFactor');

      assert.ok(jitter1.ampJitter > 0.85 && jitter1.ampJitter < 1.15, 'ampJitter should be within ±15%');
      assert.ok(jitter1.qrsDurationFactor > 0.9 && jitter1.qrsDurationFactor < 1.1, 'qrsDurationFactor should be within ±10%');
      assert.ok(jitter1.ampJitter !== jitter2.ampJitter, 'Different beats should get different jitter');
    });

    it('respiratory modulation should produce variation', () => {
      const respRng = mulberry32(42);
      const jitters = [];
      for (let i = 0; i < 20; i++) {
        jitters.push(generateBeatJitter(i, 20, respRng, 15, i * 0.75));
      }
      const ampMean = jitters.reduce((s, j) => s + j.ampJitter, 0) / jitters.length;
      const ampVar = jitters.reduce((s, j) => s + Math.pow(j.ampJitter - ampMean, 2), 0) / jitters.length;
      assert.ok(ampVar > 0.001, 'Should have measurable amplitude variance');
    });

    it('ECG output should have beat-to-beat variation', () => {
      const ecg1 = synthECGModular(8, 'Normal sinus', 42);
      const leadII = ecg1.leads_uV.II;
      const peaks = [];
      for (let i = 100; i < leadII.length - 100; i++) {
        if (leadII[i] > 500 && leadII[i] > leadII[i - 1] && leadII[i] > leadII[i + 1]) {
          let isMax = true;
          for (let j = -10; j <= 10; j++) {
            if (leadII[i + j] > leadII[i]) isMax = false;
          }
          if (isMax) peaks.push(leadII[i]);
        }
      }
      if (peaks.length >= 3) {
        const peakMean = peaks.reduce((a, b) => a + b, 0) / peaks.length;
        const peakStd = Math.sqrt(peaks.reduce((s, p) => s + Math.pow(p - peakMean, 2), 0) / peaks.length);
        const cv = peakStd / peakMean;
        assert.ok(cv > 0.01, 'R-wave peaks should have measurable variation (CV > 1%)');
      }
    });
  });

  describe('Module 1: Rhythm Model', () => {
    it('should generate beats with HRV for normal sinus', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);

      assert.ok(beatSchedule.beats.length > 0, 'Should generate beats');
      assert.ok(beatSchedule.RR > 0, 'Should have RR interval');
      assert.ok(beatSchedule.pWaveTimes.length > 0, 'Should have P wave times');
      assert.ok(beatSchedule.rrIntervals.length > 0, 'Should have RR intervals array');
      assert.ok(beatSchedule.hrvParams, 'Should have HRV params');
      assert.ok(beatSchedule.hrvMetrics, 'Should have HRV metrics');
      assert.ok(beatSchedule.hrvMetrics.SDNN > 0, 'SDNN should be positive for normal sinus');
    });

    it('should handle 3rd degree AVB', () => {
      const avb3Params = applyDx(ageDefaults(8), '3rd degree AVB');
      const avb3Schedule = rhythmModel(avb3Params, '3rd degree AVB', duration, 42, 8);
      const pOnly = avb3Schedule.beats.filter((b) => b.hasPWave && !b.hasQRS);
      const qrsOnly = avb3Schedule.beats.filter((b) => !b.hasPWave && b.hasQRS);
      assert.ok(pOnly.length > 0, '3rd degree AVB should have P-only beats');
      assert.ok(qrsOnly.length > 0, '3rd degree AVB should have QRS-only beats');
    });

    it('should generate PVCs', () => {
      const pvcParams = applyDx(ageDefaults(8), 'PVCs');
      const pvcSchedule = rhythmModel(pvcParams, 'PVCs', duration, 42, 8);
      const pvcs = pvcSchedule.beats.filter((b) => b.isPVC);
      assert.ok(pvcs.length > 0, 'PVCs should have PVC beats');
    });

    it('should generate PACs', () => {
      const pacParams = applyDx(ageDefaults(8), 'PACs');
      const pacSchedule = rhythmModel(pacParams, 'PACs', duration, 42, 8);
      const pacs = pacSchedule.beats.filter((b) => b.isPAC);
      assert.ok(pacs.length > 0, 'PACs should have PAC beats');
    });
  });

  describe('Module 2: Morphology Model', () => {
    it('should generate VCG with non-zero values', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);

      assert.ok(vcg.Vx instanceof Float64Array, 'Vx should be Float64Array');
      assert.ok(vcg.Vy instanceof Float64Array, 'Vy should be Float64Array');
      assert.ok(vcg.Vz instanceof Float64Array, 'Vz should be Float64Array');
      assert.strictEqual(vcg.Vx.length, N, 'Vx length should match N');

      const maxVx = Math.max(...vcg.Vx.map(Math.abs));
      const maxVy = Math.max(...vcg.Vy.map(Math.abs));
      assert.ok(maxVx > 0.1, 'Vx should have significant amplitude');
      assert.ok(maxVy > 0.1, 'Vy should have significant amplitude');
    });
  });

  describe('Module 3: Lead Field Model', () => {
    it('should generate electrode potentials', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);
      const phi = leadFieldModel(vcg);

      assert.ok(phi.phiRA instanceof Float64Array, 'phiRA should be Float64Array');
      assert.ok(phi.phiLA instanceof Float64Array, 'phiLA should be Float64Array');
      assert.ok(phi.phiLL instanceof Float64Array, 'phiLL should be Float64Array');
      assert.ok(phi.phiV1 instanceof Float64Array, 'phiV1 should be Float64Array');

      const maxRA = Math.max(...phi.phiRA.map(Math.abs));
      const maxV1 = Math.max(...phi.phiV1.map(Math.abs));
      assert.ok(maxRA > 0, 'phiRA should have non-zero values');
      assert.ok(maxV1 > 0, 'phiV1 should have non-zero values');
    });

    it('should accept custom electrode geometry', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);

      const customGeometry = { ...DEFAULT_ELECTRODE_GEOMETRY };
      customGeometry.V1 = norm([-0.8, 0.0, 1.0]);
      const phiCustom = leadFieldModel(vcg, customGeometry);
      assert.ok(phiCustom.phiV1 instanceof Float64Array, 'Custom geometry should work');
    });
  });

  describe('Module 4: Derive Leads', () => {
    it('should derive all 15 leads with Einthoven law satisfied', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);
      const phi = leadFieldModel(vcg);
      const leads = deriveLeads(phi);

      const expectedLeads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V3R', 'V4R', 'V7'];
      for (const lead of expectedLeads) {
        assert.ok(leads[lead] instanceof Float64Array, `Lead ${lead} should be Float64Array`);
        assert.strictEqual(leads[lead].length, N, `Lead ${lead} length should match N`);
      }

      let maxError = 0;
      for (let i = 0; i < N; i++) {
        const err = Math.abs(leads.I[i] + leads.III[i] - leads.II[i]);
        maxError = Math.max(maxError, err);
      }
      assert.ok(maxError < 0.001, `Einthoven error ${maxError} should be < 0.001`);
    });
  });

  describe('Module 5: Device and Artifact Model', () => {
    it('should work with all device presets', () => {
      const params = applyDx(ageDefaults(8), 'Normal sinus');
      const beatSchedule = rhythmModel(params, 'Normal sinus', duration, 42, 8);
      const vcg = morphologyModel(beatSchedule, params, 'Normal sinus', fs, N, 42);
      const phi = leadFieldModel(vcg);

      const resultClean = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.none, DEVICE_PRESETS.diagnostic, false, true);
      assert.ok(resultClean.leads.I instanceof Float64Array, 'Clean leads should work');
      assert.strictEqual(resultClean.fs, 1000, 'Diagnostic mode should output at 1000 Hz');

      const resultMonitor = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.typical, DEVICE_PRESETS.monitor, true, true);
      assert.strictEqual(resultMonitor.fs, 500, 'Monitor mode should output at 500 Hz');
      assert.ok(resultMonitor.leads.I.length < resultClean.leads.I.length, 'Monitor mode should have fewer samples');

      const resultHolter = deviceAndArtifactModel(phi, fs, 42, ARTIFACT_PRESETS.minimal, DEVICE_PRESETS.holter, true, true);
      assert.strictEqual(resultHolter.fs, 250, 'Holter mode should output at 250 Hz');
    });
  });

  describe('Integrated Modular Synthesis', () => {
    it('should produce valid ECG with HRV metrics', () => {
      const ecg = synthECGModular(8, 'Normal sinus', 42);

      assert.strictEqual(ecg.fs, 1000, 'Sample rate should be 1000');
      assert.strictEqual(ecg.duration_s, 10.0, 'Duration should be 10s');
      assert.ok(ecg.targets.synthetic === true, 'Should be marked synthetic');
      assert.ok(ecg.targets.generator_version, 'Should have generator version');
      assert.ok(ecg.targets.generator_version.includes('calibrated'), "Generator version should include 'calibrated'");
      assert.ok(ecg.targets.hrv, 'Should include HRV metrics in targets');
      assert.ok(ecg.targets.hrv.SDNN >= 0, 'SDNN should be present and non-negative');
      assert.ok(ecg.targets.hrv.RMSSD >= 0, 'RMSSD should be present and non-negative');

      const meta = normalizeECGData(ecg);
      const rPeaks = detectRPeaks(meta);
      const integrity = physicsChecks(meta.leads_uV);

      assert.ok(rPeaks.length >= 5, `Should have R-peaks, got ${rPeaks.length}`);
      assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `Einthoven error ${integrity.einthoven_max_abs_error_uV} > 2 µV`);
    });
  });

  describe('All Diagnoses', () => {
    it('should synthesize all diagnoses with valid Einthoven error', () => {
      for (const dx of DIAGNOSES) {
        const ecg = synthECGModular(8, dx, 42);
        const meta = normalizeECGData(ecg);
        const integrity = physicsChecks(meta.leads_uV);
        assert.ok(integrity.einthoven_max_abs_error_uV <= 2, `${dx}: Einthoven error ${integrity.einthoven_max_abs_error_uV} > 2 µV`);
      }
    });
  });

  describe('Seed Reproducibility', () => {
    it('should produce identical output for same seed', () => {
      const ecg1 = synthECGModular(4, 'Normal sinus', 12345);
      const ecg2 = synthECGModular(4, 'Normal sinus', 12345);

      const meta1 = normalizeECGData(ecg1);
      const meta2 = normalizeECGData(ecg2);
      const rPeaks1 = detectRPeaks(meta1);
      const rPeaks2 = detectRPeaks(meta2);

      assert.strictEqual(rPeaks1.length, rPeaks2.length, 'R-peak count should match for same seed');

      let maxDiff = 0;
      for (let i = 0; i < 100; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(meta1.leads_uV.II[i] - meta2.leads_uV.II[i]));
      }
      assert.strictEqual(maxDiff, 0, 'Same seed should produce identical output');
    });
  });
});
