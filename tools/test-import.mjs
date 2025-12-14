#!/usr/bin/env node
/**
 * Test ECG Import Pipeline
 * Uses Puppeteer to test the import functionality with real ECG images
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_IMAGES = [
  { name: 'test1_normal_12lead.png', desc: 'Red grid, black traces' },
  { name: 'test2_normal_sinus.png', desc: 'Pink grid, blue traces' },
  { name: 'test3_normal_sinus2.png', desc: 'Pink grid, blue traces (alt)' },
];

const TEST_DIR = path.join(process.env.HOME, 'Desktop', 'ECG-Import');

async function testImport() {
  console.log('='.repeat(60));
  console.log('ECG Import Pipeline Test');
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({
    headless: false,  // Show browser for visual verification
    defaultViewport: { width: 1400, height: 900 }
  });

  const page = await browser.newPage();

  // Collect console messages
  const logs = [];
  page.on('console', msg => {
    logs.push(msg.text());
  });

  try {
    // Navigate to EKGQuest Lab
    console.log('\n1. Loading EKGQuest Lab...');
    await page.goto('http://localhost:8000/viewer/ekgquest_lab.html', {
      waitUntil: 'networkidle0',
      timeout: 10000
    });
    console.log('   Page loaded successfully');

    // Test each image
    for (const testImage of TEST_IMAGES) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`Testing: ${testImage.name}`);
      console.log(`Description: ${testImage.desc}`);
      console.log('─'.repeat(50));

      const imagePath = path.join(TEST_DIR, testImage.name);

      // Clear any previous state by generating a new synthetic ECG
      await page.click('button:has-text("Generate")').catch(() => {
        // Button might have different text, try alternative
        return page.evaluate(() => {
          const btn = document.querySelector('button[onclick="generate()"]');
          if (btn) btn.click();
        });
      });
      await page.waitForTimeout(500);

      // Upload the image via file input
      const fileInput = await page.$('#imageInput');
      if (!fileInput) {
        console.log('   ERROR: Could not find file input');
        continue;
      }

      console.log('   Uploading image...');
      await fileInput.uploadFile(imagePath);

      // Wait for processing
      console.log('   Waiting for processing...');
      await page.waitForTimeout(3000);

      // Check results
      const results = await page.evaluate(() => {
        const status = document.querySelector('.status-msg')?.textContent || '';
        const caseInfo = document.getElementById('caseInfo')?.textContent || '';
        const hasEcgData = typeof ecgData !== 'undefined' && ecgData !== null;
        const isImageMode = typeof imageMode !== 'undefined' && imageMode;

        let leadCount = 0;
        let sampleCount = 0;
        let hrDisplay = '';

        if (hasEcgData && ecgData.leads_uV) {
          leadCount = Object.keys(ecgData.leads_uV).length;
          const firstLead = Object.values(ecgData.leads_uV)[0];
          sampleCount = firstLead ? firstLead.length : 0;
        }

        // Get HR from display
        const hrEl = document.querySelector('.metric-value');
        if (hrEl) hrDisplay = hrEl.textContent;

        return {
          status,
          caseInfo,
          hasEcgData,
          isImageMode,
          leadCount,
          sampleCount,
          hrDisplay,
          isDigitized: hasEcgData && !isImageMode && leadCount > 0
        };
      });

      // Report results
      console.log('\n   Results:');
      console.log(`   - Status: ${results.status || '(none)'}`);
      console.log(`   - Digitized: ${results.isDigitized ? 'YES' : 'NO'}`);
      console.log(`   - Lead count: ${results.leadCount}`);
      console.log(`   - Sample count: ${results.sampleCount}`);
      console.log(`   - HR display: ${results.hrDisplay || '(none)'}`);

      if (results.isDigitized) {
        console.log('   ✅ PASS: Image successfully digitized');
      } else if (results.isImageMode) {
        console.log('   ⚠️  PARTIAL: Loaded as image (manual calibration needed)');
      } else {
        console.log('   ❌ FAIL: Import failed');
      }

      // Take screenshot
      const screenshotPath = path.join(TEST_DIR, `result_${testImage.name}`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`   Screenshot saved: ${screenshotPath}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test complete! Check screenshots in ~/Desktop/ECG-Import/');
    console.log('='.repeat(60));

    // Keep browser open for manual inspection
    console.log('\nBrowser left open for inspection. Press Ctrl+C to close.');
    await new Promise(() => {}); // Wait forever

  } catch (error) {
    console.error('Test error:', error.message);
  }
}

testImport();
