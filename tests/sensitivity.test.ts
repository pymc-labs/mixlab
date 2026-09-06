import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validSensitivity,
  sensitivityDiagnosis,
  type SensitivityResult,
} from '../lib/sensitivity.ts';

function fixture(): Extract<SensitivityResult, { status: 'available' }> {
  const points = Array.from({ length: 21 }, (_, i) => ({
    power: Math.pow(1.25, (i - 10) / 10),
    paretoK: 0.2,
    weightEss: 1000,
    reliable: true,
    channels: [
      { low: 10, median: 20, high: 30, density: Array(48).fill(1 / 48) },
    ],
  }));
  return {
    status: 'available',
    method: 'psis-power-scaling',
    draws: 1000,
    paretoThreshold: 0.66,
    binCenters: [Array.from({ length: 48 }, (_, i) => i)],
    scores: { prior: [0.1], likelihood: [0.2] },
    groups: {
      prior: structuredClone(points),
      likelihood: structuredClone(points),
    },
  };
}

void test('saved sensitivity keeps both components, all powers, and channel alignment', () => {
  assert.equal(validSensitivity(fixture(), 1, 1000), true);
  assert.equal(validSensitivity(fixture(), 2, 1000), false);
  assert.equal(validSensitivity(fixture(), 1, 2000), false);
  assert.equal(
    validSensitivity(
      { status: 'unavailable', reason: 'Refit needed' },
      1,
      1000,
    ),
    true,
  );
});

void test('import rejects corrupt plot values, swapped powers, and false reliability claims', () => {
  for (const corrupt of [
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].channels[0].density[1] = NaN;
    },
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].channels[0].low = 40;
    },
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].paretoK = 0.8;
    },
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].weightEss = 5;
    },
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].power = 2;
    },
    (s: ReturnType<typeof fixture>) => {
      s.groups.prior[0].channels = [];
    },
    (s: ReturnType<typeof fixture>) => {
      s.binCenters[0][2] = -1;
    },
    (s: ReturnType<typeof fixture>) => {
      s.scores.prior[0] = -1;
    },
  ]) {
    const s = fixture();
    corrupt(s);
    assert.equal(validSensitivity(s, 1, 1000), false);
  }
  const failed = fixture();
  failed.groups.prior[0].paretoK = null;
  failed.groups.prior[0].reliable = false;
  assert.equal(validSensitivity(failed, 1, 1000), true);
});

void test('CJS interpretations distinguish prior-data conflict, weak likelihood, and unavailable diagnostics', () => {
  assert.equal(sensitivityDiagnosis(0.1, 0.1), 'Possible prior–data conflict');
  assert.equal(
    sensitivityDiagnosis(0.1, 0.01),
    'Strong prior / weak likelihood',
  );
  assert.equal(sensitivityDiagnosis(0.01, 0.1), 'No sensitivity flag');
  assert.equal(sensitivityDiagnosis(null, 0.1), 'Sensitivity unavailable');
  assert.equal(
    sensitivityDiagnosis(0.05, 0.05),
    'Possible prior–data conflict',
  );
});
