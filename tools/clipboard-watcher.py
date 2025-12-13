#!/usr/bin/env python3
"""
EKGQuest Clipboard Watcher - Maximum Frictionless Import

USAGE:
    python tools/clipboard-watcher.py

Then just copy any ECG image (Cmd+C) - it auto-appears in EKGQuest!
"""

import os
import sys
import json
import time
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime
from io import BytesIO

# Check for required packages
try:
    from PIL import Image, ImageGrab
    import cv2
    import numpy as np
except ImportError:
    print("Installing required packages...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pillow", "opencv-python", "numpy", "-q"])
    from PIL import Image, ImageGrab
    import cv2
    import numpy as np

# Flask for serving JSON to browser
try:
    from flask import Flask, jsonify, send_from_directory
    from flask_cors import CORS
    FLASK_AVAILABLE = True
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "flask", "flask-cors", "-q"])
    from flask import Flask, jsonify, send_from_directory
    from flask_cors import CORS
    FLASK_AVAILABLE = True

import threading
import webbrowser

# Global state
latest_ecg = None
ecg_counter = 0

app = Flask(__name__)
CORS(app)

@app.route('/latest-ecg')
def get_latest_ecg():
    """Endpoint for EKGQuest to fetch the latest imported ECG."""
    global latest_ecg
    if latest_ecg:
        return jsonify(latest_ecg)
    return jsonify(None)

@app.route('/ecg-ready')
def ecg_ready():
    """Check if new ECG is available."""
    global ecg_counter
    return jsonify({'count': ecg_counter})

def extract_trace(img_array):
    """Extract ECG trace from image using OpenCV."""
    # Convert to grayscale
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # Invert if background is dark
    if np.mean(gray) < 128:
        gray = 255 - gray

    # Adaptive threshold for better trace detection
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY_INV, 21, 10)

    # Morphological operations to clean up
    kernel = np.ones((2, 2), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    height, width = binary.shape
    trace = []

    # Scan columns to find trace
    for x in range(width):
        column = binary[:, x]
        y_positions = np.where(column > 0)[0]
        if len(y_positions) > 0:
            y = np.median(y_positions)  # Use median for robustness
            trace.append((x, y))

    if len(trace) < 100:
        return None

    trace = np.array(trace)
    x_vals = trace[:, 0]
    y_vals = trace[:, 1]

    # Resample to 500 Hz, 10 seconds
    duration_s = 10.0
    fs = 500
    num_samples = int(duration_s * fs)

    x_norm = (x_vals - x_vals.min()) / (x_vals.max() - x_vals.min() + 1e-6) * (num_samples - 1)

    resampled = np.zeros(num_samples)
    for i in range(num_samples):
        idx = np.argmin(np.abs(x_norm - i))
        resampled[i] = y_vals[idx]

    # Convert to voltage
    y_centered = resampled - np.mean(resampled)
    y_range = np.percentile(np.abs(y_centered), 95)
    if y_range > 0:
        voltage_uV = (y_centered / y_range) * 1000  # Scale to ~1mV R-wave
    else:
        voltage_uV = y_centered

    # Ensure R-waves are positive
    if np.min(voltage_uV) < -np.max(voltage_uV):
        voltage_uV = -voltage_uV

    # Smooth slightly
    kernel_size = 3
    voltage_uV = np.convolve(voltage_uV, np.ones(kernel_size)/kernel_size, mode='same')

    return {
        'voltage_uV': voltage_uV.tolist(),
        'fs': fs,
        'duration_s': duration_s
    }

def create_ecg_json(trace_data, source='clipboard'):
    """Create EKGQuest-compatible JSON."""
    voltage = trace_data['voltage_uV']

    leads_uV = {
        'II': voltage,
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

    return {
        'schema_version': '1.0',
        'fs': trace_data['fs'],
        'duration_s': trace_data['duration_s'],
        'leads_uV': leads_uV,
        'targets': {
            'synthetic': False,
            'imported': True,
            'source': source,
            'import_time': datetime.now().isoformat(),
            'dx': 'Imported ECG'
        },
        'integrity': {
            'format': 'clipboard_import'
        }
    }

def process_clipboard_image(img):
    """Process PIL Image from clipboard."""
    global latest_ecg, ecg_counter

    # Convert to numpy array
    img_array = np.array(img)

    # Extract trace
    trace_data = extract_trace(img_array)

    if trace_data:
        ecg_json = create_ecg_json(trace_data)
        latest_ecg = ecg_json
        ecg_counter += 1
        return True
    return False

def get_clipboard_image():
    """Get image from clipboard if available."""
    try:
        img = ImageGrab.grabclipboard()
        if isinstance(img, Image.Image):
            return img
    except Exception:
        pass
    return None

def clipboard_watch_loop():
    """Watch clipboard for new images."""
    last_image_hash = None

    print("\n📋 Watching clipboard...")
    print("   Copy any ECG image (Cmd+C) and it will auto-import!\n")

    while True:
        try:
            img = get_clipboard_image()

            if img:
                # Hash to detect new images
                img_hash = hash(img.tobytes())

                if img_hash != last_image_hash:
                    last_image_hash = img_hash

                    # Check if it looks like an ECG (reasonable dimensions)
                    w, h = img.size
                    if w > 200 and h > 100:
                        print(f"📥 New image detected ({w}x{h})")

                        if process_clipboard_image(img):
                            print(f"   ✅ ECG #{ecg_counter} ready!")
                            print(f"   🌐 Check EKGQuest Lab - click 'Load from Clipboard Watcher'")
                        else:
                            print(f"   ⚠️ Could not extract trace - try a cleaner image")

            time.sleep(0.5)

        except KeyboardInterrupt:
            break
        except Exception as e:
            time.sleep(1)

def run_server():
    """Run Flask server in background."""
    app.run(port=8001, debug=False, use_reloader=False, threaded=True)

def main():
    print("=" * 55)
    print("EKGQuest Clipboard Watcher - Zero Friction Import")
    print("=" * 55)

    # Start API server in background
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    print("✓ API server running on http://localhost:8001")

    # Open EKGQuest
    webbrowser.open('http://localhost:8000/viewer/ekgquest_lab.html')

    # Start watching clipboard
    clipboard_watch_loop()

if __name__ == '__main__':
    main()
