# EKGQuest: Synthetic ECG Teaching Lab

A world-class in-browser ECG teaching laboratory featuring a MUSE-style viewer with accurate measurements and print-quality layouts, plus a high-fidelity pediatric ECG synthesizer validated against published reference data.

**North Star**: Enable learners and educators to practice ECG interpretation without needing real patient data.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Open http://localhost:8000
```

Or use any static server:
```bash
python -m http.server 8000
open http://localhost:8000/viewer/ekgquest_lab.html
```

## Project Structure

```
ekgquest/
├── viewer/
│   ├── js/
│   │   ├── ecg-core.js           # R-peak detection, measurements, analysis
│   │   ├── ecg-synth-modules.js  # ECG synthesizer (modular architecture)
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
├── test/                         # Vitest test suite
├── tools/                        # Development utilities
│   └── test-ecg-digitiser.sh     # ECG-Digitiser compatibility test
└── docs/                         # Documentation
```

## Key Features

### EKGQuest Lab (Flagship)

**Teaching Modes:**
- **Quiz Mode**: Hide measurements for student practice
- **Teach Mode**: Show all measurements with age-appropriate normal ranges
- **One-click reveal**: "Reveal Answers" button for classroom use

**Professional Tools:**
- **Calipers**: Press 'C' to toggle; shows Δt, rate, and ΔV; Shift for H/V constraint
- **Comparison Mode**: Store a reference ECG, overlay in blue for side-by-side teaching
- **Export**: Print Worksheet (quiz), Print Answer Key (teach), PNG, JSON, CSV

**Import Real ECGs:**
- **PDF/Image Upload**: Auto-calibration via grid detection, or manual 2-click calibration
- **CSV Import**: WebPlotDigitizer output or multi-lead CSV files
- **Full Digitization**: Imported ECGs work like generated ones (measurements, export, etc.)

### ECG Synthesizer

**23 Diagnoses:**
- Normal sinus, Sinus bradycardia, Sinus tachycardia
- WPW, RBBB, LBBB, LAFB
- LVH, RVH
- SVT (narrow), Atrial flutter (2:1), Atrial fibrillation
- 1st/2nd/3rd degree AVB (including Wenckebach and Mobitz II)
- Long QT, Pericarditis
- STEMI (anterior), Hyperkalemia, Brugada (Type 1)
- PACs, PVCs

**Physiological Accuracy:**
- Age-appropriate parameters validated against Rijnbeek 2001 pediatric norms (0-16 years)
- Beat-to-beat variation: respiratory modulation, amplitude jitter, timing variability
- Physics consistency: Einthoven's law enforced on limb leads
- Reproducible: Deterministic output with seed control

### Viewer

- **MUSE-style layouts**: Stacked, 12-lead grid, rhythm strip
- **Accurate measurements**: PR, QRS, QT/QTc, axis calculations with age-adjusted norms
- **Print-ready**: 25mm/s, 10mm/mV scaling with calibration pulse
- **Multi-lead R-peak detection**: Consensus across leads for robust detection

### Validation Pipeline (Realism Lab)

- **5 quality gates**: Physics, Distribution, HRV, Spectral, External Reference
- **External validation**: Rijnbeek 2001 (pediatric) and PTB-XL (adult) reference data
- **CI integration**: Automated quality checks on every commit

## Testing

```bash
# Run all tests (Vitest)
npm test

# Watch mode during development
npm run test:watch

# Coverage report
npm run test:coverage

# Python validation tests
python -m pytest python/tests/ -v

# Visual regression (requires Puppeteer)
npm run test:visual
```

## Code Quality

```bash
# Lint
npm run lint

# Format
npm run format
```

## ECG JSON Schema

All ECGs use a unified JSON format:

```json
{
  "schema_version": "1.0",
  "fs": 500,
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

## Importing Real ECGs

### Option 1: WebPlotDigitizer (Recommended for accuracy)

1. Open your ECG image in [WebPlotDigitizer](https://automeris.io/WebPlotDigitizer/)
2. Calibrate axes (time in seconds, voltage in mV)
3. Extract the trace points
4. Export as CSV
5. Import CSV into EKGQuest Lab

### Option 2: Direct Image Upload

1. Click "Upload ECG" in EKGQuest Lab
2. Select PDF or image file
3. Auto-calibration detects grid spacing (or use manual 2-click calibration)
4. Use calipers to measure intervals

### Option 3: ECG-Digitiser (Research-grade)

For batch processing or maximum accuracy, use [ECG-Digitiser](https://github.com/felixkrones/ECG-Digitiser) (2024 PhysioNet Challenge winner):

```bash
# Test compatibility on your Mac
bash tools/test-ecg-digitiser.sh
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
