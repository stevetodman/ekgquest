# EKGQuest: Synthetic ECG Teaching Lab

A world-class in-browser ECG teaching laboratory featuring a MUSE-style viewer with accurate measurements and print-quality layouts, plus a high-fidelity pediatric ECG synthesizer validated against published reference data.

**North Star**: Enable learners and educators to practice ECG interpretation without needing real patient data.

## Quick Start

```bash
# Serve locally (any static server works)
python -m http.server 8000

# Open the flagship teaching lab
open http://localhost:8000/viewer/ekgquest_lab.html
```

## Project Structure

```
ekgquest/
├── viewer/
│   ├── js/
│   │   ├── ecg-core.js           # Core utilities, R-peak detection, measurements
│   │   ├── ecg-synth-modules.js  # ECG synthesizer (all-in-one)
│   │   └── ecg-worker.js         # Web Worker for off-thread analysis
│   └── ekgquest_lab.html         # ⭐ Teaching lab (viewer + synthesizer)
├── python/
│   └── realism_lab/              # Validation toolkit
│       ├── metrics.py            # Physics, distribution, spectral metrics
│       ├── eval_realism.py       # Evaluation pipeline
│       ├── pediatric_reference.py  # Rijnbeek 2001 norms
│       └── ptbxl_reference.py    # PTB-XL adult reference
├── data/
│   └── pediatric_priors.json     # Age-specific ECG norms (source of truth)
├── test/                         # JavaScript tests
└── docs/                         # Documentation
```

## Key Features

### EKGQuest Lab (Flagship)
- **Quiz/Teach Mode**: Toggle between hidden and revealed measurements for teaching
- **One-click reveal**: "Reveal Answers" button for classroom use
- **Professional calipers**: Multiple measurements, drag-to-adjust, snap to R-peaks, Shift for H/V constraint
- **Export options**: Print Worksheet (quiz), Print Answer Key (teach), PNG, JSON, CSV
- **Clean waveforms**: No overlays on the ECG trace; provenance in header only

### ECG Synthesizer
- **19 diagnoses**: Normal sinus, WPW, RBBB, LBBB, LAFB, LVH, RVH, SVT, Atrial flutter, AVB (1st/2nd/3rd degree), Long QT, Pericarditis, PACs, PVCs, Sinus brady/tachy
- **Age-appropriate physiology**: Validated against Rijnbeek 2001 pediatric norms (0-16 years)
- **Beat-to-beat variation**: Respiratory modulation, amplitude jitter, timing variability
- **Physics consistency**: Einthoven's law enforced on limb leads
- **Reproducible**: Deterministic output with seed control

### Viewer
- **MUSE-style layouts**: Stacked, 12-lead grid, rhythm strip
- **Accurate measurements**: PR, QRS, QT/QTc, axis calculations with age-adjusted norms
- **Print-ready**: 25mm/s, 10mm/mV scaling with calibration pulse
- **Interactive calipers**: Press 'C' to toggle; shows Δt, rate, and ΔV

### Validation Pipeline (Realism Lab)
- **5 quality gates**: Physics, Distribution, HRV, Spectral, External Reference
- **External validation**: Rijnbeek 2001 (pediatric) and PTB-XL (adult) reference data
- **CI integration**: Automated quality checks on every commit

## Testing

```bash
# JavaScript tests
npm test

# Python validation tests
cd python && python -m pytest tests/ -v

# Visual regression (requires Puppeteer)
npm run test:visual
```

## ECG JSON Schema

All ECGs use a unified JSON format:

```json
{
  "schema_version": "1.0",
  "fs": 1000,
  "duration_s": 10.0,
  "leads_uV": {
    "I": [...], "II": [...], "III": [...],
    "aVR": [...], "aVL": [...], "aVF": [...],
    "V1": [...], "V2": [...], "V3": [...],
    "V4": [...], "V5": [...], "V6": [...]
  },
  "targets": {
    "synthetic": true,
    "generator_version": "2.0-modular",
    "age_years": 8.0,
    "dx": "Normal sinus",
    "HR_bpm": 80,
    "PR_ms": 140,
    "QRS_ms": 85,
    "QTc_ms": 410,
    "axes_deg": {"P": 50, "QRS": 60, "T": 40}
  },
  "integrity": {
    "einthoven_max_abs_error_uV": 1
  }
}
```

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture and module relationships
- [SYNTHESIZER.md](docs/SYNTHESIZER.md) - ECG synthesis engine deep dive
- [REALISM_LAB.md](docs/REALISM_LAB.md) - Validation methodology and reference data
- [spec.md](docs/spec.md) - North Star spec and milestones

## External Reference Data

Validation uses published pediatric ECG norms:
- **Rijnbeek et al. 2001**: "New normal limits for the paediatric electrocardiogram" (Eur Heart J 22:702-711). 1912 Dutch children ages 0-16 years.
- **PTB-XL**: Adult reference from Wagner et al. 2020 (Scientific Data 7:154). 21,837 recordings.

## Safety Note

All generated ECGs are tagged `synthetic: true` and display a "SYNTHETIC" label. This tool is for educational purposes only, not clinical diagnosis.

## License

Educational use. See repository for details.
