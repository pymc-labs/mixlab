import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorPredictive } from '../lib/prior-predictive.ts';
import { defaultConfig, type Dataset } from '../lib/core.ts';
const data: Dataset = {
  dates: ['2024-01-01', '2024-01-08', '2024-01-15'],
  y: [50, 100, 70],
  channels: ['a'],
  x: [[10], [0], [0]],
  controls: [],
  z: [[], [], []],
};
test('repeatable prior samples respond to amplitude without resampling nuisance terms', () => {
  const a = priorPredictive(data, { ...defaultConfig, priorScale: 1 }, 40);
  const b = priorPredictive(data, { ...defaultConfig, priorScale: 2 }, 40);
  assert.deepEqual(
    a,
    priorPredictive(data, { ...defaultConfig, priorScale: 1 }, 40),
  );
  a.media.paths.forEach((row, d) =>
    row.forEach((v, t) => {
      assert.equal(b.media.paths[d][t], 2 * v);
      assert.ok(
        Math.abs(b.outcome.paths[d][t] - a.outcome.paths[d][t] - v) < 1e-9,
      );
    }),
  );
});
test('observed values only set the outcome scale; zero spend gives zero media', () => {
  assert.deepEqual(
    priorPredictive(data, defaultConfig, 20),
    priorPredictive({ ...data, y: [100, 20, 40] }, defaultConfig, 20),
  );
  const result = priorPredictive(
    { ...data, x: [[0], [0], [0]] },
    defaultConfig,
    20,
  );
  assert.ok(result.media.paths.flat().every((v) => v === 0));
  assert.ok(result.outcome.paths.flat().some((v) => v !== 0));
});
test('extreme valid shapes remain finite and carryover responds', () => {
  for (const alpha of [0.001, 400])
    for (const beta of [0.001, 400]) {
      const result = priorPredictive(
        data,
        {
          ...defaultConfig,
          adstockPrior: { alpha, beta },
          saturationPrior: { alpha, beta },
        },
        30,
      );
      assert.ok(result.outcome.paths.flat().every(Number.isFinite));
    }
  const short = priorPredictive(
    data,
    { ...defaultConfig, adstockPrior: { alpha: 1, beta: 400 } },
    100,
  );
  const long = priorPredictive(
    data,
    { ...defaultConfig, adstockPrior: { alpha: 400, beta: 1 } },
    100,
  );
  assert.ok(long.media.intervals[2].median > short.media.intervals[2].median);
});
