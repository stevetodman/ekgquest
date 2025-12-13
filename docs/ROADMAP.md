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

### Step 1: Refactor synthesis into 5 explicit modules (In Progress)
Split `synthECG(...)` into independent, testable modules:

1. **rhythmModel(params, seed)** → beatSchedule
2. **morphologyModel(beatSchedule, params, seed)** → VCG(t) (3D source: Vx, Vy, Vz)
3. **leadFieldModel(VCG, torsoParams, electrodeParams)** → electrodePotentials
4. **deriveLeads(electrodePotentials)** → leads_uV (limb + augmented + precordials)
5. **deviceAndArtifactModel(leads_uV, deviceParams, artifactParams, seed)** → finalLeads_uV

**Done when**: Each module can be swapped and unit-tested in isolation.

### Step 2: Upgrade morphology model (basis library)
Replace simple Gaussian components with a wave "basis toolkit" in VCG/source domain:

- **Asymmetric Gaussian**: σL ≠ σR for rise/decay asymmetry
- **Generalized Gaussian**: Variable exponent p for pointiness control
- **Hermite basis**: Capture notches/slurs in QRS
- **Spline-defined loops**: 3D control points with time warping

Add **time warping per beat**: Parameterize beat by phase φ ∈ [0,1] for consistent morphology across HR changes.

**Done when**: QRS can be narrow/wide, notched, slurred, or RSR′ without per-lead hacks.

### Step 3: Mathematically realistic rhythm generation
Upgrade from simple jitter to point-process style beat scheduling:

- Base RR: `RR0 = 60 / HR`
- RSA + LF variability: `RR(t) = RR0 * (1 + A_rsa sin(2π f_rsa t + φ)) + LF_component + ε`
- Arrhythmia state machine / Markov model for beat types

**Done when**: HRV spectrum is plausible, arrhythmias produce realistic sequences.

### Step 4: Improved lead-field model
Upgrade from fixed electrode vectors:

- **Parameterized heart orientation/position**: Random 3D rotation R(α,β,γ) with age-dependent priors
- **Lead-field matrix L**: `Φ_electrodes(t) = L * VCG(t)`, then derive leads
- **Chest lead progression constraints**: Fit R/S progression V1–V6 to age-appropriate ranges

**Done when**: V1–V6 progression and limb lead axes match target distributions.

### Step 5: Correlated artifact/noise model
Build noise in electrode space (before lead derivation) for consistent cross-lead behavior:

- **Baseline wander**: Sinusoids + colored noise, correlated across leads
- **Mains interference**: 50/60 Hz + harmonics, amplitude-modulated
- **EMG**: Band-limited (20–150 Hz) with nonstationary envelope
- **Electrode motion**: Transient shifts with bi-exponential recovery
- **Impedance drift**: Slow drift + occasional step changes

**Done when**: Noise behaves consistently across leads, realistic baseline and HF texture.

### Step 6: Device model
Add signal processing typical of ECG devices:

- **Filter modes**: Diagnostic vs Monitor presets
- **Filter implementation**: IIR/FIR with defined frequency responses
- **Quantization & clipping**: ADC resolution, saturation behavior
- **Sampling**: Generate at 1000 Hz, downsample to 500/250 with anti-aliasing

**Done when**: Diagnostic/Monitor toggles produce noticeably different clinical looks.

### Step 7: Data-driven calibration
Calibrate generator parameters against real ECG feature distributions:

**Feature extractor** (per case, by age bin):
- HR, PR, QRS, QT, QTc distributions
- Axis distributions
- R/S amplitude progression V1→V6
- QRS energy distribution across leads
- Lead covariance / coherence
- Noise PSD in baseline segments
- Artifact event rates

**Optimization**: Minimize distribution distance (Wasserstein/MMD/KL) to reference data.

**Done when**: Synthetic population histograms match reference within thresholds.

### Step 8: Indistinguishability evaluation harness
Quality assurance without enabling misuse:

- **Golden seeds**: Fixed seed → fixed output for visual/measurement regressions
- **Blinded educator panel tool**: Mixed pool (synthetic + reference), collect realism ratings
- **Regression gates**: CI fails if realism metrics regress or golden hashes drift

**Done when**: Local command outputs realism metrics, diffs, and "needs review" list.

---

## Future Ideas
- Paced rhythms
- Atrial fibrillation
- Ventricular tachycardia
- Fiducial editing for manual annotation
- Multi-language support
- Mobile-optimized viewer
