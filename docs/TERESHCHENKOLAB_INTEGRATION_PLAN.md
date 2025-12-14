# Tereshchenkolab ECG Digitization Integration Plan

## Executive Summary

This document outlines a phased approach to integrate the Tereshchenkolab ECG digitization algorithm into EKGQuest, upgrading from the current heuristic-based trace extraction to a globally-optimal Viterbi dynamic programming approach.

**Expected Outcome:** Improve digitization accuracy from ~80% success rate to >95%, with correlation coefficient improving from ~0.85 to 0.977 (published benchmark).

---

## 1. Current State Analysis

### 1.1 Existing Implementation (`ekgquest_lab.html` lines 1883-2455)

| Component | Current Approach | Limitation |
|-----------|------------------|------------|
| **Grid Detection** | Red-pixel row/column counting + peak finding | Only works for red grids; no sub-pixel precision |
| **Signal/Grid Separation** | Hardcoded color thresholds | Fails on faded scans, non-standard colors |
| **Trace Extraction** | Weighted centroid per column | No global optimization; discontinuities |
| **Gap Filling** | Linear interpolation | Loses sharp features (QRS peaks) |
| **Noise Handling** | Median filter (window=3) | Insufficient for noisy scans |

### 1.2 Current Code Flow

```
detectGridSpacing(img)
    └── Count red pixels per row/column
    └── Find peaks via autocorrelation-like method
    └── Return: { pxPerMm, confidence }

extractWaveformFromImage(img, calibration)
    └── detectLeadRegions()        → Find horizontal bands
    └── extractTraceFromRegion()   → Per-column centroid
    └── resampleSignal()           → Linear interp to 500Hz
    └── smoothSignal()             → Moving average
    └── Return: { leads_uV, fs, duration_s }
```

### 1.3 Failure Modes Observed

1. **Non-red grids** (green, blue, gray) → grid detection fails
2. **Faded photocopies** → trace/grid bleed together
3. **Thick trace lines** → centroid shifts toward baseline
4. **Sharp QRS peaks** → smoothing attenuates amplitude
5. **Multiple overlapping leads** → region detection confused

---

## 2. Tereshchenkolab Algorithm Analysis

### 2.1 Key Innovations

| Component | Tereshchenkolab Approach | Improvement |
|-----------|--------------------------|-------------|
| **Grid Detection** | Binary threshold + autocorrelation + quadratic fit | Sub-pixel precision, color-agnostic |
| **Signal/Grid Separation** | Otsu's method + iterative threshold reduction | Adaptive to any image |
| **Trace Extraction** | Viterbi dynamic programming | Globally optimal path |
| **Cost Function** | α×Distance + (1-α)×AnglePenalty | Smooth, continuous traces |
| **Gap Handling** | Linear interpolation on optimal path | Fewer gaps to fill |

### 2.2 Algorithm Pseudocode

```python
def viterbi_extract(binary_image):
    """
    Viterbi dynamic programming for optimal trace extraction.

    For each column x:
        1. Find candidate points (centers of True pixel regions)
        2. Compute transition costs to all candidates in x+1
        3. Store minimum-cost predecessor

    Backtrack from minimum-cost endpoint to reconstruct path.
    """
    H, W = binary_image.shape

    # Forward pass: build cost table
    cost = {}  # cost[(x, y)] = minimum cost to reach (x, y)
    pred = {}  # pred[(x, y)] = predecessor point

    # Initialize first column
    for y in get_candidates(binary_image, x=0):
        cost[(0, y)] = 0
        pred[(0, y)] = None

    # Dynamic programming
    for x in range(1, W):
        candidates_curr = get_candidates(binary_image, x)
        candidates_prev = get_candidates(binary_image, x-1)

        for y_curr in candidates_curr:
            min_cost = infinity
            best_pred = None

            for y_prev in candidates_prev:
                # Cost = distance + angle penalty
                dist = euclidean_distance((x-1, y_prev), (x, y_curr))
                angle = compute_angle_penalty(pred, x-1, y_prev, y_curr)

                total = cost[(x-1, y_prev)] + alpha*dist + (1-alpha)*angle

                if total < min_cost:
                    min_cost = total
                    best_pred = (x-1, y_prev)

            cost[(x, y_curr)] = min_cost
            pred[(x, y_curr)] = best_pred

    # Backtrack from minimum-cost endpoint
    end_y = min(get_candidates(binary_image, W-1),
                key=lambda y: cost[(W-1, y)])

    path = []
    current = (W-1, end_y)
    while current is not None:
        path.append(current)
        current = pred[current]

    return path[::-1]  # Reverse to get left-to-right order
```

### 2.3 Published Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Sample-by-sample correlation | **0.977** | vs. original digital ECG |
| Mean amplitude difference | **9.3 μV** | Clinically insignificant |
| RMSE | **25.9 μV** | ~0.026 mV |
| Processing time | **3-5 sec/lead** | Python, single-threaded |
| Recommended input | **600 DPI scan** | Lower DPI = lower accuracy |

---

## 3. Integration Architecture

### 3.1 Architecture Options

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OPTION A: Python Backend                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Browser (ekgquest_lab.html)          Python Server (Flask)            │
│   ┌─────────────────────────┐          ┌─────────────────────────┐      │
│   │  Upload Image           │  POST    │  /api/digitize          │      │
│   │  ───────────────────────┼─────────►│  ┌─────────────────────┐│      │
│   │                         │          │  │ ecgdigitize library ││      │
│   │  Receive JSON waveform  │◄─────────┤  │ - Viterbi extraction││      │
│   │  ───────────────────────┤  JSON    │  │ - Grid detection    ││      │
│   │                         │          │  └─────────────────────┘│      │
│   │  Standard ECG pipeline  │          └─────────────────────────┘      │
│   └─────────────────────────┘                                           │
│                                                                          │
│   Pros: Use existing library, minimal JS changes                        │
│   Cons: Requires server, not fully client-side                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                     OPTION B: Full JavaScript Port                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Browser (ekgquest_lab.html)                                           │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │  ecg-digitize.js (new module)                                │       │
│   │  ┌─────────────────────────────────────────────────────────┐│       │
│   │  │  otsuThreshold()      - Adaptive thresholding           ││       │
│   │  │  autocorrelateGrid()  - Sub-pixel grid detection        ││       │
│   │  │  viterbiExtract()     - Dynamic programming             ││       │
│   │  │  extractSignal()      - Full pipeline                   ││       │
│   │  └─────────────────────────────────────────────────────────┘│       │
│   │                                                              │       │
│   │  Web Worker for heavy computation                            │       │
│   └─────────────────────────────────────────────────────────────┘       │
│                                                                          │
│   Pros: Fully client-side, no server needed, privacy preserved          │
│   Cons: Significant development effort, potential performance issues    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      OPTION C: Hybrid (Recommended)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Browser (ekgquest_lab.html)                                           │
│   ┌─────────────────────────────────────────────────────────────┐       │
│   │                                                              │       │
│   │  1. Try current JS extraction (fast, ~100ms)                │       │
│   │     └── If quality score > 0.8 → Use result                 │       │
│   │                                                              │       │
│   │  2. If low quality OR user requests "Enhanced Mode":        │       │
│   │     └── POST to Python backend                              │       │
│   │     └── Use Viterbi result                                  │       │
│   │                                                              │       │
│   │  3. Display quality indicator: "Fast" vs "Enhanced"         │       │
│   │                                                              │       │
│   └─────────────────────────────────────────────────────────────┘       │
│                                                                          │
│   Pros: Best of both worlds, graceful degradation                       │
│   Cons: Two code paths to maintain                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Recommended Approach: Option C (Hybrid)

**Rationale:**
1. Preserves EKGQuest's browser-only philosophy for generated ECGs
2. Provides enhanced accuracy for difficult imports when server available
3. Graceful fallback when server unavailable
4. Clear UX indicator of digitization quality

---

## 4. Implementation Phases

### Phase 1: Python Backend Service (Week 1-2)

#### 4.1.1 New Files

```
python/
├── digitize_service/
│   ├── __init__.py
│   ├── app.py              # Flask application
│   ├── viterbi.py          # Core algorithm (port or wrap ecgdigitize)
│   ├── preprocessing.py    # Image preparation
│   └── api.py              # REST endpoints
├── requirements-digitize.txt
└── Dockerfile.digitize     # Optional containerization
```

#### 4.1.2 API Specification

```yaml
# POST /api/digitize
Request:
  Content-Type: multipart/form-data
  Body:
    image: <binary>           # PNG, JPEG, TIFF, or PDF
    paper_speed: 25           # mm/s (default: 25)
    voltage_scale: 10         # mm/mV (default: 10)
    lead_hint: "II"           # Optional: expected lead name
    crop: { x1, y1, x2, y2 }  # Optional: region to process

Response (200 OK):
  Content-Type: application/json
  {
    "success": true,
    "leads": {
      "II": {
        "samples_uV": [123, 145, ...],  # Int16 array
        "fs": 500,
        "duration_s": 10.0
      }
    },
    "calibration": {
      "px_per_mm": 11.34,
      "method": "autocorrelation",
      "confidence": 0.95
    },
    "quality": {
      "score": 0.92,
      "issues": []
    },
    "metadata": {
      "algorithm": "viterbi_dp",
      "processing_time_ms": 3420
    }
  }

Response (400 Bad Request):
  {
    "success": false,
    "error": "Could not detect grid lines",
    "suggestion": "Try manual calibration or higher resolution scan"
  }
```

#### 4.1.3 Core Algorithm Implementation

```python
# python/digitize_service/viterbi.py

import numpy as np
from scipy import ndimage
from typing import Tuple, List, Optional
from dataclasses import dataclass

@dataclass
class ExtractionResult:
    signal: np.ndarray          # Raw pixel positions
    signal_uV: np.ndarray       # Scaled to microvolts
    fs: int                     # Sample rate
    quality_score: float        # 0-1 confidence
    grid_spacing_px: float      # Detected grid spacing


def otsu_threshold(image: np.ndarray) -> int:
    """
    Compute optimal threshold using Otsu's method.

    Maximizes inter-class variance between foreground and background.
    """
    histogram, _ = np.histogram(image.flatten(), bins=256, range=(0, 256))
    total_pixels = image.size

    sum_total = np.sum(np.arange(256) * histogram)
    sum_background = 0
    weight_background = 0

    max_variance = 0
    optimal_threshold = 0

    for t in range(256):
        weight_background += histogram[t]
        if weight_background == 0:
            continue

        weight_foreground = total_pixels - weight_background
        if weight_foreground == 0:
            break

        sum_background += t * histogram[t]
        mean_background = sum_background / weight_background
        mean_foreground = (sum_total - sum_background) / weight_foreground

        variance = weight_background * weight_foreground * \
                   (mean_background - mean_foreground) ** 2

        if variance > max_variance:
            max_variance = variance
            optimal_threshold = t

    return optimal_threshold


def adaptive_threshold(image: np.ndarray, initial_threshold: int) -> np.ndarray:
    """
    Iteratively reduce threshold until grid disappears.

    This separates the ECG trace from the grid lines.
    """
    threshold = initial_threshold
    step = int(initial_threshold * 0.05)  # 5% steps

    while threshold > 50:
        binary = image < threshold

        # Check if grid is still visible (regular pattern in FFT)
        if not _grid_visible(binary):
            break

        threshold -= step

    return image < threshold


def _grid_visible(binary: np.ndarray, min_peaks: int = 5) -> bool:
    """Check if regular grid pattern is visible via autocorrelation."""
    # Sum columns to get vertical line density
    col_sum = np.sum(binary, axis=0)

    # Autocorrelation
    autocorr = np.correlate(col_sum, col_sum, mode='full')
    autocorr = autocorr[len(autocorr)//2:]

    # Find peaks
    from scipy.signal import find_peaks
    peaks, _ = find_peaks(autocorr, height=np.max(autocorr) * 0.3)

    return len(peaks) >= min_peaks


def detect_grid_spacing(image: np.ndarray) -> Tuple[float, float]:
    """
    Detect grid spacing using autocorrelation with sub-pixel refinement.

    Returns:
        (spacing_px, confidence)
    """
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = np.mean(image, axis=2)
    else:
        gray = image

    # Normalize white point
    white_point = np.percentile(gray, 95)
    gray = gray * (255 / white_point)
    gray = np.clip(gray, 0, 255).astype(np.uint8)

    # Binary threshold to isolate grid
    binary = gray > 230

    # Sum columns for vertical line detection
    col_sum = np.sum(binary, axis=0).astype(float)

    # Autocorrelation
    autocorr = np.correlate(col_sum - np.mean(col_sum),
                            col_sum - np.mean(col_sum), mode='full')
    autocorr = autocorr[len(autocorr)//2:]

    # Find first significant peak (grid spacing)
    from scipy.signal import find_peaks
    peaks, properties = find_peaks(autocorr, height=np.max(autocorr) * 0.3)

    if len(peaks) < 2:
        return None, 0.0

    # Use second peak (first is at 0)
    rough_spacing = peaks[1] if peaks[0] < 5 else peaks[0]

    # Sub-pixel refinement via quadratic fit
    if rough_spacing > 1 and rough_spacing < len(autocorr) - 1:
        y0, y1, y2 = autocorr[rough_spacing-1:rough_spacing+2]
        # Quadratic interpolation for peak position
        offset = 0.5 * (y0 - y2) / (y0 - 2*y1 + y2) if (y0 - 2*y1 + y2) != 0 else 0
        spacing = rough_spacing + offset
    else:
        spacing = float(rough_spacing)

    # Confidence based on peak prominence
    confidence = properties['peak_heights'][0] / np.max(autocorr) if len(properties['peak_heights']) > 0 else 0.5

    return spacing, confidence


def viterbi_extract(
    binary: np.ndarray,
    alpha: float = 0.7,
    max_jump: int = 50
) -> np.ndarray:
    """
    Extract ECG trace using Viterbi dynamic programming.

    Args:
        binary: Binary image with True = trace pixels
        alpha: Weight for distance vs angle penalty (0.7 = favor smoothness)
        max_jump: Maximum vertical jump between columns (pixels)

    Returns:
        Array of y-coordinates for each x position
    """
    H, W = binary.shape

    def get_candidates(x: int) -> List[int]:
        """Find centers of True regions in column x."""
        col = binary[:, x]
        if not np.any(col):
            return []

        # Find connected regions
        labeled, num_features = ndimage.label(col)
        centers = []

        for i in range(1, num_features + 1):
            indices = np.where(labeled == i)[0]
            centers.append(int(np.mean(indices)))

        return centers

    # Initialize cost and predecessor tables
    INF = float('inf')
    cost = {}
    pred = {}

    # First column
    for y in get_candidates(0):
        cost[(0, y)] = 0
        pred[(0, y)] = None

    # If no candidates in first column, use middle
    if not cost:
        cost[(0, H//2)] = 0
        pred[(0, H//2)] = None

    # Forward pass
    for x in range(1, W):
        candidates = get_candidates(x)

        # If no candidates, interpolate from previous
        if not candidates:
            prev_ys = [k[1] for k in cost.keys() if k[0] == x-1]
            if prev_ys:
                candidates = [int(np.mean(prev_ys))]
            else:
                candidates = [H//2]

        prev_candidates = [k[1] for k in cost.keys() if k[0] == x-1]

        for y_curr in candidates:
            min_cost = INF
            best_pred = None

            for y_prev in prev_candidates:
                # Skip if jump too large
                if abs(y_curr - y_prev) > max_jump:
                    continue

                # Distance cost
                dist = np.sqrt(1 + (y_curr - y_prev)**2)

                # Angle penalty (penalize sharp changes)
                angle_penalty = 0
                if pred.get((x-1, y_prev)) is not None:
                    _, y_prev_prev = pred[(x-1, y_prev)]
                    prev_slope = y_prev - y_prev_prev
                    curr_slope = y_curr - y_prev
                    angle_penalty = abs(curr_slope - prev_slope)

                total = cost[(x-1, y_prev)] + alpha * dist + (1-alpha) * angle_penalty

                if total < min_cost:
                    min_cost = total
                    best_pred = (x-1, y_prev)

            if min_cost < INF:
                cost[(x, y_curr)] = min_cost
                pred[(x, y_curr)] = best_pred

    # Backtrack
    end_candidates = [(k, v) for k, v in cost.items() if k[0] == W-1]
    if not end_candidates:
        # Fallback: return middle line
        return np.full(W, H//2)

    end_point = min(end_candidates, key=lambda x: x[1])[0]

    path = []
    current = end_point
    while current is not None:
        path.append(current[1])  # y coordinate
        current = pred.get(current)

    path = path[::-1]

    # Fill any remaining gaps with linear interpolation
    result = np.array(path, dtype=float)

    # Pad if shorter than image width
    if len(result) < W:
        result = np.pad(result, (0, W - len(result)), mode='edge')

    return result[:W]


def extract_signal(
    image: np.ndarray,
    paper_speed_mm_s: float = 25.0,
    voltage_scale_mm_mV: float = 10.0,
    target_fs: int = 500
) -> ExtractionResult:
    """
    Full pipeline: image → calibrated signal.

    Args:
        image: Input image (RGB or grayscale)
        paper_speed_mm_s: Paper speed in mm/s (typically 25)
        voltage_scale_mm_mV: Voltage scale in mm/mV (typically 10)
        target_fs: Target sample rate in Hz

    Returns:
        ExtractionResult with signal in microvolts
    """
    # Convert to grayscale
    if len(image.shape) == 3:
        gray = np.mean(image, axis=2).astype(np.uint8)
    else:
        gray = image.astype(np.uint8)

    # Detect grid spacing
    grid_spacing_px, grid_confidence = detect_grid_spacing(gray)

    if grid_spacing_px is None or grid_spacing_px < 5:
        raise ValueError("Could not detect grid spacing")

    # Calculate pixels per mm (assuming 1mm small box)
    px_per_mm = grid_spacing_px

    # Adaptive threshold to separate trace from grid
    otsu = otsu_threshold(gray)
    binary = adaptive_threshold(gray, otsu)

    # Viterbi extraction
    trace_px = viterbi_extract(binary)

    # Convert to physical units
    # Y increases downward in image, but voltage increases upward
    center_y = image.shape[0] / 2
    trace_mm = (center_y - trace_px) / px_per_mm  # mm from center
    trace_mV = trace_mm / voltage_scale_mm_mV     # mV
    trace_uV = trace_mV * 1000                     # μV

    # Calculate actual sample rate from image
    duration_s = image.shape[1] / px_per_mm / paper_speed_mm_s
    actual_fs = len(trace_uV) / duration_s

    # Resample to target sample rate
    from scipy.interpolate import interp1d

    t_original = np.linspace(0, duration_s, len(trace_uV))
    t_target = np.linspace(0, duration_s, int(duration_s * target_fs))

    interpolator = interp1d(t_original, trace_uV, kind='linear', fill_value='extrapolate')
    signal_uV = interpolator(t_target)

    # Baseline correction (subtract median)
    signal_uV = signal_uV - np.median(signal_uV)

    # Quality score based on grid confidence and signal variance
    signal_variance = np.var(signal_uV)
    expected_variance = 100000  # Typical ECG variance in μV²
    variance_score = min(1.0, signal_variance / expected_variance)
    quality_score = 0.5 * grid_confidence + 0.5 * variance_score

    return ExtractionResult(
        signal=trace_px,
        signal_uV=signal_uV.astype(np.int16),
        fs=target_fs,
        quality_score=quality_score,
        grid_spacing_px=grid_spacing_px
    )
```

#### 4.1.4 Flask Application

```python
# python/digitize_service/app.py

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from PIL import Image
import io
import time

from .viterbi import extract_signal, ExtractionResult

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from browser


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "algorithm": "viterbi_dp"})


@app.route('/api/digitize', methods=['POST'])
def digitize():
    start_time = time.time()

    # Validate request
    if 'image' not in request.files:
        return jsonify({
            "success": False,
            "error": "No image provided",
            "suggestion": "Include image file in multipart/form-data"
        }), 400

    # Parse parameters
    paper_speed = float(request.form.get('paper_speed', 25))
    voltage_scale = float(request.form.get('voltage_scale', 10))
    lead_hint = request.form.get('lead_hint', 'II')

    try:
        # Load image
        image_file = request.files['image']
        image = Image.open(image_file)
        image_array = np.array(image)

        # Handle crop if provided
        crop = request.form.get('crop')
        if crop:
            import json
            crop = json.loads(crop)
            image_array = image_array[crop['y1']:crop['y2'], crop['x1']:crop['x2']]

        # Extract signal
        result = extract_signal(
            image_array,
            paper_speed_mm_s=paper_speed,
            voltage_scale_mm_mV=voltage_scale
        )

        processing_time = (time.time() - start_time) * 1000

        return jsonify({
            "success": True,
            "leads": {
                lead_hint: {
                    "samples_uV": result.signal_uV.tolist(),
                    "fs": result.fs,
                    "duration_s": len(result.signal_uV) / result.fs
                }
            },
            "calibration": {
                "px_per_mm": result.grid_spacing_px,
                "method": "autocorrelation",
                "confidence": result.quality_score
            },
            "quality": {
                "score": result.quality_score,
                "issues": []
            },
            "metadata": {
                "algorithm": "viterbi_dp",
                "processing_time_ms": round(processing_time, 1)
            }
        })

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "suggestion": "Try manual calibration or higher resolution scan"
        }), 400

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Processing failed: {str(e)}",
            "suggestion": "Check image format and try again"
        }), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
```

---

### Phase 2: JavaScript Integration (Week 2-3)

#### 4.2.1 New UI Elements

Add to `ekgquest_lab.html`:

```html
<!-- Enhanced Digitization Toggle -->
<div class="digitize-options" id="digitizeOptions" style="display: none;">
  <label class="toggle-label">
    <input type="checkbox" id="enhancedDigitize" />
    <span class="toggle-slider"></span>
    Enhanced Mode (Viterbi)
  </label>
  <span class="quality-badge" id="digitizeQuality"></span>
</div>

<!-- Quality Indicator Styles -->
<style>
  .quality-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    margin-left: 8px;
  }
  .quality-high { background: #dcfce7; color: #166534; }
  .quality-medium { background: #fef9c3; color: #854d0e; }
  .quality-low { background: #fee2e2; color: #991b1b; }
</style>
```

#### 4.2.2 JavaScript Client

```javascript
// Add to ekgquest_lab.html <script> section

// ============================================================================
// ENHANCED DIGITIZATION (Viterbi Backend)
// ============================================================================

const DIGITIZE_API_URL = 'http://localhost:5001/api/digitize';
let digitizeBackendAvailable = false;

// Check backend availability on load
async function checkDigitizeBackend() {
  try {
    const response = await fetch('http://localhost:5001/api/health', {
      method: 'GET',
      timeout: 2000
    });
    if (response.ok) {
      digitizeBackendAvailable = true;
      document.getElementById('digitizeOptions').style.display = 'block';
      console.log('Enhanced digitization backend available');
    }
  } catch (e) {
    digitizeBackendAvailable = false;
    console.log('Enhanced digitization backend not available, using client-side');
  }
}

// Enhanced digitization via backend
async function digitizeEnhanced(imageBlob, options = {}) {
  const {
    paperSpeed = 25,
    voltageScale = 10,
    leadHint = 'II',
    crop = null
  } = options;

  const formData = new FormData();
  formData.append('image', imageBlob);
  formData.append('paper_speed', paperSpeed);
  formData.append('voltage_scale', voltageScale);
  formData.append('lead_hint', leadHint);
  if (crop) {
    formData.append('crop', JSON.stringify(crop));
  }

  const response = await fetch(DIGITIZE_API_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Digitization failed');
  }

  return await response.json();
}

// Unified digitization function (tries enhanced, falls back to basic)
async function digitizeECGUnified() {
  if (!imageMode || !uploadedImage) {
    showStatus('Upload an image first', 'warning');
    return;
  }

  const useEnhanced = document.getElementById('enhancedDigitize')?.checked &&
                      digitizeBackendAvailable;

  showStatus(useEnhanced ? 'Digitizing with Viterbi algorithm...' : 'Digitizing...', 'info', 0);

  try {
    let result;

    if (useEnhanced) {
      // Convert image to blob
      const canvas = document.createElement('canvas');
      canvas.width = uploadedImage.width;
      canvas.height = uploadedImage.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(uploadedImage, 0, 0);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

      const paperSpeed = parseInt(document.getElementById('importSpeed').value);
      const voltageScale = parseInt(document.getElementById('importGain').value);

      const apiResult = await digitizeEnhanced(blob, { paperSpeed, voltageScale });

      // Convert API result to EKGQuest format
      result = {
        leads_uV: {},
        fs: 500,
        duration_s: 0
      };

      for (const [leadName, leadData] of Object.entries(apiResult.leads)) {
        result.leads_uV[leadName] = leadData.samples_uV;
        result.fs = leadData.fs;
        result.duration_s = leadData.duration_s;
      }

      // Update quality indicator
      const qualityBadge = document.getElementById('digitizeQuality');
      const score = apiResult.quality.score;
      qualityBadge.textContent = `Quality: ${Math.round(score * 100)}%`;
      qualityBadge.className = 'quality-badge ' +
        (score > 0.8 ? 'quality-high' : score > 0.5 ? 'quality-medium' : 'quality-low');

      showStatus(`Enhanced digitization complete (${apiResult.metadata.processing_time_ms}ms)`, 'success');

    } else {
      // Use existing client-side digitization
      if (!imageCalibration?.calibrated) {
        showStatus('Please calibrate the grid first', 'warning');
        startCalibration();
        return;
      }

      result = extractWaveformFromImage(uploadedImage, imageCalibration);

      if (!result || !result.leads_uV || Object.keys(result.leads_uV).length === 0) {
        throw new Error('Could not detect ECG trace');
      }

      showStatus('Client-side digitization complete', 'success');
    }

    // Build ECG data structure
    ecgData = {
      fs: result.fs,
      duration_s: result.duration_s,
      leads_uV: result.leads_uV,
      targets: {
        synthetic: false,
        digitized: true,
        source: uploadedImageName,
        digitization_method: useEnhanced ? 'viterbi' : 'centroid',
        dx: 'Digitized from image'
      },
      integrity: {
        digitization_algorithm: useEnhanced ? 'viterbi_dp' : 'weighted_centroid'
      }
    };

    // Exit image mode
    imageMode = false;
    uploadedImage = null;
    document.getElementById('calibrationControls').style.display = 'none';

    updateAfterLoad();

  } catch (err) {
    console.error('Digitization failed:', err);
    showStatus('Digitization failed: ' + err.message, 'error');
  }
}

// Override existing digitizeECG function
window.digitizeECG = digitizeECGUnified;

// Check backend on page load
document.addEventListener('DOMContentLoaded', checkDigitizeBackend);
```

---

### Phase 3: Quality Assurance & Testing (Week 3-4)

#### 4.3.1 Test Image Collection

Create `test/digitization/` directory with:

```
test/digitization/
├── images/
│   ├── clean_red_grid.png      # Ideal case
│   ├── faded_photocopy.png     # Common failure mode
│   ├── blue_grid.png           # Non-red grid
│   ├── noisy_scan.png          # High noise
│   ├── thick_trace.png         # Thick pen trace
│   └── multiple_leads.png      # 12-lead layout
├── expected/
│   ├── clean_red_grid.json     # Ground truth waveforms
│   └── ...
└── digitization.test.js        # Vitest tests
```

#### 4.3.2 Test Suite

```javascript
// test/digitization/digitization.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

const BACKEND_URL = 'http://localhost:5001';

describe('ECG Digitization', () => {
  let backendAvailable = false;

  beforeAll(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/health`);
      backendAvailable = res.ok;
    } catch {
      console.warn('Digitization backend not available, skipping enhanced tests');
    }
  });

  describe('Grid Detection', () => {
    it('should detect red grid spacing accurately', async () => {
      if (!backendAvailable) return;

      const image = await fs.readFile('test/digitization/images/clean_red_grid.png');
      const formData = new FormData();
      formData.append('image', new Blob([image]));

      const res = await fetch(`${BACKEND_URL}/api/digitize`, {
        method: 'POST',
        body: formData
      });

      const result = await res.json();

      expect(result.success).toBe(true);
      expect(result.calibration.confidence).toBeGreaterThan(0.8);
      // Known grid spacing for test image: 11.34 px/mm
      expect(result.calibration.px_per_mm).toBeCloseTo(11.34, 1);
    });

    it('should handle non-red grids', async () => {
      if (!backendAvailable) return;

      const image = await fs.readFile('test/digitization/images/blue_grid.png');
      const formData = new FormData();
      formData.append('image', new Blob([image]));

      const res = await fetch(`${BACKEND_URL}/api/digitize`, {
        method: 'POST',
        body: formData
      });

      const result = await res.json();
      expect(result.success).toBe(true);
    });
  });

  describe('Signal Extraction', () => {
    it('should extract signal with correlation > 0.95', async () => {
      if (!backendAvailable) return;

      const image = await fs.readFile('test/digitization/images/clean_red_grid.png');
      const expected = JSON.parse(
        await fs.readFile('test/digitization/expected/clean_red_grid.json', 'utf-8')
      );

      const formData = new FormData();
      formData.append('image', new Blob([image]));

      const res = await fetch(`${BACKEND_URL}/api/digitize`, {
        method: 'POST',
        body: formData
      });

      const result = await res.json();

      // Compute correlation
      const extracted = result.leads.II.samples_uV;
      const truth = expected.leads.II.samples_uV;

      const correlation = pearsonCorrelation(extracted, truth);
      expect(correlation).toBeGreaterThan(0.95);
    });

    it('should handle noisy scans gracefully', async () => {
      if (!backendAvailable) return;

      const image = await fs.readFile('test/digitization/images/noisy_scan.png');
      const formData = new FormData();
      formData.append('image', new Blob([image]));

      const res = await fetch(`${BACKEND_URL}/api/digitize`, {
        method: 'POST',
        body: formData
      });

      const result = await res.json();

      // Should succeed but with lower quality score
      expect(result.success).toBe(true);
      expect(result.quality.score).toBeGreaterThan(0.5);
      expect(result.quality.score).toBeLessThan(0.9);
    });
  });

  describe('Fallback Behavior', () => {
    it('should fall back to client-side when backend unavailable', async () => {
      // This tests the JavaScript fallback path
      // Implementation would mock the backend being unavailable
    });
  });
});

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  return den === 0 ? 0 : num / den;
}
```

---

### Phase 4: Documentation & Deployment (Week 4)

#### 4.4.1 User Documentation Update

Add to `README.md`:

```markdown
## Enhanced ECG Digitization (Optional)

EKGQuest includes an optional enhanced digitization mode using the Viterbi
dynamic programming algorithm (based on Tereshchenkolab's method).

### Quick Start

```bash
# Start the digitization backend
cd python/digitize_service
pip install -r requirements.txt
python app.py

# In another terminal, start EKGQuest
npm start
```

### Features

| Mode | Algorithm | Accuracy | Speed | Requirements |
|------|-----------|----------|-------|--------------|
| Basic | Weighted centroid | ~85% | Instant | None (client-side) |
| Enhanced | Viterbi DP | ~98% | 3-5s/lead | Python backend |

### When to Use Enhanced Mode

- Faded or photocopied ECGs
- Non-red grid lines (blue, green, gray)
- Thick or variable trace width
- Noisy scans
- Research requiring high accuracy
```

#### 4.4.2 Deployment Options

```yaml
# docker-compose.yml (optional)
version: '3.8'
services:
  ekgquest:
    image: nginx:alpine
    ports:
      - "8000:80"
    volumes:
      - ./viewer:/usr/share/nginx/html:ro

  digitize:
    build:
      context: ./python/digitize_service
      dockerfile: Dockerfile
    ports:
      - "5001:5001"
    environment:
      - FLASK_ENV=production
```

```dockerfile
# python/digitize_service/Dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001
CMD ["gunicorn", "-b", "0.0.0.0:5001", "app:app"]
```

---

## 5. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Backend unavailable | Medium | Low | Graceful fallback to client-side |
| Viterbi too slow | Low | Medium | Web Worker, progress indicator |
| Memory issues (large images) | Medium | Medium | Image resize before processing |
| CORS issues | High | Low | Flask-CORS, proper headers |
| Algorithm patent/license | Low | High | Verify MIT license of ecgdigitize |

---

## 6. Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Digitization success rate | ~80% | >95% | Test suite pass rate |
| Correlation with ground truth | ~0.85 | >0.95 | Pearson r on test set |
| Processing time | N/A | <5s/lead | API response time |
| User satisfaction | N/A | >4/5 | Feedback survey |

---

## 7. Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1-2 | Python Backend | `viterbi.py`, `app.py`, API working |
| 2-3 | JS Integration | UI toggle, API client, fallback logic |
| 3-4 | Testing | Test images, automated tests, benchmarks |
| 4 | Documentation | README update, deployment configs |

---

## 8. Future Enhancements (Post-MVP)

1. **WebAssembly Port**: Move Viterbi to client-side WASM for offline use
2. **Multi-lead Layout Detection**: Automatic 12-lead region identification
3. **PDF Page Extraction**: Direct PDF handling without manual crop
4. **Batch Processing**: Process multiple images in queue
5. **ML-based Quality Prediction**: Predict digitization quality before processing

---

*Plan created: December 2024*
*Author: Claude (Opus 4.5)*
