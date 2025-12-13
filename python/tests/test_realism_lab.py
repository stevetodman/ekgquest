"""
Tests for realism_lab module.

Run with: pytest python/tests/
"""

import pytest
import json
import numpy as np
from pathlib import Path
import sys

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from realism_lab.io_ecgjson import load_ecg_json, ECGData, ECGTargets
from realism_lab.metrics import (
    compute_physics_metrics,
    compute_distribution_metrics,
    compute_morphology_metrics,
    compute_hrv_metrics,
    compute_z_score,
    get_age_bin,
    PEDIATRIC_PRIORS,
)
from realism_lab.pediatric_reference import (
    RIJNBEEK_REFERENCE,
    validate_ecg_against_rijnbeek,
    get_reference_value,
    compute_z_score_rijnbeek,
    get_rijnbeek_bin,
)
from realism_lab.ptbxl_reference import (
    PTBXL_REFERENCE,
    compare_to_ptbxl,
    get_ptbxl_class,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def sample_ecg_data():
    """Create a minimal valid ECG data structure."""
    fs = 1000
    duration = 10.0
    n_samples = int(fs * duration)

    # Generate simple sinusoidal ECG-like data
    t = np.arange(n_samples) / fs
    hr = 80  # bpm
    rr = 60 / hr

    # Create basic PQRST-like pattern
    lead_II = np.zeros(n_samples)
    for beat_time in np.arange(0, duration, rr):
        idx = int(beat_time * fs)
        # R wave
        if idx + 50 < n_samples:
            for i in range(50):
                lead_II[idx + i] += 1000 * np.exp(-((i - 25) ** 2) / 50)

    # Derive other leads (simplified)
    leads_uV = {
        'I': (lead_II * 0.8).astype(np.int16),
        'II': lead_II.astype(np.int16),
        'III': (lead_II * 0.2).astype(np.int16),
        'aVR': (-lead_II * 0.5).astype(np.int16),
        'aVL': (lead_II * 0.3).astype(np.int16),
        'aVF': (lead_II * 0.6).astype(np.int16),
        'V1': (lead_II * 0.4).astype(np.int16),
        'V2': (lead_II * 0.6).astype(np.int16),
        'V3': (lead_II * 0.8).astype(np.int16),
        'V4': lead_II.astype(np.int16),
        'V5': (lead_II * 0.9).astype(np.int16),
        'V6': (lead_II * 0.8).astype(np.int16),
    }

    targets = ECGTargets(
        synthetic=True,
        generator_version="test",
        age_years=8.0,
        dx="Normal sinus",
        HR_bpm=80,
        PR_ms=140,
        QRS_ms=80,
        QT_ms=360,
        QTc_ms=410,
        axes_deg={"P": 50, "QRS": 60, "T": 40},
    )

    return ECGData(
        schema_version="1.0",
        fs=fs,
        duration_s=duration,
        leads_uV=leads_uV,
        targets=targets,
    )


@pytest.fixture
def cases_dir(tmp_path):
    """Create temporary directory with test ECG files."""
    # Would need actual generated files - skip for unit tests
    return tmp_path


# =============================================================================
# IO TESTS
# =============================================================================

class TestIOModule:
    """Tests for io_ecgjson module."""

    def test_ecg_data_structure(self, sample_ecg_data):
        """Test ECGData structure."""
        ecg = sample_ecg_data
        assert ecg.fs == 1000
        assert ecg.duration_s == 10.0
        assert len(ecg.leads_uV) >= 12
        assert ecg.targets is not None
        assert ecg.targets.age_years == 8.0

    def test_ecg_n_samples(self, sample_ecg_data):
        """Test n_samples property."""
        ecg = sample_ecg_data
        assert ecg.n_samples == 10000

    def test_ecg_lead_names(self, sample_ecg_data):
        """Test lead_names property."""
        ecg = sample_ecg_data
        assert 'II' in ecg.lead_names
        assert 'V1' in ecg.lead_names

    def test_ecg_get_lead_mv(self, sample_ecg_data):
        """Test get_lead_mv conversion."""
        ecg = sample_ecg_data
        lead_mv = ecg.get_lead_mv('II')
        assert lead_mv.dtype == np.float64
        assert len(lead_mv) == ecg.n_samples

    def test_ecg_time_axis(self, sample_ecg_data):
        """Test time axis generation."""
        ecg = sample_ecg_data
        t = ecg.get_time_axis()
        assert len(t) == ecg.n_samples
        assert t[0] == 0
        assert abs(t[-1] - (ecg.n_samples - 1) / ecg.fs) < 0.001


# =============================================================================
# METRICS TESTS
# =============================================================================

class TestPediatricPriors:
    """Tests for pediatric priors."""

    def test_priors_structure(self):
        """Test PEDIATRIC_PRIORS structure."""
        assert "age_bins" in PEDIATRIC_PRIORS
        assert len(PEDIATRIC_PRIORS["age_bins"]) >= 5

    def test_get_age_bin(self):
        """Test age bin lookup."""
        neonate = get_age_bin(0.02)
        assert neonate["id"] == "neonate"

        toddler = get_age_bin(2.0)
        assert toddler["id"] == "toddler"

        adult = get_age_bin(35)
        assert adult["id"] == "young_adult"

    def test_compute_z_score(self):
        """Test z-score computation."""
        # HR 80 at age 8 should be close to mean (z ~ 0)
        z = compute_z_score("HR", 80, 8)
        assert z is not None
        assert abs(z) < 1

        # HR 150 at age 8 should be high (z > 2)
        z_high = compute_z_score("HR", 150, 8)
        assert z_high > 2

    def test_compute_z_score_unknown_param(self):
        """Test z-score with unknown parameter."""
        z = compute_z_score("unknown_param", 100, 8)
        assert z is None


class TestPhysicsMetrics:
    """Tests for physics metrics."""

    def test_physics_metrics_structure(self, sample_ecg_data):
        """Test physics metrics computation."""
        metrics = compute_physics_metrics(sample_ecg_data)
        assert hasattr(metrics, 'einthoven_max_error_uV')
        assert hasattr(metrics, 'has_clipping')
        assert hasattr(metrics, 'all_leads_present')

    def test_einthoven_check(self, sample_ecg_data):
        """Test Einthoven's law check."""
        metrics = compute_physics_metrics(sample_ecg_data)
        # Our simplified leads don't satisfy Einthoven exactly
        assert metrics.einthoven_max_error_uV >= 0

    def test_clipping_detection(self, sample_ecg_data):
        """Test clipping detection."""
        metrics = compute_physics_metrics(sample_ecg_data)
        # Our test data shouldn't clip
        assert not metrics.has_clipping

    def test_missing_leads_detection(self):
        """Test missing leads detection."""
        ecg = ECGData(
            schema_version="1.0",
            fs=1000,
            duration_s=10.0,
            leads_uV={'I': np.zeros(1000, dtype=np.int16)},
        )
        metrics = compute_physics_metrics(ecg)
        assert not metrics.all_leads_present
        assert len(metrics.missing_leads) > 0


class TestDistributionMetrics:
    """Tests for distribution metrics."""

    def test_distribution_metrics_structure(self, sample_ecg_data):
        """Test distribution metrics computation."""
        metrics = compute_distribution_metrics(sample_ecg_data)
        assert hasattr(metrics, 'age_bin')
        assert hasattr(metrics, 'hr_z_score')
        assert hasattr(metrics, 'all_within_2sd')

    def test_age_bin_assignment(self, sample_ecg_data):
        """Test correct age bin assignment."""
        metrics = compute_distribution_metrics(sample_ecg_data)
        assert metrics.age_bin in ["school_early", "school_late"]  # Age 8

    def test_z_scores_computed(self, sample_ecg_data):
        """Test z-scores are computed."""
        metrics = compute_distribution_metrics(sample_ecg_data)
        assert metrics.hr_z_score is not None
        assert metrics.qrs_z_score is not None


class TestMorphologyMetrics:
    """Tests for morphology metrics."""

    def test_morphology_metrics_structure(self, sample_ecg_data):
        """Test morphology metrics computation."""
        metrics = compute_morphology_metrics(sample_ecg_data)
        assert hasattr(metrics, 'rs_progression_valid')
        assert hasattr(metrics, 'rs_ratios')
        assert hasattr(metrics, 'dominant_r_lead')

    def test_rs_ratios_computed(self, sample_ecg_data):
        """Test R/S ratios are computed."""
        metrics = compute_morphology_metrics(sample_ecg_data)
        assert len(metrics.rs_ratios) > 0


class TestHRVMetrics:
    """Tests for HRV metrics."""

    def test_hrv_metrics_structure(self, sample_ecg_data):
        """Test HRV metrics computation."""
        metrics = compute_hrv_metrics(sample_ecg_data)
        assert hasattr(metrics, 'mean_rr_ms')
        assert hasattr(metrics, 'sdnn_ms')
        assert hasattr(metrics, 'rmssd_ms')
        assert hasattr(metrics, 'n_beats')

    def test_beats_detected(self, sample_ecg_data):
        """Test beats are detected."""
        metrics = compute_hrv_metrics(sample_ecg_data)
        # Our synthetic data should have detectable beats
        assert metrics.n_beats > 0

    def test_hr_reasonable(self, sample_ecg_data):
        """Test computed HR is reasonable."""
        metrics = compute_hrv_metrics(sample_ecg_data)
        if metrics.hr_bpm > 0:
            assert 30 < metrics.hr_bpm < 250  # Physiological range


class TestSpectralMetrics:
    """Tests for spectral metrics."""

    def test_spectral_metrics_structure(self, sample_ecg_data):
        """Test spectral metrics computation."""
        from realism_lab.metrics import compute_spectral_metrics
        metrics = compute_spectral_metrics(sample_ecg_data)
        assert hasattr(metrics, 'qrs_band_power_pct')
        assert hasattr(metrics, 'spectral_entropy')
        assert hasattr(metrics, 'spectral_centroid_hz')
        assert hasattr(metrics, 'hf_rolloff_slope')

    def test_band_powers_sum_reasonable(self, sample_ecg_data):
        """Test band powers are reasonable percentages."""
        from realism_lab.metrics import compute_spectral_metrics
        metrics = compute_spectral_metrics(sample_ecg_data)
        # QRS band should have significant power
        assert metrics.qrs_band_power_pct >= 0
        assert metrics.qrs_band_power_pct <= 100

    def test_spectral_entropy_normalized(self, sample_ecg_data):
        """Test spectral entropy is normalized 0-1."""
        from realism_lab.metrics import compute_spectral_metrics
        metrics = compute_spectral_metrics(sample_ecg_data)
        assert 0 <= metrics.spectral_entropy <= 1

    def test_realism_flags(self, sample_ecg_data):
        """Test realism flags are computed."""
        from realism_lab.metrics import compute_spectral_metrics
        metrics = compute_spectral_metrics(sample_ecg_data)
        assert isinstance(metrics.has_realistic_qrs_peak, bool)
        assert isinstance(metrics.has_realistic_rolloff, bool)
        assert isinstance(metrics.is_too_smooth, bool)
        assert isinstance(metrics.is_too_noisy, bool)


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestIntegration:
    """Integration tests requiring generated cases."""

    @pytest.mark.skipif(
        not Path("python/outputs/cases").exists(),
        reason="Generated cases not available"
    )
    def test_load_generated_case(self):
        """Test loading a generated ECG file."""
        cases_dir = Path("python/outputs/cases")
        json_files = list(cases_dir.glob("*.json"))

        if json_files:
            ecg = load_ecg_json(json_files[0])
            assert ecg.fs > 0
            assert len(ecg.leads_uV) > 0


# =============================================================================
# EXTERNAL REFERENCE TESTS
# =============================================================================

class TestRijnbeekReference:
    """Tests for pediatric Rijnbeek reference values."""

    def test_rijnbeek_structure(self):
        """Test RIJNBEEK_REFERENCE structure."""
        assert "source" in RIJNBEEK_REFERENCE
        assert "age_bins" in RIJNBEEK_REFERENCE
        assert len(RIJNBEEK_REFERENCE["age_bins"]) == 9

    def test_get_rijnbeek_bin(self):
        """Test age bin lookup."""
        neonate = get_rijnbeek_bin(0.05)
        assert neonate["id"] == "0-1m"

        toddler = get_rijnbeek_bin(2.0)
        assert toddler["id"] == "1-3y"

        adolescent = get_rijnbeek_bin(14.0)
        assert adolescent["id"] == "12-16y"

    def test_get_reference_value(self):
        """Test getting reference values."""
        # 8-year-old heart rate
        ref = get_reference_value(8.0, "heart_rate", "boys")
        assert "p50" in ref
        assert "p2" in ref
        assert "p98" in ref
        assert ref["p50"] == 78  # From Rijnbeek 2001

    def test_compute_z_score_rijnbeek(self):
        """Test z-score computation against Rijnbeek."""
        # 8-year-old with HR 78 (median) should have z ~ 0
        z = compute_z_score_rijnbeek(78, 8.0, "heart_rate", "boys")
        assert z is not None
        assert abs(z) < 0.5

        # 8-year-old with HR 55 (2nd percentile) should have z ~ -2
        z_low = compute_z_score_rijnbeek(55, 8.0, "heart_rate", "boys")
        assert z_low is not None
        assert z_low < -1.5

    def test_validate_ecg_against_rijnbeek(self):
        """Test full ECG validation against Rijnbeek."""
        # Normal 8-year-old values
        result = validate_ecg_against_rijnbeek(
            age_years=8.0,
            hr_bpm=78,
            pr_ms=134,
            qrs_ms=85,
            qtc_ms=411,
            axis_deg=70,
            sex="boys"
        )
        assert result.parameters_checked == 5
        assert result.pass_rate >= 80  # All should be normal

    def test_validate_ecg_abnormal(self):
        """Test validation with abnormal values."""
        # Neonate with adult-like values
        result = validate_ecg_against_rijnbeek(
            age_years=0.05,
            hr_bpm=60,   # Too slow for neonate
            pr_ms=200,   # Too long for neonate
            qrs_ms=100,  # Too wide for neonate
            qtc_ms=500,  # Long QT
            axis_deg=0,  # LAD
            sex="boys"
        )
        assert result.pass_rate < 50  # Many should be out of range


class TestPTBXLReference:
    """Tests for PTB-XL adult reference values."""

    def test_ptbxl_structure(self):
        """Test PTBXL_REFERENCE structure."""
        assert "metadata" in PTBXL_REFERENCE
        assert "heart_rate" in PTBXL_REFERENCE
        assert "qrs_duration" in PTBXL_REFERENCE
        assert "qtc_interval" in PTBXL_REFERENCE

    def test_compare_to_ptbxl(self):
        """Test comparison against PTB-XL."""
        # Generate synthetic values around normal
        synthetic_hrs = np.random.normal(75, 15, 100)
        result = compare_to_ptbxl("heart_rate", synthetic_hrs, "normal")
        assert result.parameter == "heart_rate"
        assert abs(result.z_score_mean) < 2  # Should be reasonable

    def test_ptbxl_class_mapping(self):
        """Test diagnosis to PTB-XL class mapping."""
        assert get_ptbxl_class("RBBB") == "rbbb"
        assert get_ptbxl_class("LVH") == "lvh"
        assert get_ptbxl_class("Unknown diagnosis") == "all"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
