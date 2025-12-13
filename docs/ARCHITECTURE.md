# EKGQuest Architecture

This document describes the system architecture, module relationships, and data flow for LLMs and developers working on the codebase.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser Runtime                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   HTML Viewer    │    │   ecg-synth.js   │    │  ecg-worker.js   │       │
│  │  (UI + Canvas)   │◄──►│ (Synthesis Coord)│    │ (Analysis Worker)│       │
│  └────────┬─────────┘    └────────┬─────────┘    └──────────────────┘       │
│           │                       │                                          │
│           ▼                       ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                        ecg-core.js                                │       │
│  │  Normalization | R-Peak Detection | Measurements | Formatters    │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                   │                                          │
│                                   ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                    ecg-synth-modules.js                           │       │
│  │  Age Priors | Morphology Model | Beat Jitter | Noise Model        │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           Python Validation Layer                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │   eval_realism   │◄───│     metrics      │◄───│   io_ecgjson     │       │
│  │  (Gate Pipeline) │    │ (Physics/Dist)   │    │   (JSON I/O)     │       │
│  └────────┬─────────┘    └──────────────────┘    └──────────────────┘       │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │          External Reference Data (Not Circular Validation)        │       │
│  │  pediatric_reference.py (Rijnbeek 2001)  | ptbxl_reference.py     │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Module Map

### JavaScript Modules (viewer/js/)

| File | Purpose | Key Exports |
|------|---------|-------------|
| `ecg-core.js` | Core utilities shared by all viewers | `normalizeECGSchema`, `detectRPeaks`, `computeHR`, `computeMedianBeat`, `measureFiducials`, `computeQTc`, `computeAxis` |
| `ecg-synth.js` | Synthesis coordinator, parameter selection | `generateSyntheticECG`, `PATHOLOGIES`, age/diagnosis presets |
| `ecg-synth-modules.js` | Modular morphology generation | `generatePopulationSample`, `morphologyModel`, `generateBeatJitter`, `noiseModel`, `PEDIATRIC_PRIORS` |
| `ecg-worker.js` | Web Worker for off-thread analysis | Worker message handlers for heavy computations |

### Python Modules (python/realism_lab/)

| File | Purpose | Key Exports |
|------|---------|-------------|
| `io_ecgjson.py` | ECG JSON schema I/O | `load_ecg_json`, `save_ecg_json`, `ECGData`, `ECGTargets` |
| `metrics.py` | Realism metrics computation | `compute_physics_metrics`, `compute_distribution_metrics`, `compute_hrv_metrics`, `compute_spectral_metrics` |
| `eval_realism.py` | Evaluation pipeline with gates | `run_evaluation`, `EvaluationResult`, `ThresholdConfig` |
| `pediatric_reference.py` | Rijnbeek 2001 pediatric norms | `RIJNBEEK_REFERENCE`, `validate_ecg_against_rijnbeek` |
| `ptbxl_reference.py` | PTB-XL adult reference | `PTBXL_REFERENCE`, `compare_to_ptbxl` |
| `report.py` | Report generation | `generate_report` |

## Data Flow

### 1. ECG Generation Flow

```
User Input (age, dx, seed)
        │
        ▼
┌───────────────────────┐
│   ecg-synth.js        │
│   - Select parameters │
│   - Create RNG        │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│ ecg-synth-modules.js  │
│ - generatePopulation- │
│   Sample()            │
│ - morphologyModel()   │
│ - noiseModel()        │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   ECG JSON Schema     │
│   { fs, leads_uV,     │
│     targets, ... }    │
└───────────────────────┘
```

### 2. Validation Flow

```
ECG JSON Files
        │
        ▼
┌───────────────────────┐
│   io_ecgjson.py       │
│   - Load & parse      │
│   - Type validation   │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   metrics.py          │
│   - Physics checks    │
│   - Distribution Z    │
│   - Spectral analysis │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   eval_realism.py     │
│   - 5 quality gates   │
│   - Pass/fail logic   │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│   External Reference  │
│   - Rijnbeek (peds)   │
│   - PTB-XL (adult)    │
└───────────────────────┘
```

## Quality Gates (Validation Pipeline)

The evaluation pipeline runs 5 sequential gates:

| Gate | Name | Pass Criteria | Source |
|------|------|---------------|--------|
| A | Physics Consistency | Einthoven error < 10 µV, no clipping | `metrics.py` |
| B | Distribution | All Z-scores within ±3 SD | `metrics.py` |
| C | HRV Realism | 5+ beats, SDNN 5-200 ms | `metrics.py` |
| D | Spectral Realism | Realistic QRS peak, not too smooth/noisy | `metrics.py` |
| E | External Reference | ≥60% parameters within Rijnbeek/PTB-XL norms | `pediatric_reference.py` |

## Age Bins

Pediatric priors use these age bins (defined in both JS and Python):

| Bin ID | Age Range | HR (mean±SD) | PR | QRS | Notes |
|--------|-----------|--------------|----|----|-------|
| neonate | 0-1 mo | 140±20 | 100 | 65 | Rightward axis |
| infant | 1-12 mo | 130±20 | 110 | 65 | Transitioning |
| toddler | 1-3 y | 115±20 | 120 | 70 | |
| preschool | 3-6 y | 100±15 | 130 | 75 | |
| school_early | 6-10 y | 85±15 | 140 | 80 | |
| school_late | 10-14 y | 80±15 | 145 | 85 | |
| adolescent | 14-18 y | 75±12 | 150 | 88 | Approaching adult |
| young_adult | 18-40 y | 72±12 | 160 | 90 | Adult physiology |

## File Dependencies

```
ecg-synth-modules.js
        │
        └──► ecg-core.js (detectRPeaks, computeHR)

ecg-synth.js
        │
        ├──► ecg-synth-modules.js (all synthesis)
        └──► ecg-core.js (measurements)

eval_realism.py
        │
        ├──► io_ecgjson.py
        ├──► metrics.py
        ├──► pediatric_reference.py
        └──► ptbxl_reference.py
```

## CI Pipeline

```yaml
# .github/workflows/ci.yml

test-js:          # npm test (smoke, golden, validation, synth-modules tests)
realism-lab:      # Generate cases → run Python evaluation → upload report
visual-regression: # Puppeteer screenshots → hash comparison
lint-html:        # File existence checks
```

## Key Design Decisions

1. **Single JSON Schema**: All ECGs (real or synthetic) use the same format with `leads_uV` in microvolts.

2. **Physics Enforcement**: Einthoven's law (II = I + III) is enforced during synthesis, not just validated.

3. **External Validation**: Uses Rijnbeek 2001 (not circular validation against our own priors).

4. **Modular Synthesis**: Morphology components (P, QRS, T) are generated independently and summed.

5. **Beat-to-beat Variation**: Respiratory modulation + stochastic jitter prevents "too perfect" patterns.

6. **Spectral Validation**: Detects unrealistic signals (too smooth = algorithmic, too noisy = artifact).

## For LLMs: Common Tasks

### Adding a New Diagnosis

1. Add to `PATHOLOGIES` in `ecg-synth.js`
2. Implement morphology in `morphologyModel()` in `ecg-synth-modules.js`
3. Add pathological exemptions in `python/configs/eval_matrix.json`
4. Add test case in `test/synth-modules.test.js`

### Modifying Pediatric Priors

1. Update `PEDIATRIC_PRIORS` in `ecg-synth-modules.js`
2. Mirror changes in `metrics.py:PEDIATRIC_PRIORS`
3. Validate against Rijnbeek reference in `pediatric_reference.py`

### Adding a New Metric

1. Add computation in `metrics.py`
2. Export from `__init__.py`
3. Add to `compute_all_metrics()` in `metrics.py`
4. Add gate logic in `eval_realism.py`
5. Add tests in `tests/test_realism_lab.py`

### Debugging Validation Failures

1. Run with verbose: `python -m realism_lab.eval_realism --verbose`
2. Check `failures` list in case results
3. Compare against reference values in `pediatric_reference.py`
4. Check spectral metrics for "too smooth" or "too noisy"
