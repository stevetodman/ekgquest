#!/usr/bin/env python3
"""
Digitize a scanned/photographed printed 12-lead ECG into a structured ECGZIP.

Pipeline (template-driven):
  1) Load ECG image
  2) Estimate grid scale (px per mm) from the red grid (or use template hint)
  3) For each lead panel crop: isolate the black trace and trace it column-wise
  4) Convert pixels -> mV and seconds using calibration
  5) Resample to uniform sampling rate (default 500 Hz)
  6) Write a ZIP with waveforms + metadata (+ optional QA overlays)

Limitation:
  A standard 3x4 print layout contains ~2.5 s per lead (except the rhythm strip).
  You cannot recover a true simultaneous 10 s 12-lead from a typical print.

Usage:
  python digitize_from_image.py --image scan.png --template template.json --out out.ecgzip.zip
  python digitize_from_image.py --image scan.png --template template.json --out out.ecgzip.zip --qa
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import io
import json
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
import pandas as pd
from scipy.interpolate import interp1d

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover
    raise RuntimeError("Missing dependency: pillow. Install with: pip install pillow") from exc


TOOL_NAME = "ecg-digitizer"
TOOL_VERSION = "0.2.0"
SCHEMA_VERSION = "ecgzip-1.0"

SEGMENT_DURATION_S_DEFAULT = 2.5
RHYTHM_DURATION_S_DEFAULT = 10.0
LEADS_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]


@dataclass
class Calibration:
    speed_mm_per_s: float = 25.0
    gain_mm_per_mV: float = 10.0


def sha256_bytes(data: bytes) -> str:
    hsh = hashlib.sha256()
    hsh.update(data)
    return hsh.hexdigest()


def load_template(path: str) -> dict:
    return json.loads(Path(path).read_text())


def imread_rgb(path: str) -> np.ndarray:
    bgr = cv2.imread(path, cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(path)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def estimate_grid_px_per_mm(rgb: np.ndarray) -> float:
    """
    Estimate pixels per mm by detecting the red ECG grid. Best-effort only.
    """
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)

    lower1 = np.array([0, 40, 40])
    upper1 = np.array([10, 255, 255])
    lower2 = np.array([170, 40, 40])
    upper2 = np.array([180, 255, 255])

    mask1 = cv2.inRange(hsv, lower1, upper1)
    mask2 = cv2.inRange(hsv, lower2, upper2)
    mask = cv2.bitwise_or(mask1, mask2)
    mask = cv2.medianBlur(mask, 5)

    proj_x = mask.mean(axis=0).astype(np.float32)
    proj_y = mask.mean(axis=1).astype(np.float32)

    def dominant_period(signal: np.ndarray, min_period: int = 3, max_period: int = 80) -> Optional[float]:
        sig = signal - float(signal.mean())
        if np.allclose(sig, 0):
            return None
        ac = np.correlate(sig, sig, mode="full")
        ac = ac[ac.size // 2 :]
        ac[:min_period] = 0
        max_period = min(max_period, ac.size - 1)
        region = ac[min_period:max_period]
        if region.size == 0:
            return None
        lag = int(region.argmax()) + min_period
        return float(lag)

    px_small_x = dominant_period(proj_x, min_period=3, max_period=60)
    px_small_y = dominant_period(proj_y, min_period=3, max_period=60)

    px_small = None
    for val in [px_small_x, px_small_y]:
        if val is not None and 3 <= val <= 60:
            px_small = val if px_small is None else (px_small + val) / 2.0

    if px_small is None:
        raise RuntimeError("Could not estimate grid spacing; provide px_per_mm in template.")

    return float(px_small)  # small box is 1 mm


def crop_norm(rgb: np.ndarray, box: Tuple[float, float, float, float]) -> np.ndarray:
    hgt, wid = rgb.shape[:2]
    x0, y0, x1, y1 = box
    xa = int(round(x0 * wid))
    xb = int(round(x1 * wid))
    ya = int(round(y0 * hgt))
    yb = int(round(y1 * hgt))
    xa, xb = sorted((max(0, xa), min(wid, xb)))
    ya, yb = sorted((max(0, ya), min(hgt, yb)))
    return rgb[ya:yb, xa:xb].copy()


def isolate_trace_mask(panel_rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(panel_rgb, cv2.COLOR_RGB2HSV)
    v = hsv[..., 2]
    mask = (v < 80).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    return mask


def trace_columnwise(mask: np.ndarray) -> np.ndarray:
    hgt, wid = mask.shape
    ys = np.full((wid,), np.nan, dtype=np.float32)
    for x in range(wid):
        y_idx = np.where(mask[:, x] > 0)[0]
        if y_idx.size:
            ys[x] = np.median(y_idx)

    idx = np.arange(wid)
    good = np.isfinite(ys)
    if good.sum() >= 2:
        interp = interp1d(idx[good], ys[good], kind="linear", bounds_error=False, fill_value="extrapolate")
        ys = interp(idx).astype(np.float32)
    return ys


def pixels_to_mV(y_px: np.ndarray, px_per_mm: float, gain_mm_per_mV: float) -> Tuple[np.ndarray, float]:
    px_per_mV = px_per_mm * gain_mm_per_mV
    baseline = float(np.median(y_px[np.isfinite(y_px)]))
    return (baseline - y_px) / px_per_mV, baseline


def pixels_to_time_s(x_px: np.ndarray, px_per_mm: float, speed_mm_per_s: float) -> np.ndarray:
    return (x_px / px_per_mm) / speed_mm_per_s


def resample_uniform(t: np.ndarray, y: np.ndarray, fs: float) -> Tuple[np.ndarray, np.ndarray]:
    t0, t1 = float(t[0]), float(t[-1])
    n = int(np.floor((t1 - t0) * fs)) + 1
    t_new = t0 + np.arange(n, dtype=np.float64) / float(fs)
    interp = interp1d(t, y, kind="linear", bounds_error=False, fill_value="extrapolate")
    y_new = interp(t_new)
    return t_new.astype(np.float64), np.asarray(y_new, dtype=np.float64)


def overlay_trace(panel_rgb: np.ndarray, y_px: np.ndarray) -> np.ndarray:
    out = panel_rgb.copy()
    hgt, wid = out.shape[:2]
    for x in range(min(wid, y_px.shape[0])):
        y_val = y_px[x]
        if not np.isfinite(y_val):
            continue
        yi = int(round(float(y_val)))
        if 0 <= yi < hgt:
            out[max(0, yi - 1) : min(hgt, yi + 2), x, :] = [0, 255, 0]
    return out


def save_ecgzip(out_zip: str, files: Dict[str, bytes], metadata: dict) -> None:
    metadata = dict(metadata)
    metadata.setdefault("schema_version", SCHEMA_VERSION)
    metadata.setdefault("tool", {"name": TOOL_NAME, "version": TOOL_VERSION})
    metadata.setdefault("created_utc", _dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z")
    metadata.setdefault("checksums_sha256", {name: sha256_bytes(data) for name, data in files.items()})

    meta_bytes = json.dumps(metadata, indent=2, sort_keys=False).encode("utf-8")

    with zipfile.ZipFile(str(out_zip), "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
        zf.writestr("metadata.json", meta_bytes)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="Input ECG scan/photo (PNG/JPG)")
    parser.add_argument("--template", required=True, help="Template JSON with normalized crops")
    parser.add_argument("--out", required=True, help="Output ECGZIP ZIP path")
    parser.add_argument("--fs", type=float, default=500.0, help="Output sample rate (Hz)")
    parser.add_argument(
        "--segment-duration", type=float, default=SEGMENT_DURATION_S_DEFAULT, help="Segment duration per lead (s)"
    )
    parser.add_argument("--rhythm-duration", type=float, default=RHYTHM_DURATION_S_DEFAULT, help="Rhythm strip duration (s)")
    parser.add_argument("--qa", action="store_true", help="Embed QA overlay PNGs in the ZIP")
    args = parser.parse_args()

    tpl_path = Path(args.template)
    tpl = load_template(str(tpl_path))
    cal = Calibration(**tpl.get("calibration", {}))
    rgb = imread_rgb(args.image)

    px_per_mm = tpl.get("px_per_mm")
    if px_per_mm is None:
        px_per_mm = estimate_grid_px_per_mm(rgb)

    crops = tpl["crops"]
    rhythm_crop = tpl["rhythm_crop"]

    seg_cols: Dict[str, np.ndarray] = {"time_s": None}  # type: ignore[assignment]
    qc_per_lead: Dict[str, dict] = {}
    qa_files: Dict[str, bytes] = {}

    for lead in LEADS_12:
        panel = crop_norm(rgb, tuple(crops[lead]))
        mask = isolate_trace_mask(panel)
        coverage = float(np.mean(np.any(mask > 0, axis=0)))

        y_px = trace_columnwise(mask)
        y_mV, baseline_px = pixels_to_mV(y_px, float(px_per_mm), float(cal.gain_mm_per_mV))
        x_px = np.arange(panel.shape[1], dtype=np.float32)
        t = pixels_to_time_s(x_px, float(px_per_mm), float(cal.speed_mm_per_s))

        keep = t <= float(args.segment_duration) + 1e-6
        t2 = t[keep]
        y2 = y_mV[keep]
        if t2.size < 2:
            raise RuntimeError(f"Lead {lead}: too few samples; check crop template.")

        t_u, y_u = resample_uniform(t2, y2, fs=float(args.fs))
        t_u = t_u - t_u[0]

        seg_cols["time_s"] = t_u
        seg_cols[f"{lead}_mV"] = y_u

        qc_per_lead[lead] = {
            "trace_coverage": coverage,
            "panel_width_px": int(panel.shape[1]),
            "panel_height_px": int(panel.shape[0]),
            "baseline_px": float(baseline_px),
        }

        if args.qa:
            overlay = overlay_trace(panel, y_px)
            buf = io.BytesIO()
            Image.fromarray(overlay.astype(np.uint8)).save(buf, format="PNG")
            qa_files[f"qa/{lead}_overlay.png"] = buf.getvalue()

    seg_df = pd.DataFrame(seg_cols)

    panel = crop_norm(rgb, tuple(rhythm_crop))
    mask = isolate_trace_mask(panel)
    coverage = float(np.mean(np.any(mask > 0, axis=0)))
    y_px = trace_columnwise(mask)
    y_mV, baseline_px = pixels_to_mV(y_px, float(px_per_mm), float(cal.gain_mm_per_mV))
    x_px = np.arange(panel.shape[1], dtype=np.float32)
    t = pixels_to_time_s(x_px, float(px_per_mm), float(cal.speed_mm_per_s))

    keep = t <= float(args.rhythm_duration) + 1e-6
    t2 = t[keep]
    y2 = y_mV[keep]
    t_u, y_u = resample_uniform(t2, y2, fs=float(args.fs))
    t_u = t_u - t_u[0]
    rhythm_df = pd.DataFrame({"time_s": t_u, "II_mV": y_u})

    if args.qa:
        overlay = overlay_trace(panel, y_px)
        buf = io.BytesIO()
        Image.fromarray(overlay.astype(np.uint8)).save(buf, format="PNG")
        qa_files["qa/II_rhythm_overlay.png"] = buf.getvalue()

    qc = {
        "segments": {
            "duration_s": float(args.segment_duration),
            "fs_hz": float(args.fs),
            "per_lead": qc_per_lead,
        },
        "rhythm": {
            "lead": "II",
            "duration_s": float(args.rhythm_duration),
            "fs_hz": float(args.fs),
            "trace_coverage": coverage,
            "panel_width_px": int(panel.shape[1]),
            "panel_height_px": int(panel.shape[0]),
            "baseline_px": float(baseline_px),
        },
    }

    seg_duration = float(seg_df["time_s"].iloc[-1] - seg_df["time_s"].iloc[0]) if len(seg_df) > 1 else 0.0
    rhythm_duration = float(rhythm_df["time_s"].iloc[-1] - rhythm_df["time_s"].iloc[0]) if len(rhythm_df) > 1 else 0.0

    signals = {
        "segments_12lead": {
            "file": "ecg_12lead_segments_2p5s_500Hz.csv",
            "fs_hz": float(args.fs),
            "duration_s": seg_duration,
            "units": "mV",
            "leads": LEADS_12,
        },
        "rhythm_II": {
            "file": "ecg_leadII_rhythm_10s_500Hz.csv",
            "fs_hz": float(args.fs),
            "duration_s": rhythm_duration,
            "units": "mV",
            "leads": ["II"],
        },
    }

    template_hash = sha256_bytes(tpl_path.read_bytes())

    metadata = {
        "schema_version": SCHEMA_VERSION,
        "tool": {"name": TOOL_NAME, "version": TOOL_VERSION},
        "calibration": {"speed_mm_per_s": cal.speed_mm_per_s, "gain_mm_per_mV": cal.gain_mm_per_mV},
        "px_per_mm_estimated": float(px_per_mm),
        "template": {"name": tpl.get("name"), "sha256": template_hash},
        "lead_layout_on_print": tpl.get("lead_layout_on_print"),
        "signals": signals,
        "qc": qc,
        "notes": [
            "Template-driven cropping; adjust template if scan margins/scale differ.",
            "Baseline set to median y of traced points (approximate isoelectric).",
            "3x4 print layouts contain ~2.5 s per lead; only the rhythm strip provides ~10 s.",
        ],
    }

    files: Dict[str, bytes] = {}
    files["ecg_12lead_segments_2p5s_500Hz.csv"] = seg_df.to_csv(index=False).encode("utf-8")
    files["ecg_leadII_rhythm_10s_500Hz.csv"] = rhythm_df.to_csv(index=False).encode("utf-8")
    files.update(qa_files)

    save_ecgzip(args.out, files=files, metadata=metadata)


if __name__ == "__main__":
    main()
