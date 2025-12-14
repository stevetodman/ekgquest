#!/usr/bin/env node
/**
 * Test the ECG trace extraction functionality
 */

import puppeteer from 'puppeteer';
import path from 'path';

const testImage = path.join(process.env.HOME, 'Desktop/ECG-Import/test2_normal_sinus.png');

async function test() {
  console.log('='.repeat(50));
  console.log('ECG Trace Extraction Test');
  console.log('='.repeat(50));

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  // Capture console logs and errors
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[error] ${err.message}`));

  try {
    console.log('\n1. Loading EKGQuest Lab...');
    await page.goto('http://localhost:8000/viewer/ekgquest_lab.html', {
      waitUntil: 'networkidle0',
      timeout: 10000
    });
    console.log('   ✓ Page loaded');

    // Upload test image
    console.log('\n2. Uploading test image...');
    console.log('   File:', testImage);

    const fileInput = await page.$('#imageInput');
    if (!fileInput) {
      throw new Error('File input not found');
    }
    await fileInput.uploadFile(testImage);
    await page.waitForTimeout(1000);
    console.log('   ✓ Image uploaded');

    // Check if we're in image mode
    const beforeExtract = await page.evaluate(() => ({
      imageMode: typeof imageMode !== 'undefined' ? imageMode : null,
      hasUploadedImage: typeof uploadedImage !== 'undefined' && uploadedImage !== null,
      calibrationVisible: document.getElementById('calibrationControls')?.style.display !== 'none'
    }));
    console.log('\n3. State before extraction:');
    console.log('   Image mode:', beforeExtract.imageMode);
    console.log('   Has uploaded image:', beforeExtract.hasUploadedImage);
    console.log('   Calibration controls visible:', beforeExtract.calibrationVisible);

    // Click Extract Trace button
    console.log('\n4. Extracting trace...');
    const extractResult = await page.evaluate(() => {
      try {
        extractTraceFromImage();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
    if (!extractResult.success) {
      console.log('   Extract error:', extractResult.error);
    }

    // Wait for processing
    await page.waitForTimeout(3000);

    // Check results
    const results = await page.evaluate(() => {
      const status = document.querySelector('.status-msg')?.textContent || '';
      return {
        status,
        imageMode: typeof imageMode !== 'undefined' ? imageMode : null,
        hasEcgData: typeof ecgData !== 'undefined' && ecgData !== null,
        leadCount: ecgData?.leads_uV ? Object.keys(ecgData.leads_uV).length : 0,
        sampleCount: ecgData?.leads_uV?.II?.length || 0,
        duration: ecgData?.duration_s || 0,
        extractionPoints: ecgData?.integrity?.extraction_points || 0,
        fs: ecgData?.fs || 0
      };
    });

    console.log('\n5. Results:');
    console.log('   Status:', results.status);
    console.log('   Image mode:', results.imageMode);
    console.log('   Has ECG data:', results.hasEcgData);
    console.log('   Lead count:', results.leadCount);
    console.log('   Sample rate:', results.fs, 'Hz');
    console.log('   Sample count:', results.sampleCount);
    console.log('   Duration:', results.duration.toFixed(2) + 's');
    console.log('   Extraction points:', results.extractionPoints);

    console.log('\n' + '='.repeat(50));
    if (results.hasEcgData && results.sampleCount > 100 && !results.imageMode) {
      console.log('✅ PASS: Trace extraction successful');
      console.log('='.repeat(50));
    } else {
      console.log('❌ FAIL: Trace extraction failed');
      console.log('='.repeat(50));
      console.log('\nRecent console logs:');
      logs.slice(-15).forEach(l => console.log('  ', l));
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\nConsole logs:');
    logs.forEach(l => console.log('  ', l));
  }

  await browser.close();
}

test();
