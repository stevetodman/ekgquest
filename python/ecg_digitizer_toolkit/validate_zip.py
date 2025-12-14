#!/usr/bin/env python3
"""ecg-digitizer: ECGZIP validator

Validate the internal consistency of an ECGZIP package.

Checks:
  - required files present
  - metadata.json is parseable
  - optional checksum verification (if checksums_sha256 present)
  - CSV columns, monotonic time, approximate sampling rate

Usage:
  python validate_zip.py --zip out.ecgzip.zip
  python validate_zip.py --zip out.ecgzip.zip --strict
  python validate_zip.py --zip out.ecgzip.zip --require-checksums
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


REQUIRED_FILES = [
    "ecg_12lead_segments_2p5s_500Hz.csv",
    "ecg_leadII_rhythm_10s_500Hz.csv",
    "metadata.json",
]

LEADS_12 = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]


def sha256_bytes(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def warn(msg: str) -> None:
    print(f"WARN: {msg}", file=sys.stderr)


def infer_fs(time_s: np.ndarray) -> float:
    if time_s.size < 3:
        return float("nan")
    dt = np.diff(time_s)
    dt = dt[np.isfinite(dt)]
    if dt.size == 0:
        return float("nan")
    med = float(np.median(dt))
    if med <= 0:
        return float("nan")
    return 1.0 / med


def validate_csv_segments(df: pd.DataFrame, strict: bool) -> List[str]:
    errors: List[str] = []
    if "time_s" not in df.columns:
        errors.append("segments CSV missing column: time_s")
        return errors

    # Lead columns
    missing = [f"{ld}_mV" for ld in LEADS_12 if f"{ld}_mV" not in df.columns]
    if missing:
        msg = f"segments CSV missing lead columns: {', '.join(missing)}"
        if strict:
            errors.append(msg)
        else:
            warn(msg)

    t = df["time_s"].to_numpy(dtype=float)
    if not np.all(np.isfinite(t)):
        errors.append("segments time_s contains non-finite values")
    if t.size >= 2 and not np.all(np.diff(t) > 0):
        errors.append("segments time_s is not strictly increasing")

    return errors


def validate_csv_rhythm(df: pd.DataFrame) -> List[str]:
    errors: List[str] = []
    for col in ["time_s", "II_mV"]:
        if col not in df.columns:
            errors.append(f"rhythm CSV missing column: {col}")
    if errors:
        return errors

    t = df["time_s"].to_numpy(dtype=float)
    if not np.all(np.isfinite(t)):
        errors.append("rhythm time_s contains non-finite values")
    if t.size >= 2 and not np.all(np.diff(t) > 0):
        errors.append("rhythm time_s is not strictly increasing")
    return errors


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--zip", required=True, help="Input ECGZIP package (ZIP)")
    p.add_argument("--strict", action="store_true", help="Fail if schema/version/columns not as expected")
    p.add_argument("--require-checksums", action="store_true", help="Fail if checksums_sha256 missing")
    args = p.parse_args()

    errors: List[str] = []
    with zipfile.ZipFile(args.zip, "r") as z:
        names = set(z.namelist())
        for f in REQUIRED_FILES:
            if f not in names:
                errors.append(f"missing required file: {f}")

        if errors:
            for e in errors:
                fail(e)
            return 2

        meta = json.loads(z.read("metadata.json"))

        schema_version = meta.get("schema_version")
        if schema_version is None:
            if args.strict:
                errors.append("metadata missing schema_version")
            else:
                warn("metadata missing schema_version (older ECGZIP?)")
        else:
            if args.strict and schema_version != "ecgzip-1.0":
                errors.append(f"unexpected schema_version: {schema_version}")

        checksums: Dict[str, str] | None = meta.get("checksums_sha256")
        if checksums is None:
            if args.require_checksums or args.strict:
                errors.append("metadata missing checksums_sha256")
            else:
                warn("metadata missing checksums_sha256 (cannot verify file integrity)")
        else:
            # Verify all listed checksums
            for fname, expected in checksums.items():
                if fname not in names:
                    errors.append(f"checksum entry references missing file: {fname}")
                    continue
                actual = sha256_bytes(z.read(fname))
                if actual.lower() != str(expected).lower():
                    errors.append(f"checksum mismatch for {fname}: expected {expected}, got {actual}")

        # Load CSVs
        seg_df = pd.read_csv(io.BytesIO(z.read("ecg_12lead_segments_2p5s_500Hz.csv")))
        rhy_df = pd.read_csv(io.BytesIO(z.read("ecg_leadII_rhythm_10s_500Hz.csv")))

    # Validate content
    errors.extend(validate_csv_segments(seg_df, strict=args.strict))
    errors.extend(validate_csv_rhythm(rhy_df))

    # Sampling rates / durations (informational; strict tolerances if strict)
    seg_t = seg_df["time_s"].to_numpy(dtype=float) if "time_s" in seg_df.columns else np.array([])
    rhy_t = rhy_df["time_s"].to_numpy(dtype=float) if "time_s" in rhy_df.columns else np.array([])
    seg_fs = infer_fs(seg_t) if seg_t.size else float("nan")
    rhy_fs = infer_fs(rhy_t) if rhy_t.size else float("nan")
    seg_dur = float(seg_t[-1] - seg_t[0]) if seg_t.size >= 2 else float("nan")
    rhy_dur = float(rhy_t[-1] - rhy_t[0]) if rhy_t.size >= 2 else float("nan")

    print(f"segments: n={len(seg_df):d}, duration_s={seg_dur:.3f}, fs_hz≈{seg_fs:.2f}")
    print(f"rhythm  : n={len(rhy_df):d}, duration_s={rhy_dur:.3f}, fs_hz≈{rhy_fs:.2f}")

    if args.strict:
        # Require fs roughly around 500 Hz (±5%) if strict and finite
        if np.isfinite(seg_fs) and not (475.0 <= seg_fs <= 525.0):
            errors.append(f"segments fs_hz not ~500 (got {seg_fs:.2f})")
        if np.isfinite(rhy_fs) and not (475.0 <= rhy_fs <= 525.0):
            errors.append(f"rhythm fs_hz not ~500 (got {rhy_fs:.2f})")

    if errors:
        for e in errors:
            fail(e)
        return 2

    print("OK: ECGZIP package is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
