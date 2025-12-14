"""
Flask API for ECG Digitization Service

Provides REST endpoints for Viterbi-based ECG trace extraction.
Designed to run locally on macOS for EKGQuest integration.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
from PIL import Image
import io
import time
import traceback

from .viterbi import extract_signal, extract_multi_lead, ExtractionResult

app = Flask(__name__)
CORS(app)  # Allow requests from browser (localhost)


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "healthy",
        "service": "ekgquest-digitize",
        "algorithm": "viterbi_dp",
        "version": "1.0.0"
    })


@app.route('/api/digitize', methods=['POST'])
def digitize():
    """
    Digitize an ECG image to waveform data.

    Request:
        Content-Type: multipart/form-data
        Body:
            image: binary image file (PNG, JPEG, etc.)
            paper_speed: float, mm/s (default: 25)
            voltage_scale: float, mm/mV (default: 10)
            lead_hint: string, expected lead name (default: "II")

    Response:
        {
            "success": true,
            "leads": {
                "II": {
                    "samples_uV": [...],
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
                "processing_time_ms": 1234
            }
        }
    """
    start_time = time.time()

    # Validate request
    if 'image' not in request.files:
        return jsonify({
            "success": False,
            "error": "No image provided",
            "suggestion": "Include image file in multipart/form-data request"
        }), 400

    # Parse parameters
    try:
        paper_speed = float(request.form.get('paper_speed', 25))
        voltage_scale = float(request.form.get('voltage_scale', 10))
        lead_hint = request.form.get('lead_hint', 'II')
    except ValueError as e:
        return jsonify({
            "success": False,
            "error": f"Invalid parameter: {str(e)}",
            "suggestion": "Ensure paper_speed and voltage_scale are numbers"
        }), 400

    try:
        # Load image
        image_file = request.files['image']

        # Read raw bytes for potential Claude vision fallback
        image_bytes = image_file.read()
        image_file.seek(0)  # Reset for PIL

        image = Image.open(image_file)

        # Convert to RGB if necessary (handles PNG with alpha, etc.)
        if image.mode == 'RGBA':
            # Create white background
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            image = background
        elif image.mode != 'RGB':
            image = image.convert('RGB')

        image_array = np.array(image)

        # Handle crop if provided
        crop = request.form.get('crop')
        if crop:
            import json
            try:
                crop = json.loads(crop)
                x1, y1 = int(crop.get('x1', 0)), int(crop.get('y1', 0))
                x2, y2 = int(crop.get('x2', image_array.shape[1])), int(crop.get('y2', image_array.shape[0]))
                image_array = image_array[y1:y2, x1:x2]
            except (json.JSONDecodeError, KeyError, TypeError):
                pass  # Ignore invalid crop, use full image

        # Extract signal
        result = extract_signal(
            image_array,
            paper_speed_mm_s=paper_speed,
            voltage_scale_mm_mV=voltage_scale,
            target_fs=500,
            lead_hint=lead_hint,
            image_bytes=image_bytes
        )

        processing_time = (time.time() - start_time) * 1000

        # Build response
        # Convert numpy array to list for JSON serialization
        samples = result.signal_uV.tolist()

        # Debug: log signal stats
        signal_arr = np.array(samples)
        print(f"Signal stats: min={signal_arr.min():.1f}, max={signal_arr.max():.1f}, "
              f"mean={signal_arr.mean():.1f}, std={signal_arr.std():.1f}")
        print(f"Grid spacing: {result.grid_spacing_px:.2f} px/mm, Quality: {result.quality_score:.2f}")

        # Detect potential issues
        issues = []
        if result.quality_score < 0.5:
            issues.append("Low confidence extraction - consider manual calibration")
        if result.grid_spacing_px < 5:
            issues.append("Grid detection uncertain - verify paper speed setting")

        signal_range = max(samples) - min(samples)
        if signal_range < 500:
            issues.append("Low amplitude signal - check voltage scale or image quality")
        elif signal_range > 10000:
            issues.append("High amplitude - possible clipping or incorrect scale")

        return jsonify({
            "success": True,
            "leads": {
                lead_hint: {
                    "samples_uV": samples,
                    "fs": result.fs,
                    "duration_s": result.duration_s
                }
            },
            "calibration": {
                "px_per_mm": result.grid_spacing_px,
                "method": "autocorrelation",
                "confidence": result.quality_score
            },
            "quality": {
                "score": result.quality_score,
                "issues": issues
            },
            "metadata": {
                "algorithm": result.method,
                "processing_time_ms": round(processing_time, 1),
                "image_size": [image_array.shape[1], image_array.shape[0]]
            }
        })

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "suggestion": "Try manual calibration or higher resolution image"
        }), 400

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": f"Processing failed: {str(e)}",
            "suggestion": "Check image format and try again"
        }), 500


@app.route('/api/calibrate', methods=['POST'])
def calibrate():
    """
    Calibrate grid spacing from an image without full extraction.

    Useful for checking auto-calibration before committing to extraction.

    Request:
        Content-Type: multipart/form-data
        Body:
            image: binary image file

    Response:
        {
            "success": true,
            "calibration": {
                "px_per_mm": 11.34,
                "confidence": 0.95
            }
        }
    """
    if 'image' not in request.files:
        return jsonify({
            "success": False,
            "error": "No image provided"
        }), 400

    try:
        from .viterbi import detect_grid_spacing

        image_file = request.files['image']
        image = Image.open(image_file)

        if image.mode == 'RGBA':
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            image = background
        elif image.mode != 'RGB':
            image = image.convert('RGB')

        image_array = np.array(image)

        # Convert to grayscale
        if len(image_array.shape) == 3:
            gray = np.mean(image_array, axis=2).astype(np.uint8)
        else:
            gray = image_array

        spacing, confidence = detect_grid_spacing(gray)

        if spacing is None:
            return jsonify({
                "success": False,
                "error": "Could not detect grid spacing",
                "suggestion": "Try manual calibration"
            }), 400

        return jsonify({
            "success": True,
            "calibration": {
                "px_per_mm": float(spacing),
                "confidence": float(confidence)
            }
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


def main():
    """Run the development server."""
    print("\n" + "="*60)
    print("  EKGQuest Digitization Service")
    print("="*60)
    print("\n  API Endpoints:")
    print("    GET  /api/health     - Health check")
    print("    POST /api/digitize   - Digitize ECG image")
    print("    POST /api/calibrate  - Calibrate grid spacing")
    print("\n  Server: http://localhost:5001")
    print("="*60 + "\n")

    app.run(host='127.0.0.1', port=5001, debug=True)


if __name__ == '__main__':
    main()
