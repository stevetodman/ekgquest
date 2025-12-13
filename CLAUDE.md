# Claude Code Context for EKGQuest

This file provides context for LLMs (like Claude) working on this codebase.

## Project Summary

EKGQuest is a synthetic ECG teaching lab with:
- **JavaScript synthesizer**: Generates 12-lead ECGs for 23 diagnoses, ages 0-99
- **Python validation**: 5 quality gates using external reference data
- **Browser viewer**: MUSE-style display with measurements, calipers, comparison mode
- **Import system**: CSV (WebPlotDigitizer), PDF, and image upload with auto-calibration

## Quick Start

```bash
npm install      # Install dependencies
npm start        # Start dev server at http://localhost:8000
npm test         # Run all tests (Vitest)
```

## Quick Reference

### Key Files

| Task | Files to Read |
|------|---------------|
| Add new diagnosis | `viewer/js/ecg-synth-modules.js:PATHOLOGIES`, `morphologyModel()` |
| Modify pediatric priors | `viewer/js/ecg-synth-modules.js:PEDIATRIC_PRIORS` |
| Add validation metric | `python/realism_lab/metrics.py`, `eval_realism.py` |
| Fix Einthoven error | `viewer/js/ecg-synth-modules.js:morphologyModel` (lead projection) |
| Debug test failure | `test/*.test.js` (run with `npm test`) |
| Modify viewer UI | `viewer/ekgquest_lab.html` (single-file app) |
| Add CSV import format | `viewer/ekgquest_lab.html:parseCSVtoECG()` |
| Modify image calibration | `viewer/ekgquest_lab.html:detectGridSpacing()` |

### Running Tests

```bash
# All tests via Vitest
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# Python tests
python -m pytest python/tests/ -v
```

### Common Patterns

**Generate ECG in JS:**
```javascript
import { generateSyntheticECG } from './viewer/js/ecg-synth-modules.js';
const ecg = generateSyntheticECG(8, "Normal sinus", 12345);
// Returns: { fs, duration_s, leads_uV, targets, integrity }
```

**Import CSV (WebPlotDigitizer format):**
```javascript
// Single-lead: time,voltage columns (seconds, mV)
// Multi-lead: time,I,II,III,V1,... columns
const ecg = parseCSVtoECG(csvText, filename);
```

**Validate ECG in Python:**
```python
from realism_lab import load_ecg_json, compute_all_metrics
ecg = load_ecg_json("case.json")
metrics = compute_all_metrics(ecg)
```

## Architecture Decisions

1. **Single JSON schema**: All ECGs use `{ fs, duration_s, leads_uV, targets, integrity }`
2. **Physics enforcement**: Einthoven's law enforced during synthesis, not just validated
3. **External validation**: Use Rijnbeek 2001 / PTB-XL data, NOT our own priors
4. **Modular morphology**: P, QRS, T generated independently per beat
5. **Beat-to-beat variation**: Never identical beats; use `generateBeatJitter()`
6. **Browser-only viewer**: No backend required; all processing in-browser
7. **Import flexibility**: CSV, PDF, and images all convert to standard ECG format

## Critical Invariants

- `leads_uV` values are in **microvolts** (µV)
- `targets.synthetic` = `true` for generated ECGs, `false` for imported
- `integrity.einthoven_max_abs_error_uV` must be < 10 µV for synthetic
- All 12 standard leads must be present
- Sample rate (`fs`) is typically 500 Hz

## Supported Diagnoses (23 total)

| Category | Diagnoses |
|----------|-----------|
| Normal variants | Normal sinus, Sinus bradycardia, Sinus tachycardia |
| Conduction | WPW, RBBB, LBBB, LAFB |
| Hypertrophy | LVH, RVH |
| Arrhythmias | SVT (narrow), Atrial flutter (2:1), Atrial fibrillation |
| AV blocks | 1st degree, 2nd degree Wenckebach, 2nd degree Mobitz II, 3rd degree |
| Repolarization | Long QT, Pericarditis |
| Emergencies | STEMI (anterior), Hyperkalemia, Brugada (Type 1) |
| Ectopy | PACs, PVCs |

## Age-Specific Reference Values

| Age | HR | PR | QRS | QTc | Axis | Notes |
|-----|----|----|-----|-----|------|-------|
| Neonate | 140 | 100 | 65 | 410 | 110° | Rightward axis normal |
| Infant | 130 | 110 | 70 | 400 | 90° | |
| Toddler | 110 | 120 | 75 | 405 | 70° | |
| School-age | 85 | 140 | 80 | 410 | 60° | |
| Adolescent | 75 | 150 | 85 | 415 | 55° | |
| Adult | 72 | 160 | 90 | 420 | 45° | |

## Diagnosis Implementation Checklist

When adding a new diagnosis:

1. [ ] Add to `PATHOLOGIES` object in `ecg-synth-modules.js`
2. [ ] Implement morphology in `morphologyModel()` switch statement
3. [ ] Add pathological exemptions in `python/configs/eval_matrix.json`
4. [ ] Add test case in `test/synth-modules.test.js`
5. [ ] Verify z-scores are reasonable or exempted
6. [ ] Run: `npm test`

## Common Issues

### "Einthoven error too high"
The limb leads don't satisfy II = I + III. Check lead projection in `morphologyModel()`:
```javascript
leads.III = leads.II - leads.I;  // Enforce after projection
```

### "is_too_smooth" spectral flag
Signal lacks high-frequency content. Ensure:
1. Noise model applied: `noiseModel(leads, fs, noiseLevel, rng)`
2. Beat jitter enabled: `generateBeatJitter(...)`

### CSV import not working
Check format:
- WebPlotDigitizer: `X,Y` or `time,voltage` (seconds, mV)
- Multi-lead: `time,I,II,III,...` columns
- Time >100 assumed milliseconds, auto-converted to seconds
- Voltage >100 assumed µV, otherwise assumed mV

### Image calibration fails
Auto-detection requires visible red grid lines. Fallback:
1. Click "Calibrate" button
2. Click two points exactly 5 big boxes (25mm) apart

## File Locations

```
viewer/
├── ekgquest_lab.html         # Main app (viewer, synth, import, UI)
└── js/
    ├── ecg-synth-modules.js  # Synthesizer (PATHOLOGIES, morphologyModel, etc.)
    ├── ecg-core.js           # R-peak detection, measurements
    └── ecg-worker.js         # Web Worker for analysis

python/realism_lab/
├── metrics.py                # Validation metrics
├── eval_realism.py           # Evaluation pipeline
├── pediatric_reference.py    # Rijnbeek 2001 data
└── ptbxl_reference.py        # PTB-XL adult reference

test/
├── smoke.test.js             # Core sanity tests
├── synth-modules.test.js     # Synthesis coverage
├── golden.test.js            # Regression tests
├── golden_regression.test.js # Seed reproducibility
├── measurement.test.js       # Measurement accuracy
├── validation.test.js        # Schema validation
└── synth_population.test.js  # Population QA gates

tools/
├── test-ecg-digitiser.sh     # ECG-Digitiser Mac compatibility
└── visual-regression.mjs     # Screenshot comparison
```

## Reference Data Sources

| Source | Usage | Location |
|--------|-------|----------|
| Rijnbeek 2001 | Pediatric norms (0-16y) | `pediatric_reference.py` |
| PTB-XL | Adult reference | `ptbxl_reference.py` |
| Internal priors | Parameter sampling | `ecg-synth-modules.js:PEDIATRIC_PRIORS` |

Internal priors = GENERATION. External references = VALIDATION. This avoids circular validation.

## Testing Strategy

| Test Type | Command | Purpose |
|-----------|---------|---------|
| All tests | `npm test` | Full suite via Vitest |
| Watch mode | `npm run test:watch` | Development |
| Coverage | `npm run test:coverage` | Coverage report |
| Python | `python -m pytest python/tests/ -v` | Validation pipeline |
| Visual | `npm run test:visual` | Screenshot comparison |

## CI Pipeline

Runs on every push to main:
1. `npm test` - All JavaScript tests
2. Python realism evaluation
3. Visual regression (Puppeteer)

Fails if: Any test fails or realism pass rate < 90%.

## Import System Architecture

```
User uploads file
       │
       ▼
┌──────────────────┐
│ File type check  │
└────────┬─────────┘
         │
    ┌────┴────┬─────────────┐
    ▼         ▼             ▼
  .csv      .json        .pdf/.png/.jpg
    │         │             │
    ▼         ▼             ▼
parseCSV   Direct      Load image
toECG()    load        + calibrate
    │         │             │
    └────┬────┴─────────────┘
         ▼
  Standard ECG format
  { fs, leads_uV, ... }
         │
         ▼
  Render + measure
```
