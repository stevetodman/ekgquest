"""
Realism metrics for synthetic ECG evaluation.

Provides functions to compute:
- Physics consistency metrics (Einthoven, lead relationships)
- Distribution metrics (HR, intervals, axes vs priors)
- Morphology metrics (R/S progression, QRS energy)
- HRV metrics (SDNN, RMSSD, etc.)
"""

import json
import numpy as np
from pathlib import Path
from scipy import signal
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field

from .io_ecgjson import ECGData


# =============================================================================
# PEDIATRIC PRIORS
# SOURCE OF TRUTH: /data/pediatric_priors.json
# =============================================================================

def _load_pediatric_priors() -> Dict:
    """Load pediatric priors from JSON source of truth."""
    # Try to load from the canonical JSON file
    json_paths = [
        Path(__file__).parent.parent.parent / "data" / "pediatric_priors.json",
        Path(__file__).parent.parent / "data" / "pediatric_priors.json",
    ]

    for json_path in json_paths:
        if json_path.exists():
            with open(json_path) as f:
                data = json.load(f)
                # Convert PR/QRS/QTc from seconds to ms for consistency with validation
                for bin_data in data["age_bins"]:
                    if "PR" in bin_data and bin_data["PR"]["mean"] < 1:
                        bin_data["PR"]["mean"] = int(bin_data["PR"]["mean"] * 1000)
                        bin_data["PR"]["sd"] = int(bin_data["PR"]["sd"] * 1000)
                    if "QRS" in bin_data and bin_data["QRS"]["mean"] < 1:
                        bin_data["QRS"]["mean"] = int(bin_data["QRS"]["mean"] * 1000)
                        bin_data["QRS"]["sd"] = int(bin_data["QRS"]["sd"] * 1000)
                    if "QTc" in bin_data and bin_data["QTc"]["mean"] < 1:
                        bin_data["QTc"]["mean"] = int(bin_data["QTc"]["mean"] * 1000)
                        bin_data["QTc"]["sd"] = int(bin_data["QTc"]["sd"] * 1000)
                return data

    # Fallback to embedded version (kept for backwards compatibility)
    return {
        "age_bins": [
            {"id": "neonate", "age_range": [0, 0.08], "HR": {"mean": 145, "sd": 22}, "PR": {"mean": 100, "sd": 15}, "QRS": {"mean": 60, "sd": 8}, "QTc": {"mean": 400, "sd": 25}, "QRSaxis": {"mean": 125, "sd": 35}},
            {"id": "infant_early", "age_range": [0.08, 0.25], "HR": {"mean": 150, "sd": 20}, "PR": {"mean": 105, "sd": 15}, "QRS": {"mean": 62, "sd": 8}, "QTc": {"mean": 400, "sd": 25}, "QRSaxis": {"mean": 100, "sd": 35}},
            {"id": "infant_mid", "age_range": [0.25, 0.5], "HR": {"mean": 140, "sd": 20}, "PR": {"mean": 110, "sd": 18}, "QRS": {"mean": 65, "sd": 8}, "QTc": {"mean": 405, "sd": 25}, "QRSaxis": {"mean": 85, "sd": 35}},
            {"id": "infant_late", "age_range": [0.5, 1.0], "HR": {"mean": 130, "sd": 18}, "PR": {"mean": 115, "sd": 20}, "QRS": {"mean": 68, "sd": 8}, "QTc": {"mean": 410, "sd": 25}, "QRSaxis": {"mean": 75, "sd": 35}},
            {"id": "toddler", "age_range": [1.0, 3.0], "HR": {"mean": 115, "sd": 18}, "PR": {"mean": 120, "sd": 20}, "QRS": {"mean": 70, "sd": 8}, "QTc": {"mean": 410, "sd": 25}, "QRSaxis": {"mean": 65, "sd": 30}},
            {"id": "preschool", "age_range": [3.0, 6.0], "HR": {"mean": 100, "sd": 15}, "PR": {"mean": 130, "sd": 22}, "QRS": {"mean": 75, "sd": 10}, "QTc": {"mean": 415, "sd": 25}, "QRSaxis": {"mean": 60, "sd": 25}},
            {"id": "school", "age_range": [6.0, 12.0], "HR": {"mean": 85, "sd": 15}, "PR": {"mean": 140, "sd": 25}, "QRS": {"mean": 80, "sd": 12}, "QTc": {"mean": 420, "sd": 25}, "QRSaxis": {"mean": 55, "sd": 25}},
            {"id": "adolescent", "age_range": [12.0, 18.0], "HR": {"mean": 75, "sd": 12}, "PR": {"mean": 150, "sd": 28}, "QRS": {"mean": 85, "sd": 12}, "QTc": {"mean": 420, "sd": 25}, "QRSaxis": {"mean": 55, "sd": 25}},
            {"id": "young_adult", "age_range": [18.0, 40.0], "HR": {"mean": 72, "sd": 12}, "PR": {"mean": 160, "sd": 30}, "QRS": {"mean": 90, "sd": 12}, "QTc": {"mean": 420, "sd": 25}, "QRSaxis": {"mean": 50, "sd": 30}},
            {"id": "adult", "age_range": [40.0, 150.0], "HR": {"mean": 70, "sd": 12}, "PR": {"mean": 165, "sd": 32}, "QRS": {"mean": 92, "sd": 14}, "QTc": {"mean": 425, "sd": 28}, "QRSaxis": {"mean": 45, "sd": 35}},
        ]
    }

PEDIATRIC_PRIORS = _load_pediatric_priors()


def get_age_bin(age_years: float) -> Dict:
    """Get the appropriate age bin for a given age."""
    for bin_data in PEDIATRIC_PRIORS["age_bins"]:
        if bin_data["age_range"][0] <= age_years < bin_data["age_range"][1]:
            return bin_data
    return PEDIATRIC_PRIORS["age_bins"][-1]  # Default to young_adult


def compute_z_score(param: str, value: float, age_years: float) -> Optional[float]:
    """Compute z-score for a measurement given age."""
    bin_data = get_age_bin(age_years)
    if param not in bin_data:
        return None
    mean = bin_data[param]["mean"]
    sd = bin_data[param]["sd"]
    return (value - mean) / sd


# =============================================================================
# PHYSICS METRICS
# =============================================================================

@dataclass
class PhysicsMetrics:
    """Physics consistency metrics."""
    einthoven_max_error_uV: float = 0.0
    einthoven_mean_error_uV: float = 0.0
    augmented_consistency: bool = True
    has_clipping: bool = False
    clipping_samples: int = 0
    amplitude_range_uV: Tuple[float, float] = (0.0, 0.0)
    all_leads_present: bool = True
    missing_leads: List[str] = field(default_factory=list)


def compute_physics_metrics(ecg: ECGData) -> PhysicsMetrics:
    """
    Compute physics consistency metrics.

    Checks:
    - Einthoven's law: I + III = II
    - Augmented lead relationships
    - Clipping detection
    - Amplitude sanity
    """
    metrics = PhysicsMetrics()

    # Check required leads
    required_limb = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
    required_precordial = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']
    all_required = required_limb + required_precordial

    metrics.missing_leads = [l for l in all_required if l not in ecg.leads_uV]
    metrics.all_leads_present = len(metrics.missing_leads) == 0

    # Einthoven's law check: I + III = II
    if all(l in ecg.leads_uV for l in ['I', 'II', 'III']):
        lead_I = ecg.leads_uV['I'].astype(np.float64)
        lead_II = ecg.leads_uV['II'].astype(np.float64)
        lead_III = ecg.leads_uV['III'].astype(np.float64)

        einthoven_error = np.abs(lead_I + lead_III - lead_II)
        metrics.einthoven_max_error_uV = float(np.max(einthoven_error))
        metrics.einthoven_mean_error_uV = float(np.mean(einthoven_error))

    # Augmented lead consistency
    # aVR = -(I + II) / 2, aVL = I - II/2, aVF = II - I/2
    if all(l in ecg.leads_uV for l in ['I', 'II', 'aVR', 'aVL', 'aVF']):
        lead_I = ecg.leads_uV['I'].astype(np.float64)
        lead_II = ecg.leads_uV['II'].astype(np.float64)
        aVR_expected = -(lead_I + lead_II) / 2
        aVR_actual = ecg.leads_uV['aVR'].astype(np.float64)
        aVR_error = np.max(np.abs(aVR_expected - aVR_actual))
        metrics.augmented_consistency = aVR_error < 10  # Within 10 µV

    # Clipping detection (values at ADC limits)
    clipping_threshold = 32000  # Near int16 limits
    total_clipping = 0
    for lead_name, lead_data in ecg.leads_uV.items():
        clipping = np.sum(np.abs(lead_data) > clipping_threshold)
        total_clipping += clipping
    metrics.has_clipping = total_clipping > 0
    metrics.clipping_samples = total_clipping

    # Amplitude range
    all_values = np.concatenate([v for v in ecg.leads_uV.values()])
    metrics.amplitude_range_uV = (float(np.min(all_values)), float(np.max(all_values)))

    return metrics


# =============================================================================
# DISTRIBUTION METRICS
# =============================================================================

@dataclass
class DistributionMetrics:
    """Distribution comparison metrics vs pediatric priors."""
    age_bin: str = ""
    hr_z_score: Optional[float] = None
    pr_z_score: Optional[float] = None
    qrs_z_score: Optional[float] = None
    qtc_z_score: Optional[float] = None
    axis_z_score: Optional[float] = None
    all_within_2sd: bool = True
    outlier_params: List[str] = field(default_factory=list)


def compute_distribution_metrics(ecg: ECGData) -> DistributionMetrics:
    """
    Compare ECG parameters against pediatric priors.

    Computes z-scores for HR, PR, QRS, QTc, and axis.
    """
    metrics = DistributionMetrics()

    if not ecg.targets:
        return metrics

    age = ecg.targets.age_years
    bin_data = get_age_bin(age)
    metrics.age_bin = bin_data["id"]

    # HR z-score
    if ecg.targets.HR_bpm > 0:
        metrics.hr_z_score = compute_z_score("HR", ecg.targets.HR_bpm, age)

    # PR z-score (targets are in ms, priors are in ms)
    if ecg.targets.PR_ms > 0:
        metrics.pr_z_score = compute_z_score("PR", ecg.targets.PR_ms, age)

    # QRS z-score
    if ecg.targets.QRS_ms > 0:
        metrics.qrs_z_score = compute_z_score("QRS", ecg.targets.QRS_ms, age)

    # QTc z-score
    if ecg.targets.QTc_ms > 0:
        metrics.qtc_z_score = compute_z_score("QTc", ecg.targets.QTc_ms, age)

    # QRS axis z-score
    if ecg.targets.axes_deg and "QRS" in ecg.targets.axes_deg:
        metrics.axis_z_score = compute_z_score("QRSaxis", ecg.targets.axes_deg["QRS"], age)

    # Check for outliers (|z| > 2)
    z_scores = [
        ("HR", metrics.hr_z_score),
        ("PR", metrics.pr_z_score),
        ("QRS", metrics.qrs_z_score),
        ("QTc", metrics.qtc_z_score),
        ("Axis", metrics.axis_z_score),
    ]

    for name, z in z_scores:
        if z is not None and abs(z) > 2:
            metrics.outlier_params.append(name)

    metrics.all_within_2sd = len(metrics.outlier_params) == 0

    return metrics


# =============================================================================
# MORPHOLOGY METRICS
# =============================================================================

@dataclass
class MorphologyMetrics:
    """Morphology analysis metrics."""
    rs_progression_valid: bool = True
    rs_ratios: Dict[str, float] = field(default_factory=dict)
    qrs_energy_distribution: Dict[str, float] = field(default_factory=dict)
    dominant_r_lead: str = ""
    transition_zone: str = ""


def compute_morphology_metrics(ecg: ECGData) -> MorphologyMetrics:
    """
    Compute morphology metrics including R/S progression.

    Analyzes:
    - R/S ratio progression across V1-V6
    - QRS energy distribution
    - Transition zone detection
    """
    metrics = MorphologyMetrics()

    precordial_leads = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']
    available = [l for l in precordial_leads if l in ecg.leads_uV]

    if len(available) < 4:
        metrics.rs_progression_valid = False
        return metrics

    # Compute R/S ratios and QRS energy
    rs_ratios = {}
    qrs_energy = {}

    for lead in available:
        data = ecg.get_lead_mv(lead)

        # Simple R and S amplitude estimation (max positive, min negative)
        r_amp = np.max(data)
        s_amp = abs(np.min(data))

        if s_amp > 0.01:  # Avoid division by near-zero
            rs_ratios[lead] = r_amp / s_amp
        else:
            rs_ratios[lead] = float('inf') if r_amp > 0.1 else 1.0

        # QRS energy (sum of squared values in typical QRS window)
        qrs_energy[lead] = float(np.sum(data ** 2))

    metrics.rs_ratios = rs_ratios
    metrics.qrs_energy_distribution = qrs_energy

    # Find transition zone (where R/S ratio crosses 1.0)
    for i, lead in enumerate(available[:-1]):
        if rs_ratios.get(lead, 0) < 1.0 and rs_ratios.get(available[i + 1], 0) >= 1.0:
            metrics.transition_zone = f"{lead}-{available[i + 1]}"
            break

    # Find dominant R wave lead
    max_r_lead = max(available, key=lambda l: np.max(ecg.get_lead_mv(l)))
    metrics.dominant_r_lead = max_r_lead

    # Validate R/S progression (should generally increase V1→V6)
    if 'V1' in rs_ratios and 'V6' in rs_ratios:
        metrics.rs_progression_valid = rs_ratios['V6'] > rs_ratios['V1']

    return metrics


# =============================================================================
# HRV METRICS
# =============================================================================

@dataclass
class HRVMetrics:
    """Heart rate variability metrics."""
    rr_intervals: List[float] = field(default_factory=list)
    mean_rr_ms: float = 0.0
    sdnn_ms: float = 0.0
    rmssd_ms: float = 0.0
    pnn50: float = 0.0
    n_beats: int = 0
    hr_bpm: float = 0.0


def detect_r_peaks(ecg: ECGData, lead: str = 'II') -> np.ndarray:
    """
    Simple R-peak detection using threshold and distance constraints.

    Args:
        ecg: ECG data
        lead: Lead to use for detection (default: II)

    Returns:
        Array of R-peak sample indices
    """
    if lead not in ecg.leads_uV:
        return np.array([])

    data = ecg.get_lead_mv(lead)
    fs = ecg.fs

    # Bandpass filter 5-15 Hz to enhance QRS
    sos = signal.butter(2, [5, 15], btype='band', fs=fs, output='sos')
    filtered = signal.sosfilt(sos, data)

    # Square to emphasize peaks
    squared = filtered ** 2

    # Moving average
    window = int(0.15 * fs)  # 150ms window
    ma = np.convolve(squared, np.ones(window) / window, mode='same')

    # Dynamic threshold
    threshold = 0.3 * np.max(ma)

    # Find peaks with minimum distance (200ms = 300 bpm max)
    min_distance = int(0.2 * fs)
    peaks, _ = signal.find_peaks(ma, height=threshold, distance=min_distance)

    return peaks


def compute_hrv_metrics(ecg: ECGData) -> HRVMetrics:
    """
    Compute HRV metrics from ECG.

    Detects R-peaks and computes:
    - Mean RR interval
    - SDNN (standard deviation of NN intervals)
    - RMSSD (root mean square of successive differences)
    - pNN50 (percentage of successive intervals differing by >50ms)
    """
    metrics = HRVMetrics()

    # Detect R-peaks
    r_peaks = detect_r_peaks(ecg)

    if len(r_peaks) < 3:
        return metrics

    metrics.n_beats = len(r_peaks)

    # Compute RR intervals in ms
    rr_samples = np.diff(r_peaks)
    rr_ms = rr_samples * 1000 / ecg.fs
    metrics.rr_intervals = rr_ms.tolist()

    # Basic stats
    metrics.mean_rr_ms = float(np.mean(rr_ms))
    metrics.sdnn_ms = float(np.std(rr_ms))
    metrics.hr_bpm = 60000 / metrics.mean_rr_ms if metrics.mean_rr_ms > 0 else 0

    # RMSSD
    rr_diff = np.diff(rr_ms)
    metrics.rmssd_ms = float(np.sqrt(np.mean(rr_diff ** 2)))

    # pNN50
    nn50 = np.sum(np.abs(rr_diff) > 50)
    metrics.pnn50 = float(100 * nn50 / len(rr_diff)) if len(rr_diff) > 0 else 0

    return metrics


# =============================================================================
# NOISE METRICS
# =============================================================================

@dataclass
class NoiseMetrics:
    """Noise and artifact metrics."""
    baseline_wander_uV: float = 0.0
    hf_noise_uV: float = 0.0
    powerline_present: bool = False
    powerline_amplitude_uV: float = 0.0
    snr_db: float = 0.0


def compute_noise_metrics(ecg: ECGData) -> NoiseMetrics:
    """
    Compute noise and artifact metrics.

    Analyzes:
    - Baseline wander (low frequency content)
    - High-frequency noise
    - Powerline interference (50/60 Hz)
    - Signal-to-noise ratio estimate
    """
    metrics = NoiseMetrics()

    if 'II' not in ecg.leads_uV:
        return metrics

    data = ecg.leads_uV['II'].astype(np.float64)
    fs = ecg.fs

    # Baseline wander: energy below 0.5 Hz
    sos_lp = signal.butter(2, 0.5, btype='low', fs=fs, output='sos')
    baseline = signal.sosfilt(sos_lp, data)
    metrics.baseline_wander_uV = float(np.std(baseline))

    # HF noise: energy above 100 Hz
    if fs > 200:
        sos_hp = signal.butter(2, 100, btype='high', fs=fs, output='sos')
        hf = signal.sosfilt(sos_hp, data)
        metrics.hf_noise_uV = float(np.std(hf))

    # Powerline detection (60 Hz)
    freqs, psd = signal.welch(data, fs=fs, nperseg=min(len(data), 4096))
    idx_60 = np.argmin(np.abs(freqs - 60))
    idx_neighbors = [idx_60 - 2, idx_60 + 2]
    if all(0 <= i < len(psd) for i in idx_neighbors):
        neighbor_power = (psd[idx_neighbors[0]] + psd[idx_neighbors[1]]) / 2
        if psd[idx_60] > 3 * neighbor_power:
            metrics.powerline_present = True
            metrics.powerline_amplitude_uV = float(np.sqrt(psd[idx_60]))

    # SNR estimate (signal power / noise power)
    signal_power = np.var(data)
    noise_power = metrics.baseline_wander_uV ** 2 + metrics.hf_noise_uV ** 2
    if noise_power > 0:
        metrics.snr_db = float(10 * np.log10(signal_power / noise_power))

    return metrics


# =============================================================================
# SPECTRAL SIMILARITY METRICS
# =============================================================================

@dataclass
class SpectralMetrics:
    """Spectral analysis metrics for realism validation.

    Real ECGs have characteristic frequency distributions:
    - QRS complex energy: 3-40 Hz
    - P/T wave energy: 0.5-10 Hz
    - HF rolloff above ~40 Hz
    - Spectral entropy indicates complexity
    """
    # Band power distribution
    vlf_power_pct: float = 0.0   # 0.003-0.04 Hz (very low freq)
    lf_power_pct: float = 0.0    # 0.04-0.15 Hz (low freq - sympathetic)
    hf_power_pct: float = 0.0    # 0.15-0.4 Hz (high freq - parasympathetic)
    qrs_band_power_pct: float = 0.0  # 5-40 Hz (QRS content)
    hf_rolloff_slope: float = 0.0  # Slope of power above 40 Hz

    # Spectral shape metrics
    spectral_entropy: float = 0.0  # Normalized entropy (0-1)
    spectral_centroid_hz: float = 0.0  # Center of mass of spectrum
    spectral_bandwidth_hz: float = 0.0  # Spread of spectrum

    # Realism flags
    has_realistic_qrs_peak: bool = True  # Peak in 5-40 Hz range
    has_realistic_rolloff: bool = True   # HF content decreases appropriately
    is_too_smooth: bool = False  # Synthetic signals often too smooth (low HF)
    is_too_noisy: bool = False   # Or have wrong noise characteristics


def compute_spectral_metrics(ecg: ECGData) -> SpectralMetrics:
    """
    Compute spectral metrics for realism validation.

    Compares frequency content against expected patterns for real ECGs.
    """
    metrics = SpectralMetrics()

    # Use lead II (most commonly analyzed)
    if 'II' not in ecg.leads_uV:
        return metrics

    data = ecg.leads_uV['II'].astype(np.float64)
    fs = ecg.fs
    n = len(data)

    # Compute power spectral density using Welch's method
    nperseg = min(n, 4 * fs)  # 4-second windows
    freqs, psd = signal.welch(data, fs=fs, nperseg=nperseg, noverlap=nperseg // 2)

    if len(psd) == 0:
        return metrics

    # Total power for normalization
    total_power = np.sum(psd)
    if total_power == 0:
        return metrics

    # Band power distribution (as percentage of total)
    def band_power(f_low, f_high):
        mask = (freqs >= f_low) & (freqs < f_high)
        return np.sum(psd[mask]) / total_power * 100

    metrics.vlf_power_pct = band_power(0.003, 0.04)
    metrics.lf_power_pct = band_power(0.04, 0.15)
    metrics.hf_power_pct = band_power(0.15, 0.4)
    metrics.qrs_band_power_pct = band_power(5, 40)

    # High-frequency rolloff slope (log-log regression above 40 Hz)
    hf_mask = (freqs >= 40) & (freqs <= min(fs / 2.5, 150))
    if np.sum(hf_mask) >= 5:
        hf_freqs = np.log10(freqs[hf_mask])
        hf_psd = np.log10(psd[hf_mask] + 1e-20)
        if len(hf_freqs) > 1:
            slope, _ = np.polyfit(hf_freqs, hf_psd, 1)
            metrics.hf_rolloff_slope = float(slope)

    # Spectral entropy (normalized Shannon entropy)
    psd_norm = psd / total_power
    psd_norm = psd_norm[psd_norm > 0]  # Remove zeros for log
    if len(psd_norm) > 0:
        entropy = -np.sum(psd_norm * np.log2(psd_norm))
        max_entropy = np.log2(len(psd_norm))
        metrics.spectral_entropy = float(entropy / max_entropy) if max_entropy > 0 else 0

    # Spectral centroid and bandwidth
    metrics.spectral_centroid_hz = float(np.sum(freqs * psd) / total_power)
    metrics.spectral_bandwidth_hz = float(np.sqrt(np.sum(((freqs - metrics.spectral_centroid_hz) ** 2) * psd) / total_power))

    # Realism checks

    # 1. QRS band should have significant power (typically 30-70% of ECG energy)
    metrics.has_realistic_qrs_peak = bool(15 < metrics.qrs_band_power_pct < 85)

    # 2. HF rolloff should be negative (power decreases with frequency)
    # Real ECGs typically have slope between -2 and -6 in log-log space
    metrics.has_realistic_rolloff = bool(-8 < metrics.hf_rolloff_slope < -1)

    # 3. Check for "too smooth" signal (insufficient HF content)
    # Real ECGs have some natural HF variation
    hf_content = band_power(50, min(fs / 2.5, 150))
    metrics.is_too_smooth = bool(hf_content < 0.5 and metrics.spectral_entropy < 0.5)

    # 4. Check for "too noisy" signal (excessive HF content)
    metrics.is_too_noisy = bool(hf_content > 20 or metrics.spectral_entropy > 0.95)

    return metrics


# =============================================================================
# AGGREGATE METRICS
# =============================================================================

@dataclass
class ECGMetrics:
    """Aggregate container for all ECG metrics."""
    physics: PhysicsMetrics = field(default_factory=PhysicsMetrics)
    distribution: DistributionMetrics = field(default_factory=DistributionMetrics)
    morphology: MorphologyMetrics = field(default_factory=MorphologyMetrics)
    hrv: HRVMetrics = field(default_factory=HRVMetrics)
    noise: NoiseMetrics = field(default_factory=NoiseMetrics)
    spectral: SpectralMetrics = field(default_factory=SpectralMetrics)


def compute_all_metrics(ecg: ECGData) -> ECGMetrics:
    """Compute all metrics for an ECG."""
    return ECGMetrics(
        physics=compute_physics_metrics(ecg),
        distribution=compute_distribution_metrics(ecg),
        morphology=compute_morphology_metrics(ecg),
        hrv=compute_hrv_metrics(ecg),
        noise=compute_noise_metrics(ecg),
        spectral=compute_spectral_metrics(ecg),
    )
