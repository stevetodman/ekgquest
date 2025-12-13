#!/usr/bin/env python3
"""
ECG Import Watcher - Frictionless ECG import for EKGQuest

USAGE:
    1. Run this script: python tools/ecg-import-watcher.py
    2. Drag/save ECG images to ~/Desktop/ECG-Import/
    3. Processed files appear in ~/Desktop/ECG-Import/ready/
    4. Drag the .json file into EKGQuest Lab

The script watches the folder and automatically processes new images.
"""

import os
import sys
import json
import time
import hashlib
from pathlib import Path
from datetime import datetime

# Optional: Try to import ECG-Digitiser if available
ECG_DIGITISER_AVAILABLE = False
try:
    # This will work once ECG-Digitiser weights are available
    sys.path.insert(0, '/tmp/ecg-digitiser-test/repo')
    from src.digitise import digitise_ecg
    ECG_DIGITISER_AVAILABLE = True
    print("✓ ECG-Digitiser available - using ML digitization")
except ImportError:
    print("ℹ ECG-Digitiser not available - using basic processing")

# Try OpenCV for basic processing
try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("⚠ OpenCV not installed. Run: pip install opencv-python numpy")

# Configuration
WATCH_DIR = Path.home() / "Desktop" / "ECG-Import"
OUTPUT_DIR = WATCH_DIR / "ready"
PROCESSED_DIR = WATCH_DIR / "processed"
SUPPORTED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'}

def setup_directories():
    """Create watch directories if they don't exist."""
    WATCH_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    PROCESSED_DIR.mkdir(exist_ok=True)
    print(f"📁 Watching: {WATCH_DIR}")
    print(f"📁 Output:   {OUTPUT_DIR}")

def extract_trace_basic(image_path):
    """
    Basic trace extraction using OpenCV.
    Works best with clean ECG images with dark traces on light background.
    """
    if not CV2_AVAILABLE:
        return None

    img = cv2.imread(str(image_path))
    if img is None:
        return None

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Invert if needed (detect if background is dark)
    if np.mean(gray) < 128:
        gray = 255 - gray

    # Threshold to find trace
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Find trace by scanning columns
    height, width = binary.shape
    trace = []

    for x in range(width):
        column = binary[:, x]
        y_positions = np.where(column > 0)[0]
        if len(y_positions) > 0:
            # Use centroid of trace in this column
            y = np.mean(y_positions)
            trace.append((x, y))

    if len(trace) < 100:
        return None

    # Convert to voltage (assume standard ECG: 10mm = 1mV, 25mm/s)
    # Estimate scale from image dimensions
    trace = np.array(trace)
    x_vals = trace[:, 0]
    y_vals = trace[:, 1]

    # Normalize time to ~10 seconds (standard ECG strip)
    duration_s = 10.0
    fs = 500
    num_samples = int(duration_s * fs)

    # Resample to uniform rate
    x_norm = (x_vals - x_vals.min()) / (x_vals.max() - x_vals.min()) * (num_samples - 1)

    resampled = np.zeros(num_samples)
    for i in range(num_samples):
        # Find nearest points
        idx = np.argmin(np.abs(x_norm - i))
        resampled[i] = y_vals[idx]

    # Convert to voltage: center and scale
    # Assume typical R-wave is ~1mV = 1000µV
    y_centered = resampled - np.mean(resampled)
    y_range = np.percentile(np.abs(y_centered), 98)
    if y_range > 0:
        # Scale so typical R-wave is ~1000µV
        scale = 1000.0 / y_range
        voltage_uV = y_centered * scale
    else:
        voltage_uV = y_centered

    # Flip if needed (R-waves should be positive in lead II)
    if np.min(voltage_uV) < -np.max(voltage_uV):
        voltage_uV = -voltage_uV

    return {
        'voltage_uV': voltage_uV.tolist(),
        'fs': fs,
        'duration_s': duration_s
    }

def process_with_ecg_digitiser(image_path):
    """Process using ECG-Digitiser ML model."""
    if not ECG_DIGITISER_AVAILABLE:
        return None

    try:
        result = digitise_ecg(str(image_path))
        # Convert to EKGQuest format
        leads_uV = {}
        for lead_name, signal in result.items():
            leads_uV[lead_name] = (np.array(signal) * 1000).tolist()  # mV to µV

        return {
            'leads_uV': leads_uV,
            'fs': 500,
            'duration_s': len(list(result.values())[0]) / 500
        }
    except Exception as e:
        print(f"  ECG-Digitiser error: {e}")
        return None

def create_ecg_json(trace_data, source_file, method):
    """Create EKGQuest-compatible JSON from extracted trace."""

    if 'leads_uV' in trace_data:
        # Multi-lead from ECG-Digitiser
        leads_uV = trace_data['leads_uV']
    else:
        # Single-lead basic extraction - assign to Lead II
        voltage = trace_data['voltage_uV']
        leads_uV = {
            'II': voltage,
            # Derive other leads approximately
            'I': [v * 0.6 for v in voltage],
            'III': [voltage[i] - voltage[i] * 0.6 for i in range(len(voltage))],
            'aVR': [-(voltage[i] * 0.6 + voltage[i]) / 2 for i in range(len(voltage))],
            'aVL': [voltage[i] * 0.6 - voltage[i] / 2 for i in range(len(voltage))],
            'aVF': [voltage[i] - voltage[i] * 0.6 / 2 for i in range(len(voltage))],
            'V1': [v * -0.3 for v in voltage],
            'V2': [v * -0.1 for v in voltage],
            'V3': [v * 0.2 for v in voltage],
            'V4': [v * 0.5 for v in voltage],
            'V5': [v * 0.7 for v in voltage],
            'V6': [v * 0.8 for v in voltage],
        }

    ecg = {
        'schema_version': '1.0',
        'fs': trace_data['fs'],
        'duration_s': trace_data['duration_s'],
        'leads_uV': leads_uV,
        'targets': {
            'synthetic': False,
            'imported': True,
            'source': 'image',
            'filename': source_file.name,
            'import_method': method,
            'import_time': datetime.now().isoformat(),
            'dx': 'Imported ECG'
        },
        'integrity': {
            'format': 'auto_import',
            'method': method
        }
    }

    return ecg

def process_image(image_path):
    """Process a single ECG image."""
    print(f"  Processing: {image_path.name}")

    # Try ECG-Digitiser first (best quality)
    if ECG_DIGITISER_AVAILABLE:
        result = process_with_ecg_digitiser(image_path)
        if result:
            return create_ecg_json(result, image_path, 'ecg-digitiser')

    # Fall back to basic OpenCV extraction
    if CV2_AVAILABLE:
        result = extract_trace_basic(image_path)
        if result:
            return create_ecg_json(result, image_path, 'opencv-basic')

    return None

def get_file_hash(path):
    """Get hash of file for change detection."""
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]

def watch_loop():
    """Main watch loop."""
    processed_hashes = set()

    print("\n🔍 Watching for new ECG images...")
    print("   Drop images into:", WATCH_DIR)
    print("   Press Ctrl+C to stop\n")

    while True:
        try:
            for ext in SUPPORTED_EXTENSIONS:
                for image_path in WATCH_DIR.glob(f"*{ext}"):
                    if image_path.parent != WATCH_DIR:
                        continue  # Skip files in subdirs

                    file_hash = get_file_hash(image_path)
                    if file_hash in processed_hashes:
                        continue

                    print(f"\n📥 New image detected: {image_path.name}")

                    ecg_json = process_image(image_path)

                    if ecg_json:
                        # Save JSON
                        output_name = image_path.stem + '.json'
                        output_path = OUTPUT_DIR / output_name

                        with open(output_path, 'w') as f:
                            json.dump(ecg_json, f, indent=2)

                        print(f"  ✅ Saved: {output_path}")
                        print(f"     Method: {ecg_json['integrity']['method']}")

                        # Auto-open in EKGQuest
                        import webbrowser
                        import urllib.parse
                        # Open EKGQuest Lab with file path hint
                        webbrowser.open('http://localhost:8000/viewer/ekgquest_lab.html')
                        print(f"     🌐 Opened EKGQuest Lab - drag in: {output_name}")

                        # Move original to processed
                        processed_path = PROCESSED_DIR / image_path.name
                        image_path.rename(processed_path)
                    else:
                        print(f"  ❌ Could not extract trace from {image_path.name}")
                        print(f"     Try WebPlotDigitizer for manual extraction")

                    processed_hashes.add(file_hash)

            time.sleep(1)

        except KeyboardInterrupt:
            print("\n\n👋 Stopped watching.")
            break

def main():
    print("=" * 50)
    print("EKGQuest ECG Import Watcher")
    print("=" * 50)

    setup_directories()
    watch_loop()

if __name__ == '__main__':
    main()
