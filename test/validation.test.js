import { describe, it } from 'vitest';
import assert from 'assert';
import { normalizeECGData, validateECGData } from '../viewer/js/ecg-core.js';

const BASE_FS = 500;
const LEADS_12 = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

function buildLeads(names) {
  const leads = {};
  for (const name of names) leads[name] = new Int16Array([0, 0, 0, 0]);
  return leads;
}

function validate(raw) {
  const meta = normalizeECGData(raw);
  return validateECGData(meta);
}

describe('Validation Tests', () => {
  it('should warn when synthetic flag is missing', () => {
    const full = validate({ fs: BASE_FS, leads_uV: buildLeads(LEADS_12) });
    assert.ok(
      full.warnings.some((w) => w.includes('targets.synthetic')),
      'expected warning when synthetic flag missing'
    );
  });

  it('should warn when leads are missing', () => {
    const missing = validate({ fs: BASE_FS, leads_uV: buildLeads(['I', 'II', 'III']) });
    assert.ok(
      missing.warnings.some((w) => w.startsWith('Missing leads (viewer):')),
      'expected missing-lead warning for incomplete set'
    );
  });
});
