# Claude Code Context for EKGQuest

This file provides context for LLMs (like Claude) working on this codebase.

## Project Summary

EKGQuest is a synthetic ECG teaching lab with:
- **JavaScript synthesizer**: Generates 12-lead ECGs for 19 diagnoses, ages 0-99
- **Python validation**: 5 quality gates using external reference data
- **Browser viewers**: MUSE-style display with measurements

## Quick Reference

### Key Files

| Task | Files to Read |
|------|---------------|
| Add new diagnosis | `viewer/js/ecg-synth.js:PATHOLOGIES`, `viewer/js/ecg-synth-modules.js:morphologyModel` |
| Modify pediatric priors | `viewer/js/ecg-synth-modules.js:PEDIATRIC_PRIORS`, `python/realism_lab/metrics.py:PEDIATRIC_PRIORS` |
| Add validation metric | `python/realism_lab/metrics.py`, `python/realism_lab/eval_realism.py` |
| Fix Einthoven error | `viewer/js/ecg-synth-modules.js:morphologyModel` (lead projection) |
| Debug test failure | `test/*.test.js`, `python/tests/test_realism_lab.py` |

### Running Tests

```bash
# Node version compatibility issue workaround
/opt/homebrew/Cellar/node/24.1.0/bin/node test/smoke.test.js
/opt/homebrew/Cellar/node/24.1.0/bin/node test/synth-modules.test.js

# Python tests
python -m pytest python/tests/test_realism_lab.py -v
```

### Common Patterns

**Generate ECG in JS:**
```javascript
import { generateSyntheticECG } from './viewer/js/ecg-synth.js';
const ecg = generateSyntheticECG(8, "Normal sinus", 12345);
```

**Validate ECG in Python:**
```python
from realism_lab import load_ecg_json, compute_all_metrics, run_evaluation
ecg = load_ecg_json("case.json")
metrics = compute_all_metrics(ecg)
```

## Architecture Decisions to Respect

1. **Single JSON schema**: All ECGs use `{ fs, duration_s, leads_uV, targets, integrity }`
2. **Physics enforcement**: Einthoven's law is enforced during synthesis, not just validated
3. **External validation**: Use Rijnbeek 2001 / PTB-XL data, NOT our own priors
4. **Modular morphology**: P, QRS, T are generated independently per beat
5. **Beat-to-beat variation**: Never identical beats; use `generateBeatJitter()`

## Critical Invariants

- `leads_uV` values are in **microvolts** (µV), stored as Int16
- `targets.synthetic` must always be `true` for generated ECGs
- `integrity.einthoven_max_abs_error_uV` must be < 10 µV
- All 12 standard leads must be present

## Age-Specific Considerations

| Age | HR | PR | QRS | QTc | Axis | Notes |
|-----|----|----|-----|-----|------|-------|
| Neonate | 140 | 100 | 65 | 410 | 110° | Rightward axis normal |
| 8 years | 85 | 140 | 80 | 410 | 60° | School-age reference |
| Adult | 72 | 160 | 90 | 420 | 45° | Standard adult |

## Diagnosis Implementation Checklist

When adding a new diagnosis:

1. [ ] Add to `PATHOLOGIES` object in `ecg-synth.js`
2. [ ] Implement morphology in `morphologyModel()` switch statement
3. [ ] Add pathological exemptions in `python/configs/eval_matrix.json`
4. [ ] Add test case in `test/synth-modules.test.js`
5. [ ] Verify z-scores are reasonable or exempted
6. [ ] Run full test suite: `npm test && python -m pytest python/tests/ -v`

## Common Issues

### "Einthoven error too high"
The limb leads don't satisfy II = I + III. Check the lead projection in `morphologyModel()`:
```javascript
leads.III = leads.II - leads.I;  // Enforce after projection
```

### "is_too_smooth" spectral flag
The signal lacks realistic high-frequency content. Ensure:
1. Noise model is being applied: `noiseModel(leads, fs, noiseLevel, rng)`
2. Beat-to-beat jitter is enabled: `generateBeatJitter(...)`

### "Rijnbeek validation fails"
The ECG parameters are outside pediatric norms. Check:
1. Age is being passed correctly
2. The diagnosis has appropriate exemptions in `eval_matrix.json`
3. The sampled values are age-appropriate (use `generatePopulationSample()`)

## File Locations

```
viewer/js/ecg-synth.js        # Entry point for synthesis
viewer/js/ecg-synth-modules.js # All synthesis modules
viewer/js/ecg-core.js         # R-peak detection, measurements
python/realism_lab/metrics.py # Validation metrics
python/realism_lab/eval_realism.py # Evaluation pipeline
python/realism_lab/pediatric_reference.py # Rijnbeek 2001 data
```

## Reference Data Sources

| Source | Usage | Location |
|--------|-------|----------|
| Rijnbeek 2001 | Pediatric norms (0-16y) | `pediatric_reference.py` |
| PTB-XL | Adult reference | `ptbxl_reference.py` |
| Internal priors | Parameter sampling | `ecg-synth-modules.js:PEDIATRIC_PRIORS` |

The internal priors are used for GENERATION. The external references are used for VALIDATION. This avoids circular validation.

## Testing Strategy

| Test Type | Location | Purpose |
|-----------|----------|---------|
| Smoke tests | `test/smoke.test.js` | Core function sanity |
| Golden tests | `test/golden.test.js` | Regression detection |
| Synth tests | `test/synth-modules.test.js` | Synthesis module coverage |
| Python tests | `python/tests/test_realism_lab.py` | Validation pipeline |
| Visual regression | `tools/visual-regression.mjs` | Screenshot comparison |

## CI Pipeline

The CI runs on every push to main:
1. `test-js`: All JavaScript tests
2. `realism-lab`: Generate cases → Python evaluation → quality gate
3. `visual-regression`: Puppeteer screenshots → hash comparison
4. `lint-html`: File existence checks

Fails if: Any test fails or realism pass rate < 90%.
