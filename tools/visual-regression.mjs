#!/usr/bin/env node
/**
 * Visual Regression Testing for ECG Synthesis
 *
 * Generates screenshots of ECG renderings and compares them against
 * golden reference images to catch visual regressions.
 *
 * Usage:
 *   node tools/visual-regression.mjs --update    # Update golden screenshots
 *   node tools/visual-regression.mjs --check     # Check against golden (CI mode)
 *   node tools/visual-regression.mjs --diff      # Generate diff images
 *
 * Requirements:
 *   npm install puppeteer pixelmatch pngjs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Test cases: fixed seeds for reproducible visual testing
const VISUAL_TEST_CASES = [
  { name: 'normal_child_8y', age: 8, dx: 'Normal sinus', seed: 42 },
  { name: 'normal_neonate', age: 0.05, dx: 'Normal sinus', seed: 100 },
  { name: 'normal_adult', age: 35, dx: 'Normal sinus', seed: 200 },
  { name: 'wpw_child', age: 8, dx: 'WPW', seed: 300 },
  { name: 'rbbb_child', age: 10, dx: 'RBBB', seed: 400 },
  { name: 'svt_child', age: 8, dx: 'SVT (narrow)', seed: 500 },
];

const GOLDEN_DIR = join(ROOT, 'test', 'visual', 'golden');
const OUTPUT_DIR = join(ROOT, 'test', 'visual', 'output');
const DIFF_DIR = join(ROOT, 'test', 'visual', 'diff');

// Ensure directories exist
[GOLDEN_DIR, OUTPUT_DIR, DIFF_DIR].forEach(dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
});

/**
 * Compute perceptual hash of an image buffer (simple average hash)
 */
function computeImageHash(pngBuffer) {
  return createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
}

/**
 * Generate HTML for rendering a single ECG case
 */
function generateTestHTML(testCase) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Visual Regression Test: ${testCase.name}</title>
  <style>
    body { margin: 0; padding: 20px; background: white; font-family: sans-serif; }
    canvas { border: 1px solid #ccc; }
    .info { margin-bottom: 10px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="info">
    Test: ${testCase.name} | Age: ${testCase.age}y | Dx: ${testCase.dx} | Seed: ${testCase.seed}
  </div>
  <canvas id="ecgCanvas" width="1200" height="800"></canvas>

  <script type="module">
    import { synthECGModular } from '../viewer/js/ecg-synth-modules.js';

    const canvas = document.getElementById('ecgCanvas');
    const ctx = canvas.getContext('2d');

    // Generate ECG
    const ecg = synthECGModular(${testCase.age}, "${testCase.dx}", ${testCase.seed});

    // Render settings
    const leads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
    const rowHeight = 60;
    const leftMargin = 50;
    const rightMargin = 20;
    const topMargin = 30;
    const mmPerSec = 25;
    const mmPerMV = 10;
    const pxPerMM = 4; // 4 pixels per mm

    // Clear canvas
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid (light pink like standard ECG paper)
    ctx.strokeStyle = '#ffcccc';
    ctx.lineWidth = 0.5;
    const gridSize = pxPerMM; // 1mm grid
    for (let x = leftMargin; x < canvas.width - rightMargin; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, topMargin);
      ctx.lineTo(x, canvas.height - 20);
      ctx.stroke();
    }
    for (let y = topMargin; y < canvas.height - 20; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(canvas.width - rightMargin, y);
      ctx.stroke();
    }

    // Draw 5mm grid (darker)
    ctx.strokeStyle = '#ff9999';
    ctx.lineWidth = 0.5;
    const bigGridSize = pxPerMM * 5;
    for (let x = leftMargin; x < canvas.width - rightMargin; x += bigGridSize) {
      ctx.beginPath();
      ctx.moveTo(x, topMargin);
      ctx.lineTo(x, canvas.height - 20);
      ctx.stroke();
    }
    for (let y = topMargin; y < canvas.height - 20; y += bigGridSize) {
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(canvas.width - rightMargin, y);
      ctx.stroke();
    }

    // Draw each lead
    const fs = ecg.fs;
    const pxPerSample = (mmPerSec * pxPerMM) / fs;
    const uvPerPx = 1000 / (mmPerMV * pxPerMM); // uV per pixel

    leads.forEach((leadName, idx) => {
      const leadData = ecg.leads_uV[leadName];
      if (!leadData) return;

      const baseY = topMargin + (idx + 0.5) * rowHeight;

      // Draw lead label
      ctx.fillStyle = '#333';
      ctx.font = '11px sans-serif';
      ctx.fillText(leadName, 5, baseY + 4);

      // Draw waveform
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();

      const maxSamples = Math.min(leadData.length, Math.floor((canvas.width - leftMargin - rightMargin) / pxPerSample));

      for (let i = 0; i < maxSamples; i++) {
        const x = leftMargin + i * pxPerSample;
        const y = baseY - leadData[i] / uvPerPx;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    });

    // Draw title
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(\`\${ecg.targets.dx} - Age: \${ecg.targets.age_years}y - HR: \${ecg.targets.HR_bpm.toFixed(0)} bpm\`, leftMargin, 18);

    // Signal completion
    window.renderComplete = true;
  </script>
</body>
</html>`;
}

/**
 * Run visual regression tests
 */
async function runVisualTests(mode = 'check') {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch (e) {
    console.log('Puppeteer not installed. Install with: npm install puppeteer');
    console.log('Skipping visual regression tests.');
    return { passed: true, skipped: true };
  }

  const browser = await puppeteer.default.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];

  for (const testCase of VISUAL_TEST_CASES) {
    console.log(`  Testing: ${testCase.name}...`);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Generate and load test HTML
    const html = generateTestHTML(testCase);
    const testHtmlPath = join(OUTPUT_DIR, `${testCase.name}.html`);
    writeFileSync(testHtmlPath, html);

    await page.goto(`file://${testHtmlPath}`, { waitUntil: 'networkidle0' });

    // Wait for render completion
    await page.waitForFunction('window.renderComplete === true', { timeout: 10000 });

    // Take screenshot
    const screenshotPath = join(OUTPUT_DIR, `${testCase.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const currentBuffer = readFileSync(screenshotPath);
    const currentHash = computeImageHash(currentBuffer);

    const goldenPath = join(GOLDEN_DIR, `${testCase.name}.png`);
    const goldenHashPath = join(GOLDEN_DIR, `${testCase.name}.hash`);

    if (mode === 'update') {
      // Update golden screenshots
      writeFileSync(goldenPath, currentBuffer);
      writeFileSync(goldenHashPath, currentHash);
      console.log(`    Updated golden: ${testCase.name}`);
      results.push({ name: testCase.name, status: 'updated' });
    } else {
      // Check against golden
      if (!existsSync(goldenPath) || !existsSync(goldenHashPath)) {
        console.log(`    No golden found for ${testCase.name} - run with --update first`);
        results.push({ name: testCase.name, status: 'missing', passed: false });
        continue;
      }

      const goldenHash = readFileSync(goldenHashPath, 'utf8').trim();

      if (currentHash === goldenHash) {
        console.log(`    PASS: ${testCase.name} (hash match)`);
        results.push({ name: testCase.name, status: 'pass', passed: true });
      } else {
        console.log(`    FAIL: ${testCase.name} (hash mismatch)`);
        console.log(`      Golden: ${goldenHash}`);
        console.log(`      Current: ${currentHash}`);

        // Try pixel comparison if pixelmatch is available
        try {
          const { default: pixelmatch } = await import('pixelmatch');
          const { PNG } = await import('pngjs');

          const goldenImg = PNG.sync.read(readFileSync(goldenPath));
          const currentImg = PNG.sync.read(currentBuffer);

          if (goldenImg.width === currentImg.width && goldenImg.height === currentImg.height) {
            const diff = new PNG({ width: goldenImg.width, height: goldenImg.height });
            const numDiffPixels = pixelmatch(
              goldenImg.data, currentImg.data, diff.data,
              goldenImg.width, goldenImg.height,
              { threshold: 0.1 }
            );

            const diffPercent = (numDiffPixels / (goldenImg.width * goldenImg.height) * 100).toFixed(2);
            console.log(`      Pixel diff: ${numDiffPixels} pixels (${diffPercent}%)`);

            // Save diff image
            const diffPath = join(DIFF_DIR, `${testCase.name}_diff.png`);
            writeFileSync(diffPath, PNG.sync.write(diff));

            // Allow small differences (< 1%)
            if (parseFloat(diffPercent) < 1.0) {
              console.log(`      Acceptable diff (< 1%), treating as PASS`);
              results.push({ name: testCase.name, status: 'pass', passed: true, diffPercent });
            } else {
              results.push({ name: testCase.name, status: 'fail', passed: false, diffPercent });
            }
          } else {
            results.push({ name: testCase.name, status: 'fail', passed: false, reason: 'size mismatch' });
          }
        } catch (e) {
          // pixelmatch not available, fail on hash mismatch
          results.push({ name: testCase.name, status: 'fail', passed: false });
        }
      }
    }

    await page.close();
  }

  await browser.close();

  // Summary
  console.log('\n--- Visual Regression Summary ---');
  const passed = results.filter(r => r.passed !== false).length;
  const failed = results.filter(r => r.passed === false).length;
  console.log(`Passed: ${passed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.passed === false).forEach(r => {
      console.log(`  - ${r.name}: ${r.reason || r.status}`);
    });
  }

  return { passed: failed === 0, results };
}

// CLI
const args = process.argv.slice(2);
const mode = args.includes('--update') ? 'update' : 'check';

console.log(`\nVisual Regression Testing (mode: ${mode})\n`);

runVisualTests(mode).then(result => {
  if (result.skipped) {
    console.log('\nVisual tests skipped (puppeteer not installed)');
    process.exit(0);
  }
  process.exit(result.passed ? 0 : 1);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
