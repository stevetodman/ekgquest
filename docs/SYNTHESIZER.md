# ECG Synthesizer Deep Dive

This document provides a comprehensive reference for the ECG synthesis engine, designed for both developers and LLMs working on the codebase.

## Overview

The synthesizer generates physiologically plausible 12-lead ECGs with:
- Age-appropriate intervals and morphology
- 19 supported diagnoses
- Beat-to-beat variation (not metronomic)
- Realistic noise and artifacts
- Physics-consistent lead relationships

## Architecture

```
generateSyntheticECG(age, dx, seed)
           │
           ▼
    ┌──────────────┐
    │ Parameter    │ ← PEDIATRIC_PRIORS (age-specific)
    │ Selection    │ ← PATHOLOGIES (diagnosis-specific)
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Population   │  generatePopulationSample()
    │ Sample       │  - HR, PR, QRS, QT from priors
    └──────┬───────┘  - Gaussian sampling with bounds
           │
           ▼
    ┌──────────────┐
    │ Morphology   │  morphologyModel()
    │ Generation   │  - Beat-by-beat PQRST generation
    └──────┬───────┘  - Diagnosis-specific modifications
           │
           ▼
    ┌──────────────┐
    │ Beat Jitter  │  generateBeatJitter()
    │ Application  │  - Respiratory modulation
    └──────┬───────┘  - Amplitude/timing variation
           │
           ▼
    ┌──────────────┐
    │ Lead         │  Lead projection with age-appropriate axis
    │ Projection   │  Einthoven enforcement
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Noise Model  │  noiseModel()
    │ Application  │  - Baseline wander
    └──────┬───────┘  - EMG, mains, motion artifacts
           │
           ▼
       ECG JSON
```

## Key Functions

### generateSyntheticECG(age, dx, seed, options)

**Location**: `viewer/js/ecg-synth.js`

Main entry point for ECG generation.

```javascript
const ecg = generateSyntheticECG(8, "Normal sinus", 12345, {
  fs: 1000,
  duration_s: 10.0,
  noise_level: 0.5
});
```

**Parameters**:
- `age` (number): Age in years (0-99)
- `dx` (string): Diagnosis name from PATHOLOGIES
- `seed` (number): Random seed for reproducibility
- `options.fs` (number): Sampling frequency (default: 1000 Hz)
- `options.duration_s` (number): Duration in seconds (default: 10.0)
- `options.noise_level` (number): Noise intensity 0-1 (default: 0.3)

**Returns**: ECG JSON object with schema version, leads_uV, targets, integrity.

### generatePopulationSample(age, dx, rng)

**Location**: `viewer/js/ecg-synth-modules.js`

Samples physiological parameters from age-appropriate distributions.

```javascript
const sample = generatePopulationSample(8, "Normal sinus", rng);
// Returns:
// {
//   HR_bpm: 82,
//   PR_ms: 138,
//   QRS_ms: 84,
//   QT_ms: 352,
//   QTc_ms: 408,
//   P_axis: 48,
//   QRS_axis: 62,
//   T_axis: 45,
//   QRS_amp_mV: 1.35,
//   ...
// }
```

### morphologyModel(sample, dx, fs, duration_s, rng)

**Location**: `viewer/js/ecg-synth-modules.js`

Generates the complete 12-lead ECG morphology.

```javascript
const leads_uV = morphologyModel(sample, "Normal sinus", 1000, 10.0, rng);
// Returns: { I: Int16Array, II: Int16Array, ..., V6: Int16Array }
```

**Internal flow**:
1. Calculate RR interval from HR
2. For each beat:
   - Generate beat jitter
   - Add P wave (if conducted)
   - Add QRS complex
   - Add T wave
   - Apply diagnosis-specific modifications
3. Project to 12 leads using axis
4. Enforce Einthoven's law
5. Clamp to ±5000 µV

### generateBeatJitter(beatIndex, totalBeats, rng, respiratoryRate, beatTime)

**Location**: `viewer/js/ecg-synth-modules.js`

Creates beat-to-beat variation for realism.

```javascript
const jitter = generateBeatJitter(5, 13, rng, 15, 3.75);
// Returns:
// {
//   ampJitter: 0.97,        // Amplitude scaling (±11%)
//   timeJitterQRS: 0.003,   // QRS timing shift (±5ms)
//   timeJitterP: -0.002,    // P timing shift
//   timeJitterT: 0.004,     // T timing shift
//   qrsDurationFactor: 1.02, // QRS width variation (±5%)
//   morphJitter: 0.015      // Shape variation
// }
```

**Jitter components**:
1. **Respiratory modulation**: ~6% amplitude variation with breathing (15 breaths/min)
2. **Random amplitude jitter**: ±5% beat-to-beat
3. **Timing jitter**: ±5ms for each wave
4. **Duration jitter**: ±5% QRS width
5. **Shape jitter**: Subtle morphology changes

### noiseModel(leads_uV, fs, noiseLevel, rng)

**Location**: `viewer/js/ecg-synth-modules.js`

Adds realistic noise and artifacts.

```javascript
const noisyLeads = noiseModel(cleanLeads, 1000, 0.5, rng);
```

**Noise components**:
1. **Baseline wander**: Low-frequency drift (0.05-0.5 Hz)
2. **EMG noise**: High-frequency muscle artifact
3. **Mains interference**: 60 Hz powerline (subtle)
4. **Motion artifacts**: Occasional transient spikes

## Supported Diagnoses

### Normal Rhythms

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| Normal sinus | Age-appropriate HR, intervals | Default morphology |
| Sinus bradycardia | HR < lower limit for age | HR forced below threshold |
| Sinus tachycardia | HR > upper limit for age | HR forced above threshold |

### Conduction Abnormalities

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| RBBB | rsR' in V1, wide S in I/V6 | QRS ≥120ms, secondary R' |
| LBBB | Broad notched R in I/V6 | QRS ≥140ms, no Q in I |
| LAFB | Left axis deviation | Axis -45° to -90° |
| 1st degree AVB | PR > 200ms | Prolonged PR interval |
| 2nd degree AVB (Wenckebach) | Progressive PR lengthening | Dropped beats after sequence |
| 2nd degree AVB (Mobitz II) | Fixed PR, dropped beats | Random conduction failures |
| 3rd degree AVB | Complete dissociation | Separate P and QRS rhythms |

### Pre-excitation

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| WPW | Short PR, delta wave, wide QRS | PR 80-120ms, slurred upstroke |

### Hypertrophy

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| LVH | Tall R in V5/V6, deep S in V1 | Increased voltages, strain pattern |
| RVH | Tall R in V1, RAD | Right precordial dominance |

### Tachyarrhythmias

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| SVT (narrow) | HR 150-250, regular | Narrow QRS, no visible P |
| Atrial flutter (2:1) | Sawtooth flutter waves | 150 bpm ventricular rate |

### Repolarization

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| Long QT | QTc > 460ms | Prolonged QT, notched T possible |
| Pericarditis | Diffuse ST elevation, PR depression | Concave ST, all leads |

### Ectopy

| Diagnosis | Key Features | Implementation Notes |
|-----------|--------------|---------------------|
| PACs | Early narrow beats | Random early P and QRS |
| PVCs | Wide complex early beats | No P, compensatory pause |

## Pediatric Priors

Age-specific normal values (mean ± SD):

```javascript
const PEDIATRIC_PRIORS = {
  age_bins: [
    { id: "neonate", range: [0, 0.083],
      HR: { mean: 140, sd: 20 },
      PR: { mean: 100, sd: 15 },
      QRS: { mean: 65, sd: 10 },
      axis: { mean: 110, sd: 30 }
    },
    { id: "infant", range: [0.083, 1],
      HR: { mean: 130, sd: 20 },
      PR: { mean: 110, sd: 15 },
      QRS: { mean: 65, sd: 10 },
      axis: { mean: 80, sd: 30 }
    },
    // ... through adolescent/adult
  ]
};
```

Key pediatric considerations:
- **Neonates**: Rightward axis (110°), fast HR (140 bpm), short PR (100ms)
- **Infants**: Transitioning axis, high R in V1 normal
- **Children**: Gradual leftward axis shift, slowing HR
- **Adolescents**: Approaching adult values

## Lead Projection

The synthesizer uses a hexaxial reference system:

```
         -90°
          aVL
     -30° / \ +30°
         /   \
   I ───┼─────┼─── +0°
        \     /
   -60°  \   /  +60°
          \ /
         +90°
          aVF
```

**Projection formula**:
```javascript
// For frontal leads
leads.I = vectorMag * Math.cos(axis * Math.PI / 180);
leads.II = vectorMag * Math.cos((axis - 60) * Math.PI / 180);
leads.III = vectorMag * Math.cos((axis - 120) * Math.PI / 180);

// Einthoven enforcement
leads.III = leads.II - leads.I;  // II = I + III
leads.aVR = -(leads.I + leads.II) / 2;
leads.aVL = leads.I - leads.II / 2;
leads.aVF = leads.II - leads.I / 2;
```

## Testing

```bash
# Run all synthesis tests
node test/synth-modules.test.js

# Test specific diagnosis
node -e "
  import('./viewer/js/ecg-synth.js').then(m => {
    const ecg = m.generateSyntheticECG(8, 'WPW', 12345);
    console.log('PR:', ecg.targets.PR_ms);  // Should be 80-120
    console.log('QRS:', ecg.targets.QRS_ms); // Should be >100
  });
"
```

## Extending the Synthesizer

### Adding a New Diagnosis

1. **Add to PATHOLOGIES** in `ecg-synth.js`:
```javascript
PATHOLOGIES["My New Diagnosis"] = {
  category: "arrhythmia",
  description: "Description for UI",
  age_applicable: [0, 99]
};
```

2. **Implement morphology** in `morphologyModel()`:
```javascript
case "My New Diagnosis":
  // Modify sample parameters
  sample.HR_bpm = Math.max(sample.HR_bpm, 100);
  // Add specific waveform modifications
  break;
```

3. **Add exemptions** if pathology violates normal priors:
```json
// python/configs/eval_matrix.json
{
  "pathological_exemptions": {
    "My New Diagnosis": {
      "exempt_params": ["HR", "QRS"],
      "min_sdnn_ms": 2.0
    }
  }
}
```

4. **Add test case**:
```javascript
// test/synth-modules.test.js
const ecg = generateSyntheticECG(8, "My New Diagnosis", 12345);
assert(ecg.targets.HR_bpm >= 100, "HR should be elevated");
```

### Tuning Beat-to-Beat Variation

Modify jitter parameters in `generateBeatJitter()`:

```javascript
// Increase respiratory modulation
const respModulation = 0.10 * Math.sin(respPhase);  // Was 0.06

// Increase amplitude randomness
const ampJitter = 1.0 + respModulation + randn(rng) * 0.08;  // Was 0.05

// Increase timing jitter
const timeJitterQRS = randn(rng) * 0.008;  // Was 0.005
```

### Adjusting Noise Levels

The noise model accepts a 0-1 intensity parameter:

```javascript
const ecg = generateSyntheticECG(8, "Normal sinus", 12345, {
  noise_level: 0.8  // High noise for artifact training
});
```

Noise components scale with this parameter:
- Baseline wander: 50-200 µV amplitude
- EMG: 5-20 µV RMS
- Mains: 2-10 µV amplitude
- Motion: Occasional 100-500 µV spikes

## Known Limitations

1. **Morphology is parametric**: Uses Gaussian-modulated sinusoids, not template-based
2. **No MI patterns**: Acute/chronic MI morphology not implemented
3. **Limited arrhythmia complexity**: No VT, VF, complex AV blocks
4. **Precordial leads simplified**: V1-V6 progression is formula-based, not anatomically derived
5. **No electrode misplacement**: All leads assume correct placement

## Future Enhancements

Potential improvements for higher fidelity:

1. **Template-based morphology**: Use real ECG templates instead of parametric curves
2. **Anatomical lead model**: Proper forward model from cardiac vectors
3. **More arrhythmias**: VT, VF, multifocal atrial tachycardia
4. **MI patterns**: ST elevation/depression, Q waves, T inversions
5. **Drug effects**: QT prolongation from specific medications
6. **Electrolyte abnormalities**: Hyperkalemia, hypocalcemia patterns
