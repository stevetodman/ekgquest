#!/usr/bin/env python3
"""
Render a paper-like 12-lead ECG from a digitized ECGZIP (no source image needed).

Inputs (inside the ZIP):
  - ecg_12lead_segments_2p5s_500Hz.csv
  - ecg_leadII_rhythm_10s_500Hz.csv
  - metadata.json

Usage:
  python render_from_zip.py --zip out.ecgzip.zip --out out.png
  python render_from_zip.py --zip out.ecgzip.zip --out out.pdf
"""

from __future__ import annotations

import argparse
import io
import json
import zipfile
from typing import Dict, List

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


DEFAULT_LAYOUT = {
    "row1": ["I", "aVR", "V1", "V4"],
    "row2": ["II", "aVL", "V2", "V5"],
    "row3": ["III", "aVF", "V3", "V6"],
    "row4": ["II_rhythm"],
}

LEADS_12 = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]


def read_zip(zip_path: str) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    with zipfile.ZipFile(zip_path, "r") as zf:
        seg_df = pd.read_csv(io.BytesIO(zf.read("ecg_12lead_segments_2p5s_500Hz.csv")))
        rhythm_df = pd.read_csv(io.BytesIO(zf.read("ecg_leadII_rhythm_10s_500Hz.csv")))
        metadata = json.loads(zf.read("metadata.json"))
    return seg_df, rhythm_df, metadata


def infer_duration(time_s: np.ndarray) -> float:
    if time_s.size < 2:
        return 0.0
    return float(time_s[-1] - time_s[0])


def render_ecg(seg_df: pd.DataFrame, rhythm_df: pd.DataFrame, metadata: dict, out_path: str, dpi: int = 200, show_grid: bool = True) -> None:
    layout = metadata.get("lead_layout_on_print") or DEFAULT_LAYOUT
    cal = metadata.get("calibration") or {}
    speed = float(cal.get("speed_mm_per_s", 25.0))
    gain = float(cal.get("gain_mm_per_mV", 10.0))

    t_seg = seg_df["time_s"].to_numpy(dtype=float)
    seg_dur = infer_duration(t_seg) or 2.5
    t_rhy = rhythm_df["time_s"].to_numpy(dtype=float)
    rhythm_dur = infer_duration(t_rhy) or 10.0
    total_dur = max(4.0 * seg_dur, rhythm_dur)

    row_height_mV = 3.0
    row_baselines = {
        "row1": 3 * row_height_mV,
        "row2": 2 * row_height_mV,
        "row3": 1 * row_height_mV,
        "row4": 0 * row_height_mV,
    }
    col_offsets = [0.0, 1.0 * seg_dur, 2.0 * seg_dur, 3.0 * seg_dur]

    fig = plt.figure(figsize=(12, 6.5), dpi=dpi)
    ax = fig.add_axes([0.03, 0.05, 0.94, 0.9])
    ax.set_xlim(0, total_dur)
    ax.set_ylim(-2.0, row_baselines["row1"] + 2.0)

    if show_grid:
        small_x = 1.0 / speed
        big_x = 5.0 / speed
        small_y = 1.0 / gain
        big_y = 5.0 / gain

        ax.set_xticks(np.arange(0, total_dur + 1e-9, big_x))
        ax.set_xticks(np.arange(0, total_dur + 1e-9, small_x), minor=True)
        ax.set_yticks(np.arange(-2, row_baselines["row1"] + 2.0001, big_y))
        ax.set_yticks(np.arange(-2, row_baselines["row1"] + 2.0001, small_y), minor=True)
        ax.grid(which="major", linewidth=0.6)
        ax.grid(which="minor", linewidth=0.2)
        ax.set_aspect(gain / speed)

    ax.tick_params(labelbottom=False, labelleft=False, length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    def plot_segment(lead_name: str, row_key: str, col_idx: int) -> None:
        col = f"{lead_name}_mV"
        if col not in seg_df.columns:
            return
        x0 = col_offsets[col_idx]
        y0 = row_baselines[row_key]
        ax.set_prop_cycle(None)
        ax.plot(t_seg + x0, seg_df[col].to_numpy(dtype=float) + y0, linewidth=0.9)
        ax.text(x0 + 0.06, y0 + 1.25, lead_name, fontsize=10, ha="left", va="center")

    for row_key in ["row1", "row2", "row3"]:
        leads = layout.get(row_key, [])
        for j, lead in enumerate(leads[:4]):
            plot_segment(lead, row_key, j)

    y0 = row_baselines["row4"]
    ax.set_prop_cycle(None)
    ax.plot(t_rhy, rhythm_df["II_mV"].to_numpy(dtype=float) + y0, linewidth=0.9)
    ax.text(0.06, y0 + 1.25, "II", fontsize=10, ha="left", va="center")

    ax.text(total_dur - 0.05, -1.75, f"{speed:g} mm/s   {gain:g} mm/mV", fontsize=9, ha="right", va="bottom")

    fig.savefig(out_path, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True, help="Input ECGZIP package (ZIP)")
    parser.add_argument("--out", required=True, help="Output path (.png or .pdf)")
    parser.add_argument("--dpi", type=int, default=200, help="DPI for raster outputs")
    parser.add_argument("--no-grid", action="store_true", help="Disable ECG paper grid")
    args = parser.parse_args()

    seg_df, rhythm_df, meta = read_zip(args.zip)
    render_ecg(seg_df, rhythm_df, meta, out_path=args.out, dpi=args.dpi, show_grid=(not args.no_grid))


if __name__ == "__main__":
    main()
