# ECG viewer + generator code bundle (work-in-progress)

## What this zip contains
- `viewer/` : HTML-only viewers (open in Chrome/Edge)
- `data/`   : example waveform exports used by some viewers

## Recommended entry points
- **Most complete (age + diagnosis generator + median-beat measurements):**
  - `viewer/ecg_synth_viewer_age_dx_worldclass_medianbeat.html`

- Age + diagnosis generator + measurements (no median-beat pipeline):
  - `viewer/ecg_synth_viewer_age_dx_worldclass_measurements.html`

- “Single ECG viewer” (loads embedded data or expects matching export):
  - `viewer/ecg_viewer_single_v5_world_class.html`
  - Earlier iterations: v2/v3/v4

## Notes
- Everything here is **synthetic / educational**.
- To use calipers: press **C**, then click two points.
- Some viewers include “snap to fiducials” and “fiducial overlay” toggles.
- If you need a real CaseBundle/NPZ pipeline later (ScenarioSpec, manifest, hashes),
  this bundle is a starting point for the viewer and measurement logic.
