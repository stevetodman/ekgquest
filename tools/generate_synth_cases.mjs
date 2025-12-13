#!/usr/bin/env node
/**
 * ECG Synthesis Case Generator CLI
 *
 * Generates synthetic ECG cases for evaluation by the Python Realism Lab.
 * This bridges the JS synthesizer to Python evaluation pipeline.
 *
 * Usage:
 *   node tools/generate_synth_cases.mjs --config python/configs/eval_matrix.json --out python/outputs/cases/
 *
 * Options:
 *   --config   Path to evaluation matrix JSON (required)
 *   --out      Output directory for generated ECG files (required)
 *   --golden   Only generate golden seed cases
 *   --verbose  Verbose output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the synthesizer
import { synthECGModular, DEVICE_PRESETS, ARTIFACT_PRESETS } from '../viewer/js/ecg-synth-modules.js';

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    out: { type: 'string', short: 'o' },
    golden: { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || (!args.config && !args.golden)) {
  console.log(`
ECG Synthesis Case Generator

Usage:
  node tools/generate_synth_cases.mjs --config <config.json> --out <output_dir>

Options:
  -c, --config   Path to evaluation matrix JSON
  -o, --out      Output directory for generated ECG files
  --golden       Only generate golden seed cases
  -v, --verbose  Verbose output
  -h, --help     Show this help
`);
  process.exit(args.help ? 0 : 1);
}

// Default output directory
const outputDir = args.out || path.join(__dirname, '../python/outputs/cases');

// Load config
let config = {
  generation: {
    seeds: [42],
    age_bins: [{ id: 'default', age: 8 }],
    diagnoses: ['Normal sinus'],
    artifact_profiles: ['typical'],
    device_modes: ['diagnostic'],
  },
  golden_seeds: { cases: [] },
};

if (args.config) {
  try {
    config = JSON.parse(fs.readFileSync(args.config, 'utf-8'));
  } catch (e) {
    console.error(`Error reading config: ${e.message}`);
    process.exit(1);
  }
}

// Ensure output directory exists
fs.mkdirSync(outputDir, { recursive: true });

// Get artifact and device presets
function getArtifactPreset(name) {
  return ARTIFACT_PRESETS[name] || ARTIFACT_PRESETS.typical;
}

function getDevicePreset(name) {
  return DEVICE_PRESETS[name] || DEVICE_PRESETS.diagnostic;
}

// Generate a single case
function generateCase(age, dx, seed, artifactProfile = 'typical', deviceMode = 'diagnostic') {
  const ecg = synthECGModular(age, dx, seed, {
    enableNoise: true,
    enableFilters: true,
    artifactParams: getArtifactPreset(artifactProfile),
    deviceParams: getDevicePreset(deviceMode),
  });

  // Add seed to targets for traceability
  ecg.targets.seed = seed;

  return ecg;
}

// Save ECG to file
function saveECG(ecg, filename) {
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(ecg, null, 2));
  return filepath;
}

// Main generation logic
async function main() {
  console.log('ECG Synthesis Case Generator');
  console.log('============================\n');

  const generated = [];

  if (args.golden) {
    // Generate only golden seed cases
    console.log('Generating golden seed cases...\n');

    const goldenCases = config.golden_seeds?.cases || [];
    if (goldenCases.length === 0) {
      console.log('No golden seeds defined in config');
      process.exit(0);
    }

    for (const gc of goldenCases) {
      const ecg = generateCase(gc.age, gc.dx, gc.seed);
      const filename = `golden_${gc.id}.json`;
      saveECG(ecg, filename);
      generated.push({ id: gc.id, age: gc.age, dx: gc.dx, seed: gc.seed, file: filename });

      if (args.verbose) {
        console.log(`  ${gc.id}: age=${gc.age}, dx="${gc.dx}", seed=${gc.seed}`);
      }
    }

    console.log(`\nGenerated ${generated.length} golden seed cases`);
  } else {
    // Generate full matrix
    console.log('Generating evaluation matrix...\n');

    const { seeds, age_bins, diagnoses, artifact_profiles, device_modes } = config.generation;

    let total = seeds.length * age_bins.length * diagnoses.length;
    let count = 0;

    for (const ageBin of age_bins) {
      for (const dx of diagnoses) {
        for (const seed of seeds) {
          const artifactProfile = artifact_profiles[0] || 'typical';
          const deviceMode = device_modes[0] || 'diagnostic';

          const ecg = generateCase(ageBin.age, dx, seed, artifactProfile, deviceMode);
          const safeDx = dx.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const filename = `${ageBin.id}_${safeDx}_seed${seed}.json`;
          saveECG(ecg, filename);

          generated.push({
            age_bin: ageBin.id,
            age: ageBin.age,
            dx,
            seed,
            file: filename,
          });

          count++;
          if (args.verbose) {
            console.log(`  [${count}/${total}] ${ageBin.id} / ${dx} / seed=${seed}`);
          }
        }
      }
    }

    console.log(`\nGenerated ${generated.length} cases`);
    console.log(`  Age bins: ${age_bins.length}`);
    console.log(`  Diagnoses: ${diagnoses.length}`);
    console.log(`  Seeds: ${seeds.length}`);
  }

  // Write manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    generator_version: '2.2.0-device',
    config_path: args.config || 'default',
    output_dir: outputDir,
    n_cases: generated.length,
    cases: generated,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);
  console.log(`Output: ${outputDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
