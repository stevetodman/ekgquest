# Template-Based Morphology: Implementation Plan

## Current State

The synthesizer uses **parametric Gaussian pulses** to generate P, QRS, and T waves:

```javascript
// Current approach (ecg-synth-modules.js)
function addPWave(signal, fs, tStart, duration, amplitude) {
  // Gaussian-modulated sinusoid
  const sigma = duration / 4;
  for (let i = 0; i < n; i++) {
    signal[i] += amplitude * Math.exp(-((t - center) ** 2) / (2 * sigma ** 2));
  }
}
```

### Problems with Parametric Approach
1. **Too smooth**: Real QRS has micro-notches, fragmentation
2. **Predictable**: Same formula = same "synthetic feel"
3. **Limited variation**: Can't capture real morphological diversity
4. **Expert detection**: Cardiologists instantly spot synthetic signals

## Proposed Solution: Template Library

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Template Morphology Engine                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Template   │    │   Template   │    │   Output     │      │
│  │   Library    │───►│   Selection  │───►│   Synthesis  │      │
│  │   (JSON)     │    │   + Warping  │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ P templates  │    │ Time warping │    │ Lead         │      │
│  │ QRS templates│    │ Amplitude    │    │ Projection   │      │
│  │ T templates  │    │ scaling      │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Template Library Structure

```javascript
// templates/ecg-templates.json
{
  "version": "1.0",
  "source": "PTB-XL + PhysioNet (CC-BY licensed)",

  "qrs_templates": {
    "normal": [
      {
        "id": "qrs_normal_01",
        "duration_ms": 80,
        "fs": 500,
        "samples": [-5, -10, 15, 85, 100, 90, -20, -15, -5, 0, ...],  // ~40 samples at 500Hz
        "metadata": {"source": "ptbxl_00001", "lead": "II"}
      },
      // ... 20-50 normal QRS templates
    ],
    "rbbb": [
      // RSR' patterns with notched S
    ],
    "lbbb": [
      // Broad, notched R patterns
    ],
    "lvh": [
      // High amplitude patterns
    ]
  },

  "p_templates": {
    "normal": [...],
    "peaked": [...],  // P pulmonale
    "bifid": [...]    // P mitrale
  },

  "t_templates": {
    "normal": [...],
    "inverted": [...],
    "hyperacute": [...],
    "biphasic": [...]
  }
}
```

### Template Selection Algorithm

```javascript
function selectTemplate(category, diagnosis, age, rng) {
  const templates = TEMPLATE_LIBRARY[category][getDxTemplateGroup(diagnosis)];

  // Weighted random selection (avoid repetition)
  const weights = templates.map((t, i) => {
    let w = 1.0;
    if (recentlyUsed.has(t.id)) w *= 0.3;  // Penalize recent use
    if (age < 1 && t.metadata.pediatric) w *= 2.0;  // Prefer pediatric
    return w;
  });

  return weightedRandomChoice(templates, weights, rng);
}
```

### Time Warping for Variation

```javascript
function warpTemplate(template, targetDurationMs, fs, rng) {
  const sourceDuration = template.duration_ms;
  const ratio = targetDurationMs / sourceDuration;

  // Non-linear warping for natural variation
  const jitter = 0.05 * randn(rng);  // ±5% random variation
  const warpedRatio = ratio * (1 + jitter);

  // Resample with cubic interpolation
  return resampleCubic(template.samples, warpedRatio, fs);
}
```

### Amplitude Scaling

```javascript
function scaleTemplate(samples, targetAmplitudeMV, baseAmplitudeMV, age, rng) {
  const ratio = targetAmplitudeMV / baseAmplitudeMV;

  // Age-dependent amplitude variation
  const ageVar = age < 1 ? 1.2 : (age < 5 ? 1.1 : 1.0);

  // Beat-to-beat variation
  const beatVar = 1.0 + 0.05 * randn(rng);

  return samples.map(s => s * ratio * ageVar * beatVar);
}
```

## Migration Strategy (Non-Breaking)

### Phase 1: Add Template Infrastructure
1. Create `viewer/js/ecg-templates.js` with template loading
2. Add `templates/` directory with JSON files
3. Keep existing parametric code untouched

### Phase 2: Feature Flag
```javascript
// ecg-synth-modules.js
const USE_TEMPLATES = false;  // Feature flag

function generateQRS(params, rng) {
  if (USE_TEMPLATES && TEMPLATE_LIBRARY.loaded) {
    return templateBasedQRS(params, rng);
  }
  return parametricQRS(params, rng);  // Existing code
}
```

### Phase 3: A/B Testing
- Generate with both methods
- Compare spectral metrics
- Compare expert blind reviews
- Switch default when templates win

### Phase 4: Deprecate Parametric
- Remove feature flag
- Keep parametric as fallback for edge cases

## Template Extraction Process

### From PTB-XL (21,837 recordings)

```python
# tools/extract_templates.py
import wfdb
import numpy as np
from scipy.signal import find_peaks

def extract_qrs_templates(record_path, n_templates=50):
    """Extract QRS templates from a PTB-XL record."""
    record = wfdb.rdrecord(record_path)
    signal = record.p_signal[:, 1]  # Lead II
    fs = record.fs

    # Find R peaks
    peaks, _ = find_peaks(signal, distance=fs*0.5, height=0.3)

    templates = []
    for peak in peaks[:n_templates]:
        # Extract 200ms window centered on R
        start = peak - int(0.1 * fs)
        end = peak + int(0.1 * fs)
        if start >= 0 and end < len(signal):
            template = signal[start:end]
            templates.append({
                'samples': template.tolist(),
                'duration_ms': 200,
                'fs': fs,
                'r_offset': int(0.1 * fs)
            })

    return templates
```

### Quality Filtering

```python
def filter_templates(templates):
    """Keep only high-quality templates."""
    filtered = []
    for t in templates:
        samples = np.array(t['samples'])

        # Reject noisy templates
        if np.std(samples[:10]) > 0.1:  # High baseline noise
            continue

        # Reject clipped templates
        if np.max(np.abs(samples)) > 4.0:  # > 4mV likely clipped
            continue

        # Reject flat templates
        if np.max(samples) - np.min(samples) < 0.3:
            continue

        filtered.append(t)

    return filtered
```

## Testing Strategy

### Unit Tests
```javascript
// test/templates.test.js
test('Template loading', () => {
  const lib = loadTemplateLibrary();
  assert(lib.qrs_templates.normal.length >= 20);
});

test('Template warping preserves shape', () => {
  const orig = getTemplate('qrs_normal_01');
  const warped = warpTemplate(orig, 100, 1000);

  // Cross-correlation should be high
  const corr = crossCorrelation(orig.samples, warped);
  assert(corr > 0.9);
});
```

### Validation Against Metrics
```python
# Spectral metrics should improve
def test_template_spectral_realism():
    parametric_ecg = generate_parametric(age=8, dx="Normal")
    template_ecg = generate_template(age=8, dx="Normal")

    param_spec = compute_spectral_metrics(parametric_ecg)
    templ_spec = compute_spectral_metrics(template_ecg)

    # Template should have more realistic HF content
    assert templ_spec.is_too_smooth == False
    assert templ_spec.spectral_entropy > param_spec.spectral_entropy
```

## Timeline

| Phase | Effort | Risk |
|-------|--------|------|
| Template extraction scripts | 2-3 hours | Low |
| Template library JSON | 1-2 hours | Low |
| JS template loading | 2-3 hours | Low |
| Feature-flagged integration | 3-4 hours | Medium |
| A/B comparison testing | 2-3 hours | Low |
| Switch default to templates | 1 hour | Low |

**Total: ~12-16 hours**

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Template licensing issues | Use only CC-BY licensed data (PTB-XL) |
| Large file size | Compress templates, lazy-load by diagnosis |
| Edge case failures | Keep parametric as fallback |
| Reduced variation | Extract 50+ templates per category |
| Performance regression | Template selection is O(n), not O(samples) |

## Success Criteria

1. **Spectral metrics**: `is_too_smooth` flag becomes False for >95% of cases
2. **Expert review**: Blinded cardiologist can't distinguish at >70% accuracy
3. **No regressions**: All existing tests continue to pass
4. **Performance**: <10% increase in generation time
