#!/usr/bin/env python3
"""
Interactive template builder for ECG digitization (OpenCV ROI selection).

This helps you create a template JSON with normalized crop boxes for each lead panel.

Usage:
  python build_template_opencv.py --image scan.png --out template.json

Workflow:
  - The script will ask you to select ROIs in order for all panels:
    I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6, II_rhythm
  - Use the mouse to draw a rectangle for each panel in that order.
  - Press ENTER/SPACE after the last ROI to accept.
  - The template JSON will be written to --out with normalized [x0,y0,x1,y1] boxes.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


LEAD_ORDER = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6", "II_rhythm"]


def build_template(image_path: str, out_path: str, speed: float, gain: float, name: str | None) -> None:
    bgr = cv2.imread(image_path)
    if bgr is None:
        raise FileNotFoundError(image_path)

    prompt = (
        "Select ROIs in this order (press ENTER or SPACE after the last one):\n"
        + ", ".join(LEAD_ORDER)
        + "\nUse 'c' to cancel/clear selections."
    )
    print(prompt)
    rois = cv2.selectROIs("ECG template builder", bgr, showCrosshair=True, fromCenter=False)
    cv2.destroyAllWindows()

    if rois is None or len(rois) != len(LEAD_ORDER):
        raise RuntimeError(f"Expected {len(LEAD_ORDER)} ROIs, got {len(rois) if rois is not None else 0}")

    hgt, wid = bgr.shape[:2]
    boxes = []
    for (x, y, w, h) in rois:
        x0 = x / wid
        y0 = y / hgt
        x1 = (x + w) / wid
        y1 = (y + h) / hgt
        boxes.append([float(x0), float(y0), float(x1), float(y1)])

    crops = {lead: box for lead, box in zip(LEAD_ORDER, boxes)}
    rhythm = crops.pop("II_rhythm")

    tpl = {
        "name": name or Path(out_path).stem,
        "calibration": {"speed_mm_per_s": float(speed), "gain_mm_per_mV": float(gain)},
        "crops": crops,
        "rhythm_crop": rhythm,
        "lead_layout_on_print": {
            "row1": ["I", "aVR", "V1", "V4"],
            "row2": ["II", "aVL", "V2", "V5"],
            "row3": ["III", "aVF", "V3", "V6"],
            "row4": ["II_rhythm"],
        },
    }

    Path(out_path).write_text(json.dumps(tpl, indent=2))
    print(f"Wrote template to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True, help="ECG scan/photo to sample crop boxes from")
    parser.add_argument("--out", required=True, help="Output template JSON path")
    parser.add_argument("--speed", type=float, default=25.0, help="Paper speed (mm/s)")
    parser.add_argument("--gain", type=float, default=10.0, help="Gain (mm/mV)")
    parser.add_argument("--name", type=str, default=None, help="Optional template name")
    args = parser.parse_args()

    build_template(args.image, args.out, speed=args.speed, gain=args.gain, name=args.name)


if __name__ == "__main__":
    main()
