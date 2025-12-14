# ECGZIP specification (ecgzip-1.0)

ECGZIP is a simple ZIP-based interchange format for digitized ECG printouts.

It is designed to separate a **lossy, image-dependent digitization step**
from **deterministic downstream steps** (rendering, measurements, export),
so that downstream processing never needs access to the original image.

## Scope and limitation

This format can represent what is present in a printed ECG image.

A standard 3×4 printed 12-lead ECG typically contains **~2.5 seconds per lead**
(plus a long rhythm strip). Therefore, a typical ECGZIP created from a printout
does **not** contain a true simultaneous 10-second 12-lead recording.

## Required ZIP entries

An ECGZIP package MUST contain:

- `ecg_12lead_segments_2p5s_500Hz.csv`
- `ecg_leadII_rhythm_10s_500Hz.csv`
- `metadata.json`

It MAY contain:

- `qa/*.png` (digitization overlays, debugging artifacts)
- additional waveform representations (future)

## Waveform CSV files

### `ecg_12lead_segments_2p5s_500Hz.csv`

Columns:

- `time_s` (seconds, float)
- `{lead}_mV` for each of 12 leads:
  - `I_mV`, `II_mV`, `III_mV`, `aVR_mV`, `aVL_mV`, `aVF_mV`, `V1_mV` ... `V6_mV`

Constraints:

- `time_s` MUST be strictly increasing.
- Units MUST be millivolts (mV).

### `ecg_leadII_rhythm_10s_500Hz.csv`

Columns:

- `time_s` (seconds, float)
- `II_mV` (Lead II in mV)

Constraints:

- `time_s` MUST be strictly increasing.
- Units MUST be millivolts (mV).

## metadata.json

metadata.json is a UTF-8 encoded JSON object. Required keys:

- `schema_version`: `"ecgzip-1.0"`
- `tool`: object with `name` and `version`
- `created_utc`: ISO-8601 UTC timestamp with a trailing `Z`
- `calibration`:
  - `speed_mm_per_s` (e.g., 25)
  - `gain_mm_per_mV` (e.g., 10)
- `checksums_sha256`: object mapping ZIP entry name -> SHA-256 hex digest

Recommended keys:

- `px_per_mm_estimated`: pixels per millimeter used for calibration
- `template`: object with template name + hash, if template-driven cropping used
- `lead_layout_on_print`: mapping that describes the printed 3×4 layout
- `signals`: an object describing each waveform file (fs_hz, duration_s, units, leads)
- `qc`: quality-control metrics (trace coverage, baseline, etc.)
- `notes`: human-readable list of limitations/assumptions

## Compatibility notes

Older ECGZIP packages may omit `schema_version` and `checksums_sha256`. Tools should
ideally support reading such packages but should warn that integrity cannot be verified.
