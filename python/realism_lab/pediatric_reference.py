"""
Pediatric ECG Reference Values from Published Literature

Sources:
- Rijnbeek et al. 2001: "New normal limits for the paediatric electrocardiogram"
  Eur Heart J. 2001;22(8):702-711. (1912 Dutch children, 500Hz sampling)
- Davignon et al. 1979/1980: "Normal ECG standards for infants and children"
  Pediatric Cardiology 1:123-131. (2141 children, 333Hz sampling)
- ECGwaves.com compilation: https://ecgwaves.com/topic/reference-values-for-pediatric-electrocardiogram-ecg/

These are ACTUAL published values, not approximations.
Format: median (2nd percentile, 98th percentile)
"""

from dataclasses import dataclass
from typing import Dict, Optional, Tuple, List
import numpy as np

# =============================================================================
# RIJNBEEK ET AL. 2001 - PEDIATRIC ECG REFERENCE VALUES
# =============================================================================

# Age bins with actual published values
# Format: "median (2nd, 98th)" parsed into structured data
RIJNBEEK_REFERENCE = {
    "source": "Rijnbeek et al. 2001, Eur Heart J 22:702-711",
    "n_subjects": 1912,
    "sampling_rate_hz": 500,

    "age_bins": [
        {
            "id": "0-1m",
            "age_range_months": [0, 1],
            "age_range_years": [0, 0.083],
            "heart_rate": {"boys": {"p50": 160, "p2": 129, "p98": 192}, "girls": {"p50": 155, "p2": 136, "p98": 216}},
            "pr_interval_ms": {"boys": {"p50": 99, "p2": 77, "p98": 120}, "girls": {"p50": 101, "p2": 91, "p98": 121}},
            "qrs_duration_ms": {"boys": {"p50": 67, "p2": 50, "p98": 85}, "girls": {"p50": 67, "p2": 54, "p98": 79}},
            "qtc_ms": {"boys": {"p50": 413, "p2": 378, "p98": 448}, "girls": {"p50": 420, "p2": 379, "p98": 462}},
            "qrs_axis_deg": {"boys": {"p50": 97, "p2": 75, "p98": 140}, "girls": {"p50": 110, "p2": 63, "p98": 155}},
        },
        {
            "id": "1-3m",
            "age_range_months": [1, 3],
            "age_range_years": [0.083, 0.25],
            "heart_rate": {"boys": {"p50": 152, "p2": 126, "p98": 187}, "girls": {"p50": 154, "p2": 126, "p98": 200}},
            "pr_interval_ms": {"boys": {"p50": 98, "p2": 85, "p98": 120}, "girls": {"p50": 99, "p2": 78, "p98": 133}},
            "qrs_duration_ms": {"boys": {"p50": 64, "p2": 52, "p98": 77}, "girls": {"p50": 63, "p2": 48, "p98": 77}},
            "qtc_ms": {"boys": {"p50": 419, "p2": 396, "p98": 458}, "girls": {"p50": 424, "p2": 381, "p98": 454}},
            "qrs_axis_deg": {"boys": {"p50": 87, "p2": 37, "p98": 138}, "girls": {"p50": 80, "p2": 39, "p98": 121}},
        },
        {
            "id": "3-6m",
            "age_range_months": [3, 6],
            "age_range_years": [0.25, 0.5],
            "heart_rate": {"boys": {"p50": 134, "p2": 112, "p98": 165}, "girls": {"p50": 139, "p2": 122, "p98": 191}},
            "pr_interval_ms": {"boys": {"p50": 106, "p2": 87, "p98": 134}, "girls": {"p50": 106, "p2": 84, "p98": 127}},
            "qrs_duration_ms": {"boys": {"p50": 66, "p2": 54, "p98": 85}, "girls": {"p50": 64, "p2": 50, "p98": 78}},
            "qtc_ms": {"boys": {"p50": 422, "p2": 391, "p98": 453}, "girls": {"p50": 418, "p2": 386, "p98": 448}},
            "qrs_axis_deg": {"boys": {"p50": 66, "p2": -6, "p98": 107}, "girls": {"p50": 70, "p2": 17, "p98": 108}},
        },
        {
            "id": "6-12m",
            "age_range_months": [6, 12],
            "age_range_years": [0.5, 1.0],
            "heart_rate": {"boys": {"p50": 128, "p2": 106, "p98": 194}, "girls": {"p50": 134, "p2": 106, "p98": 187}},
            "pr_interval_ms": {"boys": {"p50": 114, "p2": 82, "p98": 141}, "girls": {"p50": 109, "p2": 88, "p98": 133}},
            "qrs_duration_ms": {"boys": {"p50": 69, "p2": 52, "p98": 86}, "girls": {"p50": 64, "p2": 52, "p98": 80}},
            "qtc_ms": {"boys": {"p50": 411, "p2": 379, "p98": 449}, "girls": {"p50": 414, "p2": 381, "p98": 446}},
            "qrs_axis_deg": {"boys": {"p50": 68, "p2": 14, "p98": 122}, "girls": {"p50": 67, "p2": 1, "p98": 102}},
        },
        {
            "id": "1-3y",
            "age_range_months": [12, 36],
            "age_range_years": [1.0, 3.0],
            "heart_rate": {"boys": {"p50": 119, "p2": 97, "p98": 155}, "girls": {"p50": 128, "p2": 95, "p98": 178}},
            "pr_interval_ms": {"boys": {"p50": 118, "p2": 86, "p98": 151}, "girls": {"p50": 113, "p2": 78, "p98": 147}},
            "qrs_duration_ms": {"boys": {"p50": 71, "p2": 54, "p98": 88}, "girls": {"p50": 68, "p2": 54, "p98": 85}},
            "qtc_ms": {"boys": {"p50": 412, "p2": 383, "p98": 455}, "girls": {"p50": 417, "p2": 381, "p98": 447}},
            "qrs_axis_deg": {"boys": {"p50": 64, "p2": -4, "p98": 118}, "girls": {"p50": 69, "p2": 2, "p98": 121}},
        },
        {
            "id": "3-5y",
            "age_range_months": [36, 60],
            "age_range_years": [3.0, 5.0],
            "heart_rate": {"boys": {"p50": 98, "p2": 73, "p98": 123}, "girls": {"p50": 101, "p2": 78, "p98": 124}},
            "pr_interval_ms": {"boys": {"p50": 121, "p2": 98, "p98": 152}, "girls": {"p50": 123, "p2": 99, "p98": 153}},
            "qrs_duration_ms": {"boys": {"p50": 75, "p2": 58, "p98": 92}, "girls": {"p50": 71, "p2": 58, "p98": 88}},
            "qtc_ms": {"boys": {"p50": 412, "p2": 377, "p98": 448}, "girls": {"p50": 415, "p2": 388, "p98": 442}},
            "qrs_axis_deg": {"boys": {"p50": 70, "p2": 7, "p98": 112}, "girls": {"p50": 69, "p2": 3, "p98": 106}},
        },
        {
            "id": "5-8y",
            "age_range_months": [60, 96],
            "age_range_years": [5.0, 8.0],
            "heart_rate": {"boys": {"p50": 88, "p2": 62, "p98": 113}, "girls": {"p50": 89, "p2": 68, "p98": 115}},
            "pr_interval_ms": {"boys": {"p50": 129, "p2": 99, "p98": 160}, "girls": {"p50": 124, "p2": 92, "p98": 156}},
            "qrs_duration_ms": {"boys": {"p50": 80, "p2": 63, "p98": 98}, "girls": {"p50": 77, "p2": 59, "p98": 95}},
            "qtc_ms": {"boys": {"p50": 411, "p2": 371, "p98": 443}, "girls": {"p50": 409, "p2": 375, "p98": 449}},
            "qrs_axis_deg": {"boys": {"p50": 70, "p2": -10, "p98": 112}, "girls": {"p50": 74, "p2": 27, "p98": 117}},
        },
        {
            "id": "8-12y",
            "age_range_months": [96, 144],
            "age_range_years": [8.0, 12.0],
            "heart_rate": {"boys": {"p50": 78, "p2": 55, "p98": 101}, "girls": {"p50": 80, "p2": 58, "p98": 110}},
            "pr_interval_ms": {"boys": {"p50": 134, "p2": 105, "p98": 174}, "girls": {"p50": 129, "p2": 103, "p98": 163}},
            "qrs_duration_ms": {"boys": {"p50": 85, "p2": 67, "p98": 103}, "girls": {"p50": 82, "p2": 66, "p98": 99}},
            "qtc_ms": {"boys": {"p50": 411, "p2": 373, "p98": 440}, "girls": {"p50": 410, "p2": 365, "p98": 447}},
            "qrs_axis_deg": {"boys": {"p50": 70, "p2": -21, "p98": 114}, "girls": {"p50": 66, "p2": 5, "p98": 117}},
        },
        {
            "id": "12-16y",
            "age_range_months": [144, 192],
            "age_range_years": [12.0, 16.0],
            "heart_rate": {"boys": {"p50": 73, "p2": 48, "p98": 99}, "girls": {"p50": 76, "p2": 54, "p98": 107}},
            "pr_interval_ms": {"boys": {"p50": 139, "p2": 107, "p98": 178}, "girls": {"p50": 135, "p2": 106, "p98": 176}},
            "qrs_duration_ms": {"boys": {"p50": 91, "p2": 78, "p98": 111}, "girls": {"p50": 87, "p2": 72, "p98": 106}},
            "qtc_ms": {"boys": {"p50": 407, "p2": 362, "p98": 449}, "girls": {"p50": 414, "p2": 370, "p98": 457}},
            "qrs_axis_deg": {"boys": {"p50": 65, "p2": -9, "p98": 112}, "girls": {"p50": 66, "p2": 5, "p98": 101}},
        },
    ],
}


def get_rijnbeek_bin(age_years: float) -> Optional[dict]:
    """Get the appropriate Rijnbeek age bin for a given age."""
    for bin_data in RIJNBEEK_REFERENCE["age_bins"]:
        low, high = bin_data["age_range_years"]
        if low <= age_years < high:
            return bin_data
    # Return adolescent bin for older ages
    return RIJNBEEK_REFERENCE["age_bins"][-1]


def get_reference_value(age_years: float, param: str, sex: str = "boys") -> dict:
    """
    Get reference values for a parameter at a given age.

    Args:
        age_years: Age in years
        param: Parameter name (heart_rate, pr_interval_ms, qrs_duration_ms, qtc_ms, qrs_axis_deg)
        sex: "boys" or "girls"

    Returns:
        Dict with p2, p50, p98 values
    """
    bin_data = get_rijnbeek_bin(age_years)
    if bin_data is None or param not in bin_data:
        return {}

    sex = sex.lower()
    if sex not in ["boys", "girls"]:
        sex = "boys"

    return bin_data[param].get(sex, bin_data[param].get("boys", {}))


def compute_percentile(value: float, age_years: float, param: str, sex: str = "boys") -> Optional[float]:
    """
    Compute approximate percentile for a value given age and parameter.

    Uses linear interpolation between known percentiles (2, 50, 98).

    Returns percentile (0-100) or None if reference not available.
    """
    ref = get_reference_value(age_years, param, sex)
    if not ref:
        return None

    p2, p50, p98 = ref["p2"], ref["p50"], ref["p98"]

    if value <= p2:
        return 2 * (value / p2) if p2 > 0 else 0
    elif value <= p50:
        return 2 + 48 * (value - p2) / (p50 - p2)
    elif value <= p98:
        return 50 + 48 * (value - p50) / (p98 - p50)
    else:
        return min(100, 98 + 2 * (value - p98) / (p98 - p50))


def compute_z_score_rijnbeek(value: float, age_years: float, param: str, sex: str = "boys") -> Optional[float]:
    """
    Compute z-score using Rijnbeek reference data.

    Approximates SD from the 2nd-98th percentile range (covers ~4 SDs).
    """
    ref = get_reference_value(age_years, param, sex)
    if not ref:
        return None

    p2, p50, p98 = ref["p2"], ref["p50"], ref["p98"]

    # Approximate SD: p98 - p2 covers ~4 SDs (±2 SD from mean)
    approx_sd = (p98 - p2) / 4

    if approx_sd <= 0:
        return 0

    return (value - p50) / approx_sd


def check_within_normal(value: float, age_years: float, param: str, sex: str = "boys") -> dict:
    """
    Check if a value is within normal limits for age.

    Returns dict with:
        - within_2_98: True if between 2nd and 98th percentile
        - percentile: Approximate percentile
        - z_score: Approximate z-score
        - interpretation: Text interpretation
    """
    ref = get_reference_value(age_years, param, sex)
    if not ref:
        return {"within_2_98": None, "percentile": None, "z_score": None, "interpretation": "No reference data"}

    p2, p50, p98 = ref["p2"], ref["p50"], ref["p98"]
    within = p2 <= value <= p98
    percentile = compute_percentile(value, age_years, param, sex)
    z_score = compute_z_score_rijnbeek(value, age_years, param, sex)

    if percentile is None:
        interpretation = "Unknown"
    elif percentile < 2:
        interpretation = "Below 2nd percentile (abnormally low)"
    elif percentile < 5:
        interpretation = "Low normal (2nd-5th percentile)"
    elif percentile <= 95:
        interpretation = "Normal"
    elif percentile <= 98:
        interpretation = "High normal (95th-98th percentile)"
    else:
        interpretation = "Above 98th percentile (abnormally high)"

    return {
        "within_2_98": within,
        "percentile": round(percentile, 1) if percentile else None,
        "z_score": round(z_score, 2) if z_score else None,
        "interpretation": interpretation,
        "reference": {"p2": p2, "p50": p50, "p98": p98},
    }


# =============================================================================
# VALIDATION FUNCTIONS
# =============================================================================

@dataclass
class RijnbeekValidationResult:
    """Result of validating ECG parameters against Rijnbeek reference."""
    age_years: float
    sex: str
    parameters_checked: int
    parameters_within_normal: int
    pass_rate: float
    details: Dict[str, dict]


def validate_ecg_against_rijnbeek(
    age_years: float,
    hr_bpm: float,
    pr_ms: float,
    qrs_ms: float,
    qtc_ms: float,
    axis_deg: float,
    sex: str = "boys"
) -> RijnbeekValidationResult:
    """
    Validate ECG parameters against Rijnbeek reference values.

    Returns comprehensive validation result.
    """
    params = {
        "heart_rate": hr_bpm,
        "pr_interval_ms": pr_ms,
        "qrs_duration_ms": qrs_ms,
        "qtc_ms": qtc_ms,
        "qrs_axis_deg": axis_deg,
    }

    details = {}
    n_within = 0

    for param_name, value in params.items():
        result = check_within_normal(value, age_years, param_name, sex)
        details[param_name] = {
            "value": value,
            **result
        }
        if result["within_2_98"]:
            n_within += 1

    return RijnbeekValidationResult(
        age_years=age_years,
        sex=sex,
        parameters_checked=len(params),
        parameters_within_normal=n_within,
        pass_rate=n_within / len(params) * 100,
        details=details,
    )


# Export key functions
__all__ = [
    "RIJNBEEK_REFERENCE",
    "get_rijnbeek_bin",
    "get_reference_value",
    "compute_percentile",
    "compute_z_score_rijnbeek",
    "check_within_normal",
    "validate_ecg_against_rijnbeek",
    "RijnbeekValidationResult",
]
