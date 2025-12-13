# Realism Lab: Validation Methodology

This document describes the Python-based validation pipeline that ensures synthetic ECGs are physiologically plausible and match published reference data.

## Philosophy: External vs Circular Validation

**Critical distinction**:
- **Circular validation**: Comparing synthetic ECGs against the same priors used to generate them (self-fulfilling)
- **External validation**: Comparing against independent published data (Rijnbeek 2001, PTB-XL)

The Realism Lab uses **external validation** to avoid circular reasoning. Generated ECGs are compared against Rijnbeek et al. 2001 (pediatric) and PTB-XL (adult) reference data that was not used in the synthesis engine's priors.

## Quality Gates

The evaluation pipeline runs 5 sequential gates:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gate A: Physics Consistency                   │
│  Einthoven's law: II = I + III (error < 10 µV)                  │
│  No signal clipping, all 12 leads present                       │
└─────────────────────────────────────────────────────────────────┘
                              │ PASS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gate B: Distribution                          │
│  All interval z-scores within ±3 SD of age-matched priors       │
│  HR, PR, QRS, QTc, axis checked against internal priors         │
└─────────────────────────────────────────────────────────────────┘
                              │ PASS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gate C: HRV Realism                          │
│  Minimum 5 detected beats                                        │
│  SDNN 5-200 ms (not metronomic, not chaotic)                    │
└─────────────────────────────────────────────────────────────────┘
                              │ PASS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Gate D: Spectral Realism                      │
│  QRS band (8-15 Hz) has realistic power peak                    │
│  Not too smooth (algorithmic), not too noisy                    │
│  Realistic high-frequency rolloff                                │
└─────────────────────────────────────────────────────────────────┘
                              │ PASS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Gate E: External Reference (NEW)                 │
│  Pediatric: ≥60% params within Rijnbeek 2001 2nd-98th %ile      │
│  Adult: Z-scores within PTB-XL reference distributions          │
└─────────────────────────────────────────────────────────────────┘
```

## Running the Evaluation

### Command Line

```bash
cd python

# Generate test cases first
node ../tools/generate_synth_cases.mjs \
  --config configs/eval_matrix.json \
  --out outputs/cases

# Run evaluation
python -m realism_lab.eval_realism \
  --cases-dir outputs/cases \
  --config configs/eval_matrix.json \
  --output outputs/realism_report.json \
  --verbose
```

### Programmatic

```python
from realism_lab import run_evaluation, EvaluationResult

result = run_evaluation(
    cases_dir="outputs/cases",
    config={"thresholds": {"max_z_score": 3.0}}
)

print(f"Pass rate: {result.pass_rate:.1f}%")
for gate in result.gates:
    print(f"  {gate.name}: {gate.pass_rate:.1f}%")
```

## Metrics Reference

### Physics Metrics

```python
from realism_lab import compute_physics_metrics

metrics = compute_physics_metrics(ecg)
print(metrics.einthoven_max_error_uV)  # Should be < 10
print(metrics.has_clipping)             # Should be False
print(metrics.all_leads_present)        # Should be True
```

| Metric | Description | Pass Criteria |
|--------|-------------|---------------|
| `einthoven_max_error_uV` | Max violation of II = I + III | < 10 µV |
| `has_clipping` | Signal hits ±5000 µV rail | False |
| `clipping_samples` | Number of clipped samples | 0 |
| `all_leads_present` | All 12 standard leads exist | True |
| `missing_leads` | List of missing lead names | Empty |

### Distribution Metrics

```python
from realism_lab import compute_distribution_metrics

metrics = compute_distribution_metrics(ecg)
print(f"Age bin: {metrics.age_bin}")
print(f"HR z-score: {metrics.hr_z_score:.2f}")
print(f"All within 2SD: {metrics.all_within_2sd}")
```

| Metric | Description | Pass Criteria |
|--------|-------------|---------------|
| `age_bin` | Assigned age category | Valid bin ID |
| `hr_z_score` | HR deviation from age mean | \|z\| < 3 |
| `pr_z_score` | PR interval z-score | \|z\| < 3 |
| `qrs_z_score` | QRS duration z-score | \|z\| < 3 |
| `qtc_z_score` | QTc z-score | \|z\| < 3 |
| `axis_z_score` | QRS axis z-score | \|z\| < 3 |
| `all_within_2sd` | All params within 2 SD | True preferred |

### HRV Metrics

```python
from realism_lab import compute_hrv_metrics

metrics = compute_hrv_metrics(ecg)
print(f"Detected {metrics.n_beats} beats")
print(f"SDNN: {metrics.sdnn_ms:.1f} ms")
```

| Metric | Description | Normal Range |
|--------|-------------|--------------|
| `n_beats` | Number of detected R peaks | ≥ 5 |
| `mean_rr_ms` | Mean RR interval | 300-1500 ms |
| `sdnn_ms` | Standard deviation of RR | 5-200 ms |
| `rmssd_ms` | Root mean square of successive differences | 5-150 ms |
| `hr_bpm` | Computed heart rate | 30-250 bpm |

### Spectral Metrics

```python
from realism_lab import compute_spectral_metrics, SpectralMetrics

metrics = compute_spectral_metrics(ecg)
print(f"QRS band power: {metrics.qrs_band_power_pct:.1f}%")
print(f"Spectral entropy: {metrics.spectral_entropy:.2f}")
print(f"Is too smooth: {metrics.is_too_smooth}")
```

| Metric | Description | Interpretation |
|--------|-------------|----------------|
| `vlf_power_pct` | Power < 5 Hz | Baseline, P/T waves |
| `lf_power_pct` | Power 5-8 Hz | Low QRS content |
| `qrs_band_power_pct` | Power 8-15 Hz | QRS content (expect 25-80%) |
| `hf_power_pct` | Power 15-40 Hz | High-frequency content |
| `spectral_entropy` | Entropy of PSD (0-1) | 0.4-0.95 typical |
| `spectral_centroid_hz` | Center of mass of spectrum | 5-20 Hz typical |
| `hf_rolloff_slope` | dB/octave above 20 Hz | -1 to -6 typical |
| `has_realistic_qrs_peak` | QRS band has peak | True expected |
| `has_realistic_rolloff` | HF rolls off properly | True expected |
| `is_too_smooth` | Lacks high-frequency content | False expected |
| `is_too_noisy` | Excessive HF content | False expected |

## External Reference Data

### Rijnbeek 2001 (Pediatric)

Source: "New normal limits for the paediatric electrocardiogram" (Eur Heart J 22:702-711)

**Dataset**: 1912 Dutch children, ages 0-16 years

```python
from realism_lab import RIJNBEEK_REFERENCE, validate_ecg_against_rijnbeek

# Get reference for 8-year-old
from realism_lab.pediatric_reference import get_reference_value
ref = get_reference_value(8.0, "heart_rate", "boys")
# {'p2': 55, 'p50': 78, 'p98': 101}

# Validate full ECG
result = validate_ecg_against_rijnbeek(
    age_years=8.0,
    hr_bpm=78,
    pr_ms=134,
    qrs_ms=85,
    qtc_ms=411,
    axis_deg=70,
    sex="boys"
)
print(f"Pass rate: {result.pass_rate:.1f}%")  # 100% if all within 2-98 %ile
```

**Age bins in Rijnbeek**:

| Bin | Age Range | HR (p50) | PR (p50) | QRS (p50) | QTc (p50) |
|-----|-----------|----------|----------|-----------|-----------|
| 0-1m | 0-1 month | 160 | 99 | 67 | 413 |
| 1-3m | 1-3 months | 152 | 98 | 64 | 419 |
| 3-6m | 3-6 months | 134 | 106 | 66 | 422 |
| 6-12m | 6-12 months | 128 | 114 | 69 | 411 |
| 1-3y | 1-3 years | 119 | 118 | 71 | 412 |
| 3-5y | 3-5 years | 98 | 121 | 75 | 412 |
| 5-8y | 5-8 years | 88 | 129 | 80 | 411 |
| 8-12y | 8-12 years | 78 | 134 | 85 | 411 |
| 12-16y | 12-16 years | 73 | 139 | 91 | 407 |

### PTB-XL (Adult)

Source: Wagner et al. 2020 (Scientific Data 7:154)

**Dataset**: 21,837 recordings from adults

```python
from realism_lab import PTBXL_REFERENCE, compare_to_ptbxl
import numpy as np

# Compare synthetic HR distribution against PTB-XL normal
synthetic_hrs = np.array([72, 78, 65, 80, 75])
result = compare_to_ptbxl("heart_rate", synthetic_hrs, "normal")
print(f"Z-score from PTB-XL: {result.z_score_mean:.2f}")
```

**PTB-XL reference values**:

| Parameter | Normal | Sinus Brady | Sinus Tachy | RBBB | LBBB |
|-----------|--------|-------------|-------------|------|------|
| HR mean | 73.5 | 52.1 | 108.3 | - | - |
| HR SD | 14.2 | 6.8 | 12.5 | - | - |
| QRS mean | 92 | - | - | 138 | 152 |
| QRS SD | 12 | - | - | 16 | 18 |

## Pathological Exemptions

Some diagnoses intentionally violate normal ranges. Configure exemptions in `eval_matrix.json`:

```json
{
  "pathological_exemptions": {
    "Sinus tachycardia": {
      "exempt_params": ["HR"],
      "description": "HR expected above normal"
    },
    "Sinus bradycardia": {
      "exempt_params": ["HR"],
      "description": "HR expected below normal"
    },
    "RBBB": {
      "exempt_params": ["QRS"],
      "description": "QRS expected >120ms"
    },
    "LBBB": {
      "exempt_params": ["QRS"],
      "description": "QRS expected >140ms"
    },
    "Long QT": {
      "exempt_params": ["QTc"],
      "description": "QTc expected >460ms"
    },
    "1st degree AVB": {
      "exempt_params": ["PR"],
      "description": "PR expected >200ms"
    },
    "WPW": {
      "exempt_params": ["PR", "QRS"],
      "description": "Short PR, wide QRS with delta wave"
    },
    "SVT (narrow)": {
      "exempt_params": ["HR"],
      "min_sdnn_ms": 2.0,
      "description": "Very fast, regular rhythm"
    }
  }
}
```

## CI Integration

The evaluation runs automatically on every push:

```yaml
# .github/workflows/ci.yml
realism-lab:
  steps:
    - name: Generate golden seed cases
      run: node tools/generate_synth_cases.mjs --golden

    - name: Run realism evaluation
      run: python -m realism_lab.eval_realism --cases-dir outputs/cases

    - name: Upload realism report
      uses: actions/upload-artifact@v4
      with:
        name: realism-report
        path: python/outputs/realism_report.json
```

The job fails if overall pass rate < 90%.

## Report Format

```json
{
  "timestamp": "2025-01-15T10:30:00",
  "n_cases": 50,
  "n_passed": 48,
  "pass_rate": 96.0,
  "overall_passed": true,
  "gates": [
    {
      "name": "Physics Consistency",
      "passed": true,
      "pass_rate": 100.0,
      "n_cases": 50,
      "n_passed": 50
    },
    {
      "name": "External Reference (Rijnbeek/PTB-XL)",
      "passed": true,
      "pass_rate": 92.0,
      "n_cases": 50,
      "n_passed": 46
    }
  ],
  "summary": {
    "by_age_bin": {
      "neonate": {"n_cases": 5, "pass_rate": 100.0},
      "school_early": {"n_cases": 10, "pass_rate": 90.0}
    },
    "by_dx": {
      "Normal sinus": {"n_cases": 20, "pass_rate": 100.0},
      "WPW": {"n_cases": 5, "pass_rate": 80.0}
    }
  }
}
```

## Future Validation Sources

Potential datasets for expanded validation:

| Dataset | Source | Use Case |
|---------|--------|----------|
| ZZU pECG | Figshare | Large-scale pediatric validation |
| Leipzig Heart Center | PhysioNet | Congenital heart disease patterns |
| PICS Database | PhysioNet | Preterm infant ECG validation |
| Davignon 1979 | Literature | Historical neonatal reference |

These would require downloading and processing the actual waveforms rather than using published summary statistics.

## Debugging Tips

### ECG fails physics gate
```bash
# Check Einthoven compliance
python -c "
from realism_lab import load_ecg_json, compute_physics_metrics
ecg = load_ecg_json('problem_case.json')
m = compute_physics_metrics(ecg)
print(f'Einthoven error: {m.einthoven_max_error_uV} µV')
"
```

### ECG fails spectral gate
```bash
# Check spectral characteristics
python -c "
from realism_lab import load_ecg_json, compute_spectral_metrics
ecg = load_ecg_json('problem_case.json')
s = compute_spectral_metrics(ecg)
print(f'Too smooth: {s.is_too_smooth}')
print(f'Too noisy: {s.is_too_noisy}')
print(f'QRS peak: {s.has_realistic_qrs_peak}')
"
```

### ECG fails external reference
```bash
# Check against Rijnbeek
python -c "
from realism_lab.pediatric_reference import validate_ecg_against_rijnbeek
r = validate_ecg_against_rijnbeek(
    age_years=0.5,  # 6-month-old
    hr_bpm=90,      # Too slow for infant?
    pr_ms=140,
    qrs_ms=80,
    qtc_ms=420,
    axis_deg=70
)
for param, detail in r.details.items():
    print(f'{param}: {detail[\"interpretation\"]}')"
```
