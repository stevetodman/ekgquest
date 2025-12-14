"""
Claude Vision Integration for ECG Trace Color Detection

Uses Claude's vision capabilities to identify ECG trace colors
when deterministic detection fails or has low confidence.
"""

import base64
import os
from typing import List, Tuple, Optional
from dataclasses import dataclass


@dataclass
class TraceColorInfo:
    """Information about detected trace colors."""
    colors: List[Tuple[int, int, int]]  # RGB values
    color_names: List[str]              # Human-readable names
    confidence: float                    # 0-1
    background_type: str                # "grid", "white", "dark", etc.
    notes: str                          # Additional observations


def identify_trace_colors(
    image_bytes: bytes,
    media_type: str = "image/png"
) -> Optional[TraceColorInfo]:
    """
    Use Claude vision to identify ECG trace colors in an image.

    Args:
        image_bytes: Raw image bytes
        media_type: MIME type (image/png, image/jpeg, etc.)

    Returns:
        TraceColorInfo with detected colors, or None if API unavailable
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    try:
        import anthropic
    except ImportError:
        return None

    # Encode image to base64
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    client = anthropic.Anthropic(api_key=api_key)

    prompt = """Analyze this ECG/EKG image and identify the trace colors.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
    "trace_colors": [
        {"name": "blue", "rgb": [0, 0, 255]},
        {"name": "black", "rgb": [0, 0, 0]}
    ],
    "background": "pink_grid",
    "confidence": 0.95,
    "notes": "Standard 12-lead ECG with blue traces on pink grid paper"
}

Rules:
- List ALL distinct trace colors (the actual ECG waveform lines)
- Do NOT include grid lines or background colors as traces
- RGB values should be approximate (0-255 for each channel)
- Background types: "pink_grid", "white_grid", "white", "dark", "other"
- Confidence: how sure you are about the trace colors (0.0-1.0)"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
        )

        # Parse response
        import json
        text = response.content[0].text.strip()

        # Handle potential markdown wrapping
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        data = json.loads(text)

        colors = []
        color_names = []
        for tc in data.get("trace_colors", []):
            rgb = tuple(tc.get("rgb", [0, 0, 0]))
            colors.append(rgb)
            color_names.append(tc.get("name", "unknown"))

        return TraceColorInfo(
            colors=colors,
            color_names=color_names,
            confidence=data.get("confidence", 0.5),
            background_type=data.get("background", "unknown"),
            notes=data.get("notes", "")
        )

    except Exception as e:
        print(f"Claude vision error: {e}")
        return None


def create_color_mask(
    image: "np.ndarray",
    target_colors: List[Tuple[int, int, int]],
    tolerance: int = 50
) -> "np.ndarray":
    """
    Create a binary mask for pixels matching target colors.

    Args:
        image: RGB image array (H, W, 3)
        target_colors: List of RGB tuples to match
        tolerance: Color distance tolerance (0-255)

    Returns:
        Binary mask where True = pixel matches a target color
    """
    import numpy as np

    H, W = image.shape[:2]
    mask = np.zeros((H, W), dtype=bool)

    for target_rgb in target_colors:
        tr, tg, tb = target_rgb

        # Calculate color distance
        R = image[:, :, 0].astype(np.float32)
        G = image[:, :, 1].astype(np.float32)
        B = image[:, :, 2].astype(np.float32)

        distance = np.sqrt(
            (R - tr) ** 2 +
            (G - tg) ** 2 +
            (B - tb) ** 2
        )

        # Pixels within tolerance
        mask = mask | (distance < tolerance)

    return mask
