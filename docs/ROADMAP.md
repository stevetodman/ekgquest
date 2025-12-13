# EKGQuest Roadmap

Goal: world-class ECG teaching lab — MUSE-style viewing/printing + explainable measurements + high-fidelity pediatric synthetic cases (no waveform watermark).

## Non-negotiables
- Educational use; not for diagnosis/patient care.
- No waveform watermark; provenance lives in metadata + UI chrome (hideable in quiz mode).
- One canonical ECG JSON schema.
- Synthetic flag always preserved: `targets.synthetic = true`, plus seed and generator version.

## Milestones

### M1: Flagship Lab page + mm-perfect rendering + worker analysis contract ✅
- Unified viewer with MUSE-style header
- Stacked (15-lead) and print (12-lead + rhythm) layouts
- Worker-based analysis pipeline
- R-peak detection, median beat, fiducial extraction
- Measurements: HR, PR, QRS, QT/QTc (Bazett/Fridericia/Framingham), axes

### M2: Teach/Quiz modes + grading + case packs ✅
- Mode selector: View / Teach / Quiz
- Quiz mode: hide measurements, user inputs, grading with tolerances
- Case pack navigation (Basics, Intervals, Axes)
- Random case generation from synth module

### M3: Synth realism v1 + truth-based self-tests + validation harness ✅
- Extracted synth module (`ecg-synth.js`) for reuse
- Age-based parameter interpolation (neonate → adolescent)
- Diagnosis presets: Normal, WPW, RBBB, LVH, RVH, SVT, Flutter, Long QT, Pericarditis
- Validation tests verify measurements match synth targets

### M4: Visual/perf regressions in CI + GitHub Pages deploy ✅
- GitHub Actions CI workflow (runs all tests)
- GitHub Pages deployment workflow
- Landing page with links to viewers

### M5: Pedagogy polish + lesson flows ✅
- Context-aware teaching tips in Teach mode
- Tips adapt to current ECG (normal vs abnormal findings)
- Educational hints for each measurement type

### M6: Extended diagnoses ✅
- Added LBBB, LAFB (conduction abnormalities)
- Added 1st, 2nd (Wenckebach & Mobitz II), 3rd degree AVB
- Added PACs and PVCs (ectopy)
- Added sinus bradycardia and tachycardia
- Refactored synth to use beat scheduling for complex rhythms

### M7: Morphology quiz mode ✅
- "Quiz (Identify Rhythm)" mode with multiple-choice diagnosis selection
- Random distractor generation from available diagnoses
- Immediate feedback with correct/incorrect highlighting
- Next case button for continuous practice

### M8: Multi-case session scoring ✅
- Session tracking bar (Cases, Correct, Accuracy, Streak)
- Progress persisted to localStorage
- Streak badges for motivation (3+, 5+, 10+ streaks)
- Session reset button
- Automatic recording for both quiz modes (measurements & morphology)

### M9: PDF report export ✅
- "Generate Report" button in toolbar
- Report modal with patient info, measurements, interpretation
- Automated interpretation based on measurements (brady/tachy, axis deviation, etc.)
- 12-lead ECG rendering in report canvas
- Print/PDF export via browser print dialog
- Educational disclaimer in all exports

---

## Teaching-Indistinguishable Synthesis Roadmap

The following 8-step plan will elevate synthetic ECG realism to be indistinguishable from real ECGs for educational purposes.

### Step 1: Refactor synthesis into 5 explicit modules ✅
Split `synthECG(...)` into independent, testable modules:

1. **rhythmModel(params, seed)** → beatSchedule
2. **morphologyModel(beatSchedule, params, seed)** → VCG(t) (3D source: Vx, Vy, Vz)
3. **leadFieldModel(VCG, torsoParams, electrodeParams)** → electrodePotentials
4. **deriveLeads(electrodePotentials)** → leads_uV (limb + augmented + precordials)
5. **deviceAndArtifactModel(leads_uV, deviceParams, artifactParams, seed)** → finalLeads_uV

**Done when**: Each module can be swapped and unit-tested in isolation.

### Step 2: Upgrade morphology model (basis library) ✅
Wave basis toolkit implemented in `ecg-synth-modules.js`:

- **Asymmetric Gaussian**: σL ≠ σR for rise/decay asymmetry
- **Generalized Gaussian**: Variable exponent p for pointiness control
- **Hermite basis**: Capture notches/slurs in QRS (orders 0-4)
- **Biphasic waves**: For complex T waves and U waves
- **Sigmoid transitions**: For ST segment changes
- **Phase-based waves**: Consistent morphology across HR changes
- **Wave presets**: P_NORMAL, P_PEAKED, P_BIFID, QRS_NARROW, QRS_WIDE_RBBB, QRS_WIDE_LBBB, T_NORMAL, T_HYPERACUTE, T_INVERTED, T_BIPHASIC

### Step 3: Mathematically realistic rhythm generation ✅
Age-appropriate HRV modeling implemented in `ecg-synth-modules.js`:

- **Age-dependent HRV parameters**: `getHRVParams(ageY)` returns RSA amplitude, respiratory frequency, LF/VLF components based on age (neonate → elderly)
- **RSA + LF + VLF modulation**: `modulateRR()` implements `RR(t) = RR0 * (1 + A_rsa*sin(2π*f_rsa*t) + A_lf*sin(2π*f_lf*t) + A_vlf*sin(2π*f_vlf*t)) + ε`
- **Arrhythmia state machine**: `EctopyStateMachine` class for realistic PAC/PVC clustering with refractory periods
- **HRV metrics**: `computeHRVMetrics()` calculates SDNN, RMSSD, pNN50
- **Output includes HRV**: Synthetic ECGs now include `targets.hrv` with computed metrics

### Step 4: Improved lead-field model ✅
Age-dependent heart orientation implemented in `ecg-synth-modules.js`:

- **`getHeartOrientationParams(ageY)`**: Age-dependent heart rotation angles (roll, pitch, yaw)
  - Neonates: More horizontal, rightward rotation (roll=0.15, yaw=0.12)
  - Adults: Standard orientation (near zero)
  - Includes random variation for realistic inter-patient variability
- **`createRotationMatrix(roll, pitch, yaw)`**: 3D rotation matrix (ZYX Euler angles)
- **`generateHeartOrientation(ageY, seed)`**: Reproducible orientation with age priors
- **VCG rotation**: Applied before electrode projection in `leadFieldModel()`
- **Options API**: `leadFieldModel(vcg, geometry, { ageY, seed, applyRotation })`

### Step 5: Correlated artifact/noise model ✅
Realistic noise generation implemented in `ecg-synth-modules.js`:

- **Baseline wander**: `generateColoredNoise()` with 1/f spectrum + sinusoidal components
- **Mains interference**: `generatePowerlineNoise()` with 60Hz fundamental + harmonics (120, 180, 240 Hz), amplitude-modulated
- **EMG**: Band-limited (20–150 Hz) with nonstationary envelope
- **Electrode motion**: `generateMotionArtifacts()` with transient shifts + bi-exponential recovery (τ1=0.05s, τ2=0.3s)
- **Impedance drift**: `generateImpedanceDrift()` with slow random walk + occasional step changes
- **Presets**: `ARTIFACT_PRESETS` (none, minimal, typical, noisy, exercise) with motion/impedance parameters

### Step 6: Device model ✅
Realistic ECG device simulation implemented in `ecg-synth-modules.js`:

- **Filter modes**: `DEVICE_PRESETS` with diagnostic, monitor, exercise, holter, highres modes
- **Filter implementation**: 2nd-order Butterworth biquads with zero-phase filtfilt
  - `calcBiquadCoeffs()` for lowpass/highpass/notch filter design
  - `applyBiquad()` Direct Form II Transposed implementation
  - `applyNotchFilter()` for 50/60 Hz powerline rejection
- **Quantization & clipping**: `simulateADC(bits, rangeUV)` with configurable resolution (12-16 bit) and clipping
- **Sampling**: `downsample(inputFs, outputFs)` with anti-aliasing filter
- **Output modes**: Each preset specifies bandwidth, notch filter, ADC bits, and output sampling rate

### Step 7: Data-driven calibration ✅
Pediatric ECG priors implemented in `ecg-synth-modules.js`:

- **`PEDIATRIC_PRIORS`**: Embedded reference distributions from published literature
  - 10 age bins: neonate → young adult
  - Parameters: HR, PR, QRS, QTc, P/QRS/T axes with mean and SD
  - Morphology priors: rvDom, juvenileT by age
  - Sex adjustments: QTc offset, QRS factor, voltage factor
- **`getAgeBin(ageY)`**: Returns appropriate age bin for any age
- **`samplePediatricPriors(ageY, seed, sex)`**: Sample realistic ECG parameters
  - Truncated normal sampling within physiological bounds
  - Age-appropriate values with inter-individual variation
  - Sex-specific adjustments
- **`computeZScore(param, value, ageY)`**: Calculate z-score for any measurement
- **`checkNormalLimits(param, value, ageY)`**: Clinical interpretation of values

References: Rijnbeek et al. 2001/2014, Bratincsák et al. 2020, Davignon et al. 1979

### Step 8: Indistinguishability evaluation harness ✅
Python Realism Lab + CI quality gates implemented:

**Python Realism Lab** (`/python/realism_lab/`):
- **`io_ecgjson.py`**: Load/save ECG JSON files (handles Int16Array serialization)
- **`metrics.py`**: Physics, distribution, morphology, HRV metrics
  - Einthoven consistency check (I + III = II)
  - Z-score computation vs pediatric priors
  - R/S progression analysis
  - Beat detection + SDNN/RMSSD/pNN50
- **`eval_realism.py`**: Evaluation pipeline with configurable thresholds
- **`report.py`**: Console + JSON report generation

**Node Generator CLI** (`tools/generate_synth_cases.mjs`):
- Bridges JS synthesizer → Python evaluation
- Generates golden seed cases for regression testing
- Supports custom configs, age/dx matrices

**CI Quality Gates** (`.github/workflows/ci.yml`):
- `test-js`: Runs JavaScript unit tests
- `realism-lab`: Generates golden cases → evaluates with Python → fails if metrics regress
- `lint-html`: Static checks for file existence

**Pathological Exemptions** (`python/configs/eval_matrix.json`):
- SVT: Exempts HR z-score + lower SDNN threshold
- WPW: Exempts QRS/PR z-scores
- Other diagnoses: Appropriate exemptions for expected outliers

**Achieved**: 100% pass rate on golden seeds (7/7 cases), automated CI gate

---

## Future Ideas
- Paced rhythms
- Atrial fibrillation
- Ventricular tachycardia
- Fiducial editing for manual annotation
- Multi-language support
- Mobile-optimized viewer
