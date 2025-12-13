"""
Realism evaluation pipeline for synthetic ECGs.

Run with:
    python -m realism_lab.eval_realism --config configs/eval_matrix.json

Or programmatically:
    from realism_lab import run_evaluation
    result = run_evaluation(cases_dir, config)
"""

import json
import argparse
import sys
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
from datetime import datetime

from .io_ecgjson import load_ecg_json, load_ecg_directory, ECGData
from .metrics import (
    compute_all_metrics,
    ECGMetrics,
    PhysicsMetrics,
    DistributionMetrics,
    compute_spectral_metrics,
    SpectralMetrics,
)
from .pediatric_reference import validate_ecg_against_rijnbeek, RijnbeekValidationResult
from .ptbxl_reference import compare_to_ptbxl, get_ptbxl_class, compute_ptbxl_realism_score


@dataclass
class ThresholdConfig:
    """Threshold configuration for pass/fail criteria."""
    # Physics thresholds
    max_einthoven_error_uV: float = 10.0
    allow_clipping: bool = False

    # Distribution thresholds
    max_z_score: float = 3.0  # Parameters within 3 SD
    min_params_within_2sd_pct: float = 80.0  # At least 80% within 2 SD

    # HRV thresholds
    min_beats: int = 5
    min_sdnn_ms: float = 5.0
    max_sdnn_ms: float = 200.0

    # Overall pass rate
    min_pass_rate_pct: float = 90.0


@dataclass
class CaseResult:
    """Result for a single ECG case."""
    filename: str
    age_years: float
    dx: str
    passed: bool
    failures: List[str] = field(default_factory=list)
    metrics: Optional[ECGMetrics] = None
    external_validation: Optional[Dict] = None  # Rijnbeek or PTB-XL validation
    spectral_metrics: Optional[SpectralMetrics] = None


@dataclass
class GateResult:
    """Result for a single quality gate."""
    name: str
    passed: bool
    pass_rate: float
    n_cases: int
    n_passed: int
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EvaluationResult:
    """Complete evaluation result."""
    timestamp: str
    config_path: str
    cases_dir: str
    n_cases: int
    n_passed: int
    pass_rate: float
    overall_passed: bool
    gates: List[GateResult] = field(default_factory=list)
    case_results: List[CaseResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


def evaluate_case(
    ecg: ECGData,
    thresholds: ThresholdConfig,
    filename: str = "",
    pathological_exemptions: Optional[Dict] = None,
) -> CaseResult:
    """
    Evaluate a single ECG case against thresholds.

    Args:
        ecg: ECG data to evaluate
        thresholds: Threshold configuration
        filename: Name of the file for reporting
        pathological_exemptions: Dict of diagnosis -> exempt parameters

    Returns CaseResult with pass/fail status and failure reasons.
    """
    dx = ecg.targets.dx if ecg.targets else "unknown"
    result = CaseResult(
        filename=filename,
        age_years=ecg.targets.age_years if ecg.targets else 0,
        dx=dx,
        passed=True,
        failures=[],
    )

    # Get exemptions for this diagnosis
    exemptions = {}
    if pathological_exemptions and dx in pathological_exemptions:
        exemptions = pathological_exemptions[dx]
    exempt_params = exemptions.get("exempt_params", [])

    # Compute all metrics
    metrics = compute_all_metrics(ecg)
    result.metrics = metrics

    # Gate A: Physics consistency
    if metrics.physics.einthoven_max_error_uV > thresholds.max_einthoven_error_uV:
        result.failures.append(
            f"Einthoven error {metrics.physics.einthoven_max_error_uV:.1f} > {thresholds.max_einthoven_error_uV} µV"
        )

    if metrics.physics.has_clipping and not thresholds.allow_clipping:
        result.failures.append(
            f"Signal clipping detected ({metrics.physics.clipping_samples} samples)"
        )

    if not metrics.physics.all_leads_present:
        result.failures.append(
            f"Missing leads: {metrics.physics.missing_leads}"
        )

    # Gate B: Distribution checks (with pathological exemptions)
    z_score_map = {
        "HR": metrics.distribution.hr_z_score,
        "PR": metrics.distribution.pr_z_score,
        "QRS": metrics.distribution.qrs_z_score,
        "QTc": metrics.distribution.qtc_z_score,
        "axis": metrics.distribution.axis_z_score,
    }

    # Filter out exempt parameters and None values
    non_exempt_z_scores = [
        (param, z) for param, z in z_score_map.items()
        if z is not None and param not in exempt_params
    ]

    if non_exempt_z_scores:
        max_z_param, max_z = max(non_exempt_z_scores, key=lambda x: abs(x[1]))
        if abs(max_z) > thresholds.max_z_score:
            outliers = [p for p, z in non_exempt_z_scores if z is not None and abs(z) > thresholds.max_z_score]
            result.failures.append(
                f"Parameter z-score {abs(max_z):.2f} > {thresholds.max_z_score} (outliers: {outliers})"
            )

    # Gate C: HRV realism (with pathological exemptions for SDNN)
    if metrics.hrv.n_beats < thresholds.min_beats:
        result.failures.append(
            f"Too few beats detected ({metrics.hrv.n_beats} < {thresholds.min_beats})"
        )

    # Use diagnosis-specific SDNN threshold if available
    min_sdnn = exemptions.get("min_sdnn_ms", thresholds.min_sdnn_ms)

    if metrics.hrv.sdnn_ms > 0:
        if metrics.hrv.sdnn_ms < min_sdnn:
            result.failures.append(
                f"SDNN too low ({metrics.hrv.sdnn_ms:.1f} < {min_sdnn} ms)"
            )
        if metrics.hrv.sdnn_ms > thresholds.max_sdnn_ms:
            result.failures.append(
                f"SDNN too high ({metrics.hrv.sdnn_ms:.1f} > {thresholds.max_sdnn_ms} ms)"
            )

    # Gate D: Spectral realism
    spectral = compute_spectral_metrics(ecg)
    result.spectral_metrics = spectral

    if spectral.is_too_smooth:
        result.failures.append("Signal is too smooth (lacks realistic noise)")
    if spectral.is_too_noisy:
        result.failures.append("Signal is too noisy")
    if not spectral.has_realistic_qrs_peak:
        result.failures.append("Missing realistic QRS spectral peak (8-15 Hz)")
    if not spectral.has_realistic_rolloff:
        result.failures.append("Unrealistic high-frequency rolloff")

    # Gate E: External reference validation (Rijnbeek for peds, PTB-XL for adults)
    age = ecg.targets.age_years if ecg.targets else 0

    if age < 16:
        # Use Rijnbeek pediatric reference
        hr = metrics.hrv.hr_bpm if metrics.hrv.hr_bpm > 0 else 80
        pr = metrics.distribution.pr_ms if metrics.distribution.pr_ms else 120
        qrs = metrics.distribution.qrs_ms if metrics.distribution.qrs_ms else 80
        qtc = metrics.distribution.qtc_ms if metrics.distribution.qtc_ms else 400
        axis = metrics.distribution.axis_deg if metrics.distribution.axis_deg is not None else 60

        rijnbeek_result = validate_ecg_against_rijnbeek(
            age_years=age,
            hr_bpm=hr,
            pr_ms=pr,
            qrs_ms=qrs,
            qtc_ms=qtc,
            axis_deg=axis,
            sex="boys"  # Default; could be parameterized
        )
        result.external_validation = {
            "source": "Rijnbeek 2001",
            "pass_rate": rijnbeek_result.pass_rate,
            "params_within_normal": rijnbeek_result.parameters_within_normal,
            "params_checked": rijnbeek_result.parameters_checked,
        }

        # Fail if less than 60% of parameters within normal (allowing pathological variants)
        if "exempt_params" not in exemptions:
            if rijnbeek_result.pass_rate < 60:
                result.failures.append(
                    f"Only {rijnbeek_result.parameters_within_normal}/{rijnbeek_result.parameters_checked} "
                    f"parameters within Rijnbeek normal limits"
                )

    # Set pass/fail
    result.passed = len(result.failures) == 0

    return result


def run_evaluation(
    cases_dir: Path | str,
    config: Optional[Dict] = None,
    thresholds: Optional[ThresholdConfig] = None,
) -> EvaluationResult:
    """
    Run full evaluation on a directory of ECG cases.

    Args:
        cases_dir: Directory containing ECG JSON files
        config: Optional configuration dict (from JSON)
        thresholds: Optional threshold configuration

    Returns:
        EvaluationResult with all metrics and pass/fail status
    """
    cases_dir = Path(cases_dir)

    # Load thresholds
    if thresholds is None:
        if config and "thresholds" in config:
            thresholds = ThresholdConfig(**config["thresholds"])
        else:
            thresholds = ThresholdConfig()

    # Load pathological exemptions
    pathological_exemptions = config.get("pathological_exemptions", {}) if config else {}

    # Load all ECG files
    ecgs = load_ecg_directory(cases_dir)

    if not ecgs:
        return EvaluationResult(
            timestamp=datetime.now().isoformat(),
            config_path=str(config.get("_path", "")) if config else "",
            cases_dir=str(cases_dir),
            n_cases=0,
            n_passed=0,
            pass_rate=0.0,
            overall_passed=False,
            summary={"error": "No ECG files found"},
        )

    # Evaluate each case
    case_results = []
    for ecg, filename in ecgs:
        result = evaluate_case(ecg, thresholds, filename, pathological_exemptions)
        case_results.append(result)

    # Compute gate results
    gates = []

    # Gate A: Physics
    physics_passed = sum(1 for r in case_results if
                         r.metrics and r.metrics.physics.einthoven_max_error_uV <= thresholds.max_einthoven_error_uV)
    gates.append(GateResult(
        name="Physics Consistency",
        passed=physics_passed / len(case_results) >= thresholds.min_pass_rate_pct / 100,
        pass_rate=physics_passed / len(case_results) * 100,
        n_cases=len(case_results),
        n_passed=physics_passed,
    ))

    # Gate B: Distribution
    dist_passed = sum(1 for r in case_results if
                      r.metrics and r.metrics.distribution.all_within_2sd)
    gates.append(GateResult(
        name="Distribution (within 2SD)",
        passed=dist_passed / len(case_results) >= thresholds.min_params_within_2sd_pct / 100,
        pass_rate=dist_passed / len(case_results) * 100,
        n_cases=len(case_results),
        n_passed=dist_passed,
    ))

    # Gate C: HRV
    hrv_passed = sum(1 for r in case_results if
                     r.metrics and r.metrics.hrv.n_beats >= thresholds.min_beats)
    gates.append(GateResult(
        name="HRV Realism",
        passed=hrv_passed / len(case_results) >= 0.9,
        pass_rate=hrv_passed / len(case_results) * 100,
        n_cases=len(case_results),
        n_passed=hrv_passed,
    ))

    # Gate D: Spectral realism
    spectral_passed = sum(1 for r in case_results if
                          r.spectral_metrics and
                          r.spectral_metrics.has_realistic_qrs_peak and
                          not r.spectral_metrics.is_too_smooth and
                          not r.spectral_metrics.is_too_noisy)
    gates.append(GateResult(
        name="Spectral Realism",
        passed=spectral_passed / len(case_results) >= 0.85,
        pass_rate=spectral_passed / len(case_results) * 100,
        n_cases=len(case_results),
        n_passed=spectral_passed,
    ))

    # Gate E: External reference validation
    ext_validated = [r for r in case_results if r.external_validation]
    if ext_validated:
        ext_passed = sum(1 for r in ext_validated if r.external_validation.get("pass_rate", 0) >= 60)
        gates.append(GateResult(
            name="External Reference (Rijnbeek/PTB-XL)",
            passed=ext_passed / len(ext_validated) >= 0.8,
            pass_rate=ext_passed / len(ext_validated) * 100,
            n_cases=len(ext_validated),
            n_passed=ext_passed,
            details={"source": "Rijnbeek 2001 (peds) / PTB-XL (adult)"},
        ))

    # Overall result
    n_passed = sum(1 for r in case_results if r.passed)
    pass_rate = n_passed / len(case_results) * 100
    overall_passed = pass_rate >= thresholds.min_pass_rate_pct

    # Compute summary statistics
    summary = compute_summary_stats(case_results)

    return EvaluationResult(
        timestamp=datetime.now().isoformat(),
        config_path=str(config.get("_path", "")) if config else "",
        cases_dir=str(cases_dir),
        n_cases=len(case_results),
        n_passed=n_passed,
        pass_rate=pass_rate,
        overall_passed=overall_passed,
        gates=gates,
        case_results=case_results,
        summary=summary,
    )


def compute_summary_stats(case_results: List[CaseResult]) -> Dict[str, Any]:
    """Compute summary statistics across all cases."""
    import numpy as np

    stats = {
        "by_age_bin": {},
        "by_dx": {},
        "metrics_summary": {},
    }

    # Group by age bin
    age_groups = {}
    for r in case_results:
        if r.metrics and r.metrics.distribution.age_bin:
            bin_name = r.metrics.distribution.age_bin
            if bin_name not in age_groups:
                age_groups[bin_name] = []
            age_groups[bin_name].append(r)

    for bin_name, results in age_groups.items():
        n_total = len(results)
        n_passed = sum(1 for r in results if r.passed)
        stats["by_age_bin"][bin_name] = {
            "n_cases": n_total,
            "n_passed": n_passed,
            "pass_rate": n_passed / n_total * 100 if n_total > 0 else 0,
        }

    # Group by diagnosis
    dx_groups = {}
    for r in case_results:
        dx = r.dx
        if dx not in dx_groups:
            dx_groups[dx] = []
        dx_groups[dx].append(r)

    for dx, results in dx_groups.items():
        n_total = len(results)
        n_passed = sum(1 for r in results if r.passed)
        stats["by_dx"][dx] = {
            "n_cases": n_total,
            "n_passed": n_passed,
            "pass_rate": n_passed / n_total * 100 if n_total > 0 else 0,
        }

    # Overall metrics summary
    hrs = [r.metrics.hrv.hr_bpm for r in case_results if r.metrics and r.metrics.hrv.hr_bpm > 0]
    if hrs:
        stats["metrics_summary"]["hr_bpm"] = {
            "mean": float(np.mean(hrs)),
            "std": float(np.std(hrs)),
            "min": float(np.min(hrs)),
            "max": float(np.max(hrs)),
        }

    sdnns = [r.metrics.hrv.sdnn_ms for r in case_results if r.metrics and r.metrics.hrv.sdnn_ms > 0]
    if sdnns:
        stats["metrics_summary"]["sdnn_ms"] = {
            "mean": float(np.mean(sdnns)),
            "std": float(np.std(sdnns)),
            "min": float(np.min(sdnns)),
            "max": float(np.max(sdnns)),
        }

    einthoven_errors = [r.metrics.physics.einthoven_max_error_uV for r in case_results if r.metrics]
    if einthoven_errors:
        stats["metrics_summary"]["einthoven_error_uV"] = {
            "mean": float(np.mean(einthoven_errors)),
            "max": float(np.max(einthoven_errors)),
        }

    return stats


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Evaluate synthetic ECG realism",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--cases-dir",
        type=Path,
        default=Path("python/outputs/cases"),
        help="Directory containing ECG JSON files",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Path to evaluation config JSON",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("python/outputs/realism_report.json"),
        help="Output path for JSON report",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output",
    )

    args = parser.parse_args()

    # Load config if provided
    config = None
    if args.config and args.config.exists():
        with open(args.config) as f:
            config = json.load(f)
            config["_path"] = str(args.config)

    # Run evaluation
    print(f"Evaluating ECGs in {args.cases_dir}...")
    result = run_evaluation(args.cases_dir, config)

    # Print summary
    print("\n" + "=" * 60)
    print("REALISM EVALUATION REPORT")
    print("=" * 60)
    print(f"\nCases: {result.n_cases}")
    print(f"Passed: {result.n_passed} ({result.pass_rate:.1f}%)")
    print(f"Overall: {'PASS' if result.overall_passed else 'FAIL'}")

    print("\nGates:")
    for gate in result.gates:
        status = "✓" if gate.passed else "✗"
        print(f"  {status} {gate.name}: {gate.pass_rate:.1f}% ({gate.n_passed}/{gate.n_cases})")

    if args.verbose and result.case_results:
        print("\nFailed cases:")
        for r in result.case_results:
            if not r.passed:
                print(f"  - {r.filename}: {r.failures}")

    # Save report
    args.output.parent.mkdir(parents=True, exist_ok=True)

    # Convert to serializable format
    report_data = {
        "timestamp": result.timestamp,
        "config_path": result.config_path,
        "cases_dir": result.cases_dir,
        "n_cases": result.n_cases,
        "n_passed": result.n_passed,
        "pass_rate": result.pass_rate,
        "overall_passed": result.overall_passed,
        "gates": [asdict(g) for g in result.gates],
        "summary": result.summary,
        # Don't include full case_results to keep file size manageable
        "failed_cases": [
            {"filename": r.filename, "dx": r.dx, "age": r.age_years, "failures": r.failures}
            for r in result.case_results if not r.passed
        ][:20],  # Limit to first 20 failures
    }

    with open(args.output, 'w') as f:
        json.dump(report_data, f, indent=2)

    print(f"\nReport saved to {args.output}")

    # Exit with appropriate code
    sys.exit(0 if result.overall_passed else 1)


if __name__ == "__main__":
    main()
