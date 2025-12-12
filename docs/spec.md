# EKGQuest North Star Spec (WIP)

## Purpose
Build a **MUSE‑style ECG viewer** plus a **pediatric ECG synthesizer** for **education and research**. The system must be:
- **Coherent**: one schema, one measurement pipeline, one rendering pipeline.
- **Responsive**: smooth interaction on long/high‑fs signals.
- **Testable**: every change measured against objective metrics and regressions.

## Safety / Positioning (non‑negotiable)
- All generated ECGs must be clearly tagged `targets.synthetic=true` and the UI must default to an on‑screen “SYNTHETIC” label.
- Do not claim clinical equivalence; do not ship as “for diagnosis”.
- Keep a hard separation between “viewer for real ECGs” and “generator” in UX copy and metadata, even if they share infrastructure.

## Canonical ECG Schema
JSON object (versioned):
```json
{
  "schema_version": 1,
  "fs": 1000,
  "duration_s": 10.0,
  "leads_uV": { "I": [0,1], "II": [0,1] },
  "targets": { "synthetic": true, "age_years": 4, "dx": "Normal sinus" },
  "integrity": { "einthoven_max_abs_error_uV": 1 }
}
```

Requirements:
- `leads_uV` values are **µV samples** (signed int range).
- Viewer must tolerate missing leads (graceful degradation + clear errors).
- `integrity` is computed/validated on load; generator populates it on export.

## Viewer: “MUSE‑style” Definition of Done
### UX / Workflow
- Stacked + 12‑lead print + rhythm layouts; accurate calibration pulse; consistent scaling.
- Speed/gain controls; filter toggles; lead visibility; keyboard shortcuts.
- Calipers with optional snap‑to‑fiducials; fiducial edit mode (drag + confidence).
- Measurement panel with flags and confidence (PR/QRS/QT/QTc, axes; later ST metrics).
- Annotations: text + interval markers; saved inside schema.

### Print / Export
- Print/PDF output looks like a clinical strip (multi‑page when needed).
- Export: PNG, JSON (schema), CSV; later: vector PDF/SVG.

### Performance
- UI remains responsive: heavy work off main thread (Web Worker).
- Render uses downsampling/LOD so long recordings don’t hitch on pan/zoom.

## Synthesizer: “Indistinguishable pediatric ECG” Definition of Done
This is measurable, not vibes:
- **Distribution match** by age bin (newborn/infant/child/adolescent): HR/PR/QRS/QT/QTc/axes distributions and amplitude/r‑wave progression stats within thresholds.
- **Rhythm realism**: sinus variability, ectopy, SVT/flutter/AF/AV block patterns.
- **Artifact realism**: baseline wander (non‑stationary), EMG bursts, mains, motion transients; controllable SNR.
- **Physics/lead realism**: enforce Einthoven + augmented consistency and realistic lead covariance.

## Validation & Regression (must exist early)
- Golden case set: fixed seeds + fixed inputs → stable outputs for layout and measurements.
- Pure‑function tests: physics checks, R peaks, fiducials, QTc/axes.
- Visual regression for print layout: deterministic render → hash.
- “Indistinguishability harness” (local): compare real vs synth metrics; supports blinded human review later.

## Milestones
### M1 (Foundation)
- Schema versioning + validators.
- Worker-based analysis API.
- Unified viewer uses worker and stays smooth.

### M2 (Viewer parity)
- Print layout polish + export flows.
- Filters + fiducial editing + measurements panel/flags.
- Visual regressions.

### M3 (Synthesis realism v1)
- Expanded pediatric presets + rhythm generators.
- Calibrated noise/artifact model.
- Benchmark harness against real pediatric ECG stats (dataset provided locally).
