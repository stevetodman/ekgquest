ECG Digitize Toolkit (template-driven) — v0.2.0

This repo/toolkit codifies two cleanly separated steps:

1) digitize_from_image.py
   Converts a scanned ECG print image -> a digitized ECGZIP package (CSVs + metadata + optional QA overlays).

2) render_from_zip.py
   Converts the digitized ECGZIP package -> a paper-like rendered PNG/PDF.
   (This step does NOT use the original image.)

New in v0.2.0:
  - Explicit ECGZIP schema_version (ecgzip-1.0)
  - SHA-256 checksums stored in metadata.json
  - validate_zip.py to sanity-check and (optionally) verify checksums
  - spec/ecgzip.md describing the on-disk contract

Quick start:
  pip install opencv-python numpy pandas scipy matplotlib pillow

  # 1) Create/adjust a template (normalized crop boxes)
  python build_template_opencv.py --image scan.png --out template.json

  # 2) Digitize (image -> ECGZIP)
  python digitize_from_image.py --image scan.png --template template.json --out out.ecgzip.zip --qa

  # 3) Validate package (recommended for batch runs)
  python validate_zip.py --zip out.ecgzip.zip
  python validate_zip.py --zip out.ecgzip.zip --strict

  # 4) Render (ECGZIP -> PNG/PDF) without using the source image
  python render_from_zip.py --zip out.ecgzip.zip --out out.png
  python render_from_zip.py --zip out.ecgzip.zip --out out.pdf

Key limitations:
  - Standard 3×4 ECG printouts contain ~2.5 s per lead (except the long rhythm strip).
    You cannot reconstruct a true 10 s simultaneous 12‑lead from a typical print.
  - Baseline is approximated (median of traced y). For accurate ST measurement,
    you may need baseline refinement (beat segmentation / isoelectric TP segment finding).
  - Templates are required unless your scans are extremely consistent and the grid estimator is robust.

Recommended production additions:
  - Reject runs with poor trace coverage (qc metrics are included in metadata.json).
  - Record provenance: template hash, calibration, pixel/mm estimate, tool version.
  - Add unit tests on synthetic waveforms and a small set of known-good examples.

Format spec:
  See spec/ecgzip.md
