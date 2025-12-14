#!/usr/bin/env python3
"""
Interactive template builder (OpenCV GUI)

This helps you create the normalized crop boxes needed by digitize_from_image.py.

You will be prompted to draw rectangles (drag mouse) for each lead panel in order:
  I, II, III, aVR, aVL, aVF, V1, V2, V3, V4, V5, V6, and the long rhythm strip (Lead II).

Controls:
  - Click and drag to draw a rectangle.
  - Press 'c' to confirm the current rectangle and move to the next panel.
  - Press 'r' to reset the current rectangle.
  - Press 'q' to quit (template written with completed boxes).

Usage:
  python build_template_opencv.py --image scan.png --out template.json

Notes:
  - Requires a desktop environment (won't work in headless servers without display forwarding).
  - The output crop boxes are normalized to [0..1] relative to image width/height.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Tuple, Optional

import cv2
import numpy as np


LEADS = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]
RHYTHM_NAME = "II_rhythm"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--image", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--speed", type=float, default=25.0, help="mm/s")
    p.add_argument("--gain", type=float, default=10.0, help="mm/mV")
    args = p.parse_args()

    img_bgr = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise FileNotFoundError(args.image)
    h, w = img_bgr.shape[:2]

    state = {
        "drawing": False,
        "ix": 0, "iy": 0,
        "x0": 0, "y0": 0, "x1": 0, "y1": 0,
        "rect": None,  # (x0,y0,x1,y1) in pixels
    }

    order = LEADS + [RHYTHM_NAME]
    crops: Dict[str, Tuple[float,float,float,float]] = {}
    idx = 0

    def draw_overlay(frame):
        frame2 = frame.copy()
        label = order[idx]
        cv2.putText(frame2, f"Draw box for: {label}  (c=confirm, r=reset, q=quit)", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0,0,0), 3, cv2.LINE_AA)
        cv2.putText(frame2, f"Draw box for: {label}  (c=confirm, r=reset, q=quit)", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,255), 1, cv2.LINE_AA)
        if state["rect"] is not None:
            x0,y0,x1,y1 = state["rect"]
            cv2.rectangle(frame2, (x0,y0), (x1,y1), (0,255,0), 2)
        return frame2

    def mouse_cb(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN:
            state["drawing"] = True
            state["ix"], state["iy"] = x, y
            state["rect"] = (x, y, x, y)
        elif event == cv2.EVENT_MOUSEMOVE and state["drawing"]:
            x0,y0 = state["ix"], state["iy"]
            state["rect"] = (min(x0,x), min(y0,y), max(x0,x), max(y0,y))
        elif event == cv2.EVENT_LBUTTONUP:
            state["drawing"] = False
            x0,y0 = state["ix"], state["iy"]
            state["rect"] = (min(x0,x), min(y0,y), max(x0,x), max(y0,y))

    win = "ECG Template Builder"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(win, mouse_cb)

    while True:
        frame = draw_overlay(img_bgr)
        cv2.imshow(win, frame)
        k = cv2.waitKey(10) & 0xFF

        if k == ord('r'):
            state["rect"] = None
        elif k == ord('c'):
            if state["rect"] is None:
                continue
            x0,y0,x1,y1 = state["rect"]
            # normalize
            box = (x0 / w, y0 / h, x1 / w, y1 / h)
            crops[order[idx]] = box
            idx += 1
            state["rect"] = None
            if idx >= len(order):
                break
        elif k == ord('q'):
            break

    cv2.destroyAllWindows()

    tpl = {
        "name": "custom_template",
        "calibration": {"speed_mm_per_s": args.speed, "gain_mm_per_mV": args.gain},
        "lead_layout_on_print": {
            "row1": ["I","aVR","V1","V4"],
            "row2": ["II","aVL","V2","V5"],
            "row3": ["III","aVF","V3","V6"],
            "row4": ["II_rhythm"]
        },
        "px_per_mm": None,
        "crops": {k: v for k, v in crops.items() if k in LEADS},
        "rhythm_crop": crops.get(RHYTHM_NAME, None),
        "notes": [
            "Created with build_template_opencv.py",
            "Normalized crops are relative to the original image size."
        ]
    }

    Path(args.out).write_text(json.dumps(tpl, indent=2))
    print(f"Wrote template: {args.out}")


if __name__ == "__main__":
    main()
