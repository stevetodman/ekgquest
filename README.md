# ECG viewer + synthesizer

> North Star: Build the best in-browser ECG teaching lab: a MUSE-style viewer with accurate measurements and print-quality layouts, plus a high-fidelity pediatric ECG synthesizer that can generate realistic cases on demand—so learners can practice and educators can teach without needing real patient data.

Built for learners and educators first. The repository uses a single JSON schema (`{ fs, duration_s, leads_uV, targets, integrity }`) and shared JS utilities to keep all viewers in sync. Legacy snapshots are kept only as release artifacts under `releases/`.

## Layout
- `viewer/` — active viewers using `<script type="module">` and the shared `js/ecg-core.js`.
  - `ecg_synth_viewer_age_dx_worldclass_medianbeat.html` (generator + measurements)
  - `ecg_viewer_unified.html` (stacked + print layouts, fiducials/median measurements, file loader)
  - `ecg_viewer_single_v5_world_class.html` (normalized 15-lead viewer)
  - `ecg_viewer.html` (minimal viewer)
- `docs/ROADMAP.md` — North Star plan and milestones for the flagship teaching lab.
- `viewer/js/ecg-core.js` — normalization, physics checks, R-peak detection, median-beat + fiducials, formatters.
- `data/` — normalized sample ECGs.
- `releases/` — zipped/archived snapshots (release artifacts only).

## Run locally
Serve the repo so `fetch()` can load JSON (any static server works):
```bash
python -m http.server 8000
```
Then open `http://localhost:8000/viewer/ecg_synth_viewer_age_dx_worldclass_medianbeat.html` (or the other viewers).

## Tests
Smoke tests for the pure functions:
```bash
npm test
```

## Notes
- Everything here is synthetic / educational and meant for teaching practice.
- No watermarks on prints/exports; synthetic/real status stays in metadata and the in-app “SYNTHETIC” label.
- Calipers: press **C** or use the Calipers toggle; click two points. Some viewers snap fiducials/median beats in the UI.
