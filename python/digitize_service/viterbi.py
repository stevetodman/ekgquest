"""
Viterbi Dynamic Programming ECG Trace Extraction

Based on Tereshchenkolab's approach for globally-optimal trace extraction.
Key improvements:
- Color-based trace detection (black traces on pink/red grid)
- Horizontal continuity filtering
- Multi-lead image handling via band detection
"""

import numpy as np
from scipy import ndimage
from scipy.signal import find_peaks, medfilt
from scipy.interpolate import interp1d
from dataclasses import dataclass
from typing import Tuple, List, Optional
import warnings


@dataclass
class ExtractionResult:
    """Result of ECG trace extraction."""
    signal: np.ndarray          # Raw pixel y-positions
    signal_uV: np.ndarray       # Scaled to microvolts
    fs: int                     # Sample rate
    duration_s: float           # Duration in seconds
    quality_score: float        # 0-1 confidence
    grid_spacing_px: float      # Detected grid spacing
    method: str                 # Extraction method used


def detect_trace_pixels_color(image: np.ndarray) -> np.ndarray:
    """
    Detect ECG trace pixels using color information.

    ECG traces can be:
    - BLACK lines on a PINK/RED grid (most common)
    - BLUE lines on a PINK/RED grid (also common)
    - GREEN lines (less common)

    Args:
        image: RGB image array (H, W, 3)

    Returns:
        Binary mask where True = trace pixel
    """
    if len(image.shape) != 3:
        # Grayscale - fall back to intensity
        return image < np.percentile(image, 5)

    R = image[:, :, 0].astype(np.float32)
    G = image[:, :, 1].astype(np.float32)
    B = image[:, :, 2].astype(np.float32)

    # Calculate metrics
    brightness = (R + G + B) / 3

    # === Method 1: Black/dark traces ===
    # Very dark pixels (trace is black)
    is_dark = brightness < 80

    # Non-red dark pixels (exclude dark red grid lines)
    color_balance = np.abs(R - G) + np.abs(G - B) + np.abs(R - B)
    is_neutral = color_balance < 60  # Neutral colors (black, gray, white)
    is_not_pink = ~((R > G + 20) & (R > B + 20))
    black_trace = is_dark & (is_neutral | is_not_pink)

    # === Method 2: Blue traces ===
    # Blue traces have high B, low R and G (e.g., R=60, G=60, B=250)
    is_blue = (B > R * 1.5) & (B > G * 1.2) & (B > 150)

    # Also catch darker blues
    is_dark_blue = (B > R) & (B > G) & (R < 120) & (G < 120) & (B > 100)

    blue_trace = is_blue | is_dark_blue

    # === Method 3: Green traces (less common) ===
    is_green = (G > R * 1.3) & (G > B * 1.3) & (G > 100)
    green_trace = is_green

    # Combine all trace types
    trace_mask = black_trace | blue_trace | green_trace

    # Clean up: remove isolated pixels (noise)
    from scipy.ndimage import binary_opening
    struct = np.ones((2, 2))
    trace_mask = binary_opening(trace_mask, structure=struct)

    return trace_mask


def detect_grid_spacing_robust(image: np.ndarray) -> Tuple[Optional[float], float]:
    """
    Detect grid spacing using multiple methods.

    Returns:
        (spacing_px, confidence)
    """
    if len(image.shape) == 3:
        # For color images, look at the RED channel (grid is pink/red)
        R = image[:, :, 0]
        G = image[:, :, 1]

        # Grid lines show up as peaks in red relative to green
        grid_signal = R.astype(np.float32) - G.astype(np.float32) * 0.5
    else:
        grid_signal = image.astype(np.float32)

    H, W = grid_signal.shape[:2]

    # Method 1: Autocorrelation on column sums
    col_profile = np.mean(grid_signal, axis=0)
    col_profile = col_profile - np.mean(col_profile)

    if np.std(col_profile) < 1:
        return None, 0.0

    # Autocorrelation
    autocorr = np.correlate(col_profile, col_profile, mode='full')
    autocorr = autocorr[len(autocorr)//2:]
    autocorr = autocorr / (autocorr[0] + 1e-10)

    # Find peaks
    min_spacing = 5  # Minimum grid spacing
    max_spacing = min(100, W // 10)

    peaks, props = find_peaks(autocorr[min_spacing:max_spacing],
                              height=0.1, distance=3)

    if len(peaks) == 0:
        # Try row profile instead
        row_profile = np.mean(grid_signal, axis=1)
        row_profile = row_profile - np.mean(row_profile)

        if np.std(row_profile) < 1:
            return None, 0.0

        autocorr = np.correlate(row_profile, row_profile, mode='full')
        autocorr = autocorr[len(autocorr)//2:]
        autocorr = autocorr / (autocorr[0] + 1e-10)

        peaks, props = find_peaks(autocorr[min_spacing:max_spacing],
                                  height=0.1, distance=3)

    if len(peaks) == 0:
        return None, 0.0

    # First peak is small grid spacing (1mm)
    spacing = peaks[0] + min_spacing
    confidence = min(1.0, props['peak_heights'][0] * 1.5)

    # Sub-pixel refinement
    if spacing > 1 and spacing < len(autocorr) - 1:
        y0, y1, y2 = autocorr[spacing-1], autocorr[spacing], autocorr[spacing+1]
        denom = y0 - 2*y1 + y2
        if abs(denom) > 1e-6:
            spacing = spacing + 0.5 * (y0 - y2) / denom

    return spacing, confidence


def find_rhythm_strip(trace_mask: np.ndarray) -> Tuple[int, int]:
    """
    Find the rhythm strip region (usually bottom of image, full width).

    Args:
        trace_mask: Binary mask of trace pixels

    Returns:
        (y_start, y_end) of the best horizontal band for extraction
    """
    H, W = trace_mask.shape

    # Divide into horizontal bands
    num_bands = 5
    band_height = H // num_bands

    band_scores = []
    for i in range(num_bands):
        y_start = i * band_height
        y_end = min((i + 1) * band_height, H)

        band = trace_mask[y_start:y_end, :]

        # Score based on:
        # 1. Horizontal coverage (how many columns have trace pixels)
        cols_with_trace = np.sum(np.any(band, axis=0))
        coverage = cols_with_trace / W

        # 2. Total trace pixels (density)
        density = np.sum(band) / band.size

        # 3. Continuity (fewer gaps is better)
        col_has_trace = np.any(band, axis=0).astype(int)
        gaps = np.sum(np.abs(np.diff(col_has_trace)))
        continuity = 1.0 / (1 + gaps / 100)

        # Combined score (favor high coverage and continuity)
        score = coverage * 0.5 + continuity * 0.3 + min(density * 10, 0.2)

        band_scores.append((i, score, y_start, y_end))

    # Sort by score
    band_scores.sort(key=lambda x: x[1], reverse=True)

    best = band_scores[0]

    # Expand the region slightly
    margin = band_height // 3
    y_start = max(0, best[2] - margin)
    y_end = min(H, best[3] + margin)

    return y_start, y_end


def extract_trace_centroid(trace_mask: np.ndarray, y_start: int, y_end: int) -> np.ndarray:
    """
    Extract trace using weighted centroid method.

    For each column, find the weighted center of trace pixels.
    More robust than Viterbi for noisy/discontinuous traces.

    Args:
        trace_mask: Binary mask
        y_start, y_end: Region to focus on

    Returns:
        Array of y-coordinates
    """
    H, W = trace_mask.shape
    region = trace_mask[y_start:y_end, :]

    trace_y = np.full(W, np.nan)

    for x in range(W):
        col = region[:, x]
        trace_rows = np.where(col)[0]

        if len(trace_rows) > 0:
            # Weighted centroid
            trace_y[x] = y_start + np.mean(trace_rows)

    # Interpolate gaps
    valid_x = np.where(~np.isnan(trace_y))[0]

    if len(valid_x) < W * 0.2:
        # Not enough valid points
        return np.full(W, (y_start + y_end) / 2)

    if len(valid_x) < W:
        # Interpolate missing values
        interp = interp1d(valid_x, trace_y[valid_x],
                         kind='linear',
                         bounds_error=False,
                         fill_value=(trace_y[valid_x[0]], trace_y[valid_x[-1]]))
        trace_y = interp(np.arange(W))

    # Smooth
    trace_y = medfilt(trace_y, kernel_size=5)

    return trace_y


def extract_trace_viterbi(trace_mask: np.ndarray, y_start: int, y_end: int,
                          max_jump: int = 30) -> np.ndarray:
    """
    Extract trace using Viterbi dynamic programming.

    Args:
        trace_mask: Binary mask
        y_start, y_end: Region to focus on
        max_jump: Max vertical jump between columns

    Returns:
        Array of y-coordinates
    """
    H, W = trace_mask.shape
    region = trace_mask[y_start:y_end, :]
    region_h = y_end - y_start

    INF = float('inf')

    # Build candidates per column
    candidates = []
    for x in range(W):
        col = region[:, x]
        rows = np.where(col)[0]
        if len(rows) > 0:
            # Cluster nearby rows
            clusters = []
            current_cluster = [rows[0]]
            for r in rows[1:]:
                if r - current_cluster[-1] <= 3:
                    current_cluster.append(r)
                else:
                    clusters.append(int(np.mean(current_cluster)))
                    current_cluster = [r]
            clusters.append(int(np.mean(current_cluster)))
            candidates.append(clusters)
        else:
            candidates.append([])

    # Fill empty columns by interpolation
    for x in range(W):
        if len(candidates[x]) == 0:
            # Find nearest non-empty
            left_y = None
            for lx in range(x-1, -1, -1):
                if len(candidates[lx]) > 0:
                    left_y = candidates[lx][0]
                    break
            right_y = None
            for rx in range(x+1, W):
                if len(candidates[rx]) > 0:
                    right_y = candidates[rx][0]
                    break

            if left_y is not None and right_y is not None:
                candidates[x] = [int((left_y + right_y) / 2)]
            elif left_y is not None:
                candidates[x] = [left_y]
            elif right_y is not None:
                candidates[x] = [right_y]
            else:
                candidates[x] = [region_h // 2]

    # DP
    cost = {}
    pred = {}

    for y in candidates[0]:
        cost[(0, y)] = 0
        pred[(0, y)] = None

    for x in range(1, W):
        for y_curr in candidates[x]:
            min_cost = INF
            best_pred = None

            for y_prev in candidates[x-1]:
                jump = abs(y_curr - y_prev)
                if jump > max_jump:
                    continue

                c = cost.get((x-1, y_prev), INF) + jump * 0.5 + 1
                if c < min_cost:
                    min_cost = c
                    best_pred = (x-1, y_prev)

            if min_cost < INF:
                cost[(x, y_curr)] = min_cost
                pred[(x, y_curr)] = best_pred

    # Backtrack
    end_points = [(k, v) for k, v in cost.items() if k[0] == W-1]

    if not end_points:
        # Fall back to centroid
        return extract_trace_centroid(trace_mask, y_start, y_end)

    end = min(end_points, key=lambda x: x[1])[0]

    path = []
    curr = end
    while curr is not None:
        path.append(curr[1] + y_start)  # Convert to full image coords
        curr = pred.get(curr)

    path = path[::-1]
    result = np.array(path, dtype=np.float64)

    if len(result) < W:
        result = np.pad(result, (0, W - len(result)), mode='edge')

    return result[:W]


def extract_signal(
    image: np.ndarray,
    paper_speed_mm_s: float = 25.0,
    voltage_scale_mm_mV: float = 10.0,
    target_fs: int = 500,
    lead_hint: str = "II",
    image_bytes: Optional[bytes] = None
) -> ExtractionResult:
    """
    Full extraction pipeline: image → calibrated ECG signal.

    Args:
        image: Input image (RGB)
        paper_speed_mm_s: Paper speed (default 25 mm/s)
        voltage_scale_mm_mV: Voltage scale (default 10 mm/mV)
        target_fs: Output sample rate
        lead_hint: Expected lead name
        image_bytes: Raw image bytes for Claude vision fallback

    Returns:
        ExtractionResult with signal in microvolts
    """
    H, W = image.shape[:2]
    method = "viterbi_color"

    # Step 1: Detect trace pixels using color
    trace_mask = detect_trace_pixels_color(image)

    trace_pixel_count = np.sum(trace_mask)
    print(f"Detected {trace_pixel_count} trace pixels ({100*trace_pixel_count/(H*W):.1f}% of image)")

    # Step 1b: If detection is poor, try Claude vision fallback
    if trace_pixel_count < 500 and image_bytes is not None:
        print("Low trace detection - trying Claude vision fallback...")
        try:
            from .vision import identify_trace_colors, create_color_mask

            color_info = identify_trace_colors(image_bytes)
            if color_info and color_info.colors:
                print(f"Claude identified colors: {color_info.color_names} (confidence: {color_info.confidence:.2f})")

                # Create mask from identified colors
                vision_mask = create_color_mask(image, color_info.colors, tolerance=60)
                vision_pixel_count = np.sum(vision_mask)

                if vision_pixel_count > trace_pixel_count:
                    print(f"Vision mask has {vision_pixel_count} pixels (vs {trace_pixel_count})")
                    trace_mask = vision_mask
                    trace_pixel_count = vision_pixel_count
                    method = "viterbi_vision"
        except Exception as e:
            print(f"Claude vision fallback failed: {e}")

    if trace_pixel_count < 100:
        warnings.warn("Very few trace pixels detected")

    # Step 2: Detect grid spacing
    grid_spacing_px, grid_confidence = detect_grid_spacing_robust(image)

    if grid_spacing_px is None or grid_spacing_px < 3:
        # Estimate from image size
        # Typical 10-second ECG at 25mm/s = 250mm wide
        # Standard print is ~200-280mm
        grid_spacing_px = W / 250.0  # Rough estimate
        grid_confidence = 0.3
        warnings.warn(f"Grid detection failed, estimating {grid_spacing_px:.1f} px/mm")

    print(f"Grid spacing: {grid_spacing_px:.2f} px/mm (confidence: {grid_confidence:.2f})")

    # Step 3: Find rhythm strip (best region to extract)
    y_start, y_end = find_rhythm_strip(trace_mask)
    print(f"Focusing on region y={y_start} to y={y_end} (of {H})")

    # Step 4: Extract trace
    # Try Viterbi first, fall back to centroid if needed
    try:
        trace_px = extract_trace_viterbi(trace_mask, y_start, y_end)
    except Exception as e:
        warnings.warn(f"Viterbi failed: {e}, using centroid")
        trace_px = extract_trace_centroid(trace_mask, y_start, y_end)

    # Step 5: Convert to physical units
    # Y-axis: pixels to voltage
    # ECG baseline is roughly at center of the extraction region
    baseline_y = (y_start + y_end) / 2

    # Deviation from baseline in pixels
    deviation_px = baseline_y - trace_px  # Positive = upward (higher voltage)

    # Convert pixels to mm
    deviation_mm = deviation_px / grid_spacing_px

    # Convert mm to mV (using voltage scale: typically 10mm/mV)
    deviation_mV = deviation_mm / voltage_scale_mm_mV

    # Convert to µV
    trace_uV = deviation_mV * 1000

    # Step 6: Time axis and resampling
    # X-axis: pixels to time
    duration_s = (W / grid_spacing_px) / paper_speed_mm_s

    print(f"Duration: {duration_s:.2f}s, {len(trace_uV)} samples")

    # Resample to target rate
    t_original = np.linspace(0, duration_s, len(trace_uV))
    t_target = np.linspace(0, duration_s, int(duration_s * target_fs))

    interpolator = interp1d(t_original, trace_uV, kind='linear',
                           fill_value='extrapolate')
    signal_uV = interpolator(t_target)

    # Step 7: Baseline correction
    signal_uV = signal_uV - np.median(signal_uV)

    # Step 8: Amplitude check and normalization
    signal_range = np.max(signal_uV) - np.min(signal_uV)
    print(f"Signal range: {signal_range:.0f} µV")

    if signal_range < 200:
        # Signal too weak - amplify to typical ECG range
        if signal_range > 0:
            scale_factor = 1500 / signal_range
            signal_uV = signal_uV * scale_factor
            print(f"Amplified by {scale_factor:.1f}x")
    elif signal_range > 8000:
        # Signal too strong - attenuate
        scale_factor = 3000 / signal_range
        signal_uV = signal_uV * scale_factor
        print(f"Attenuated by {scale_factor:.2f}x")

    # Step 9: Quality assessment
    final_range = np.max(signal_uV) - np.min(signal_uV)

    # Quality based on:
    # - Grid detection confidence
    # - Trace pixel coverage
    # - Signal range (should be ~1000-3000 µV)

    coverage = np.sum(~np.isnan(trace_px)) / W
    range_quality = min(1.0, final_range / 2000) if final_range > 500 else 0.3

    quality_score = (grid_confidence * 0.3 +
                    coverage * 0.4 +
                    range_quality * 0.3)

    print(f"Quality score: {quality_score:.2f}")

    return ExtractionResult(
        signal=trace_px,
        signal_uV=signal_uV.astype(np.float64),
        fs=target_fs,
        duration_s=duration_s,
        quality_score=quality_score,
        grid_spacing_px=grid_spacing_px,
        method=method
    )


def extract_multi_lead(
    image: np.ndarray,
    num_leads: int = 1,
    paper_speed_mm_s: float = 25.0,
    voltage_scale_mm_mV: float = 10.0,
    target_fs: int = 500
) -> List[ExtractionResult]:
    """
    Extract multiple leads from a multi-strip ECG image.

    Currently extracts single best lead. Future: detect all leads.
    """
    result = extract_signal(
        image,
        paper_speed_mm_s=paper_speed_mm_s,
        voltage_scale_mm_mV=voltage_scale_mm_mV,
        target_fs=target_fs
    )
    return [result]
