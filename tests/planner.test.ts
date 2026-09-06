import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeWeight,
  normalizeWeights,
  createPlanner,
} from '../lib/planner.ts';
import { scenario, type Dataset, type Posterior } from '../lib/core.ts';
const data: Dataset = {
  dates: ['a', 'b', 'c'],
  x: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  y: [5, 7, 9],
  channels: ['a', 'b'],
  controls: [],
  z: [[], [], []],
};
const p: Posterior = {
  alpha: [
    [0.5, 0.5],
    [0.5, 0.5],
  ],
  lam: [
    [1, 1],
    [1, 1],
  ],
  beta: [
    [2, 1],
    [2, 1],
  ],
  channelScale: [2, 2],
  targetScale: 10,
  contributions: [],
  prediction: { low: [], median: [], high: [] },
  predictiveMean: [20, 40],
  diagnostics: {
    maxRhat: 1,
    minEss: 500,
    minTailEss: 500,
    divergences: 0,
    compileSeconds: 0,
    samplingSeconds: 0,
  },
};
void test('normalization recovers zero budgets and preserves proportions', () => {
  assert.deepEqual(normalizeWeights([0, 0], [0.2, 0.8]), [0.2, 0.8]);
  assert.deepEqual(normalizeWeights([2, 6]), [0.25, 0.75]);
  assert.deepEqual(normalizeWeights([NaN, -1]), [0.5, 0.5]);
});
void test('locked allocation conserves budget including all-in and single-channel states', () => {
  for (const w of [
    [0.2, 0.3, 0.5],
    [1, 0, 0],
  ]) {
    const changed = changeWeight(w, 0, 0.4, [0.2, 0.3, 0.5]);
    assert.ok(Math.abs(changed.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.equal(changed[0], 0.4);
    assert.ok(changed.every((v) => v >= 0));
  }
  assert.deepEqual(changeWeight([1], 0, 0.2, [1]), [1]);
});
void test('response cache agrees with exact scenario on grid and prior has zero change', () => {
  const planner = createPlanner(data, p, 2);
  assert.deepEqual(planner.evaluate(planner.prior, 1, 1).delta, [0, 0]);
  const actual = planner.summarize([0.7, 0.3], 0, 0);
  const expected = scenario(data, p, 2, [1.4, 0.6]);
  assert.ok(Math.abs(actual.interval.median - expected.delta.median) < 1e-10);
});
void test('suggestions conserve spend, improve objective and stronger prior reduces movement', () => {
  const planner = createPlanner(data, p, 2);
  const free = planner.optimize(0, 0),
    close = planner.optimize(10, 0);
  assert.ok(free[0] > 0.5);
  assert.ok(Math.abs(close[0] - 0.5) < Math.abs(free[0] - 0.5));
  assert.ok(Math.abs(free.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(planner.evaluate(free, 0, 0).score >= 0);
});
void test('risk uses paired posterior uncertainty and discounts uncertain gains', () => {
  const uncertain = {
    ...p,
    beta: [
      [4, 1],
      [1, 4],
    ],
  };
  const planner = createPlanner(data, uncertain, 2);
  const neutral = planner.evaluate([0.8, 0.2], 0, 0);
  const averse = planner.evaluate([0.8, 0.2], 0, 2);
  assert.ok(neutral.sd > 0);
  assert.ok(averse.score < neutral.score);
  assert.deepEqual(planner.optimize(0, 3), planner.prior);
});
void test('predictive summaries shift matching noisy outcome draws and support legacy fits', () => {
  const baseline = scenario(data, p, 2, [1, 1]);
  assert.deepEqual(baseline.predictive, { low: 21, median: 30, high: 39 });
  const changed = scenario(data, p, 2, [1.4, 0.6]);
  assert.ok(
    Math.abs(changed.predictive!.median - 30 - changed.delta.median) < 1e-10,
  );
  assert.equal(
    scenario(data, { ...p, predictiveMean: undefined }, 2, [1, 1]).predictive,
    null,
  );
});
