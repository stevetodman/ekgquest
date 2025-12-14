#!/usr/bin/env node
/**
 * Simple ECG Import Test
 * Tests the core image loading and provides a URL for manual browser testing
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.env.HOME, 'Desktop', 'ECG-Import');

const TEST_IMAGES = [
  'test1_normal_12lead.png',
  'test2_normal_sinus.png',
  'test3_normal_sinus2.png',
];

console.log('='.repeat(60));
console.log('ECG Import Test - File Verification');
console.log('='.repeat(60));

let allValid = true;

for (const img of TEST_IMAGES) {
  const path = join(TEST_DIR, img);
  try {
    const stats = statSync(path);
    const sizeKB = (stats.size / 1024).toFixed(1);

    // Read PNG header to verify it's a valid image
    const buffer = readFileSync(path);
    const pngSignature = buffer.slice(0, 8).toString('hex');
    const isPNG = pngSignature === '89504e470d0a1a0a';

    // Get dimensions from PNG header
    let width = 0, height = 0;
    if (isPNG && buffer.length > 24) {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }

    console.log(`\n${img}:`);
    console.log(`  Size: ${sizeKB} KB`);
    console.log(`  Valid PNG: ${isPNG ? 'YES' : 'NO'}`);
    console.log(`  Dimensions: ${width}x${height}`);

    if (isPNG && width > 100 && height > 100) {
      console.log(`  ✅ Ready for import testing`);
    } else {
      console.log(`  ⚠️  May have issues`);
      allValid = false;
    }
  } catch (err) {
    console.log(`\n${img}:`);
    console.log(`  ❌ Error: ${err.message}`);
    allValid = false;
  }
}

console.log('\n' + '='.repeat(60));
console.log('Manual Browser Testing Instructions');
console.log('='.repeat(60));

console.log(`
1. Open in browser:
   http://localhost:8000/viewer/ekgquest_lab.html

2. Test each import method:

   METHOD A - Drag & Drop:
   - Open Finder: ${TEST_DIR}
   - Drag any .png file onto the browser window

   METHOD B - File Upload:
   - Click "Upload PDF or Image" button
   - Select a test image

   METHOD C - Keyboard Paste:
   - In Finder, select an image and press Cmd+C
   - In browser, press Cmd+V

3. Check for each test:
   - Status shows "Digitizing ECG..." then success
   - ECG waveform appears (not just the image)
   - HR/QRS measurements are displayed
   - No filename/timestamp in console (privacy)

4. Test files location:
   ${TEST_DIR}/
`);

if (allValid) {
  console.log('All test files are valid and ready for testing.\n');
} else {
  console.log('Some test files may have issues. Check above.\n');
}
