# EKGQuest Roadmap

Goal: world-class ECG teaching lab — MUSE-style viewing/printing + explainable measurements + high-fidelity pediatric synthetic cases (no waveform watermark).

## Non-negotiables
- Educational use; not for diagnosis/patient care.
- No waveform watermark; provenance lives in metadata + UI chrome (hideable in quiz mode).
- One canonical ECG JSON schema.

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

## Future Ideas
- More diagnoses: AVB, LBBB, LAFB, ectopy, pacing
- Morphology quizzes (identify patterns)
- PDF report export with measurements
- Multi-case session scoring
- Fiducial editing for manual annotation
