import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeWeight,
  normalizeWeights,
  createPlanner,
  channelSlice,
  defaultPreferences,
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

void test('every channel slice passes through the current scenario and respects budget mode', () => {
  const planner = createPlanner(data, p, 2);
  for (const locked of [false, true]) {
    const w = locked ? [0.63, 0.37] : [0.63, 0.7];
    for (let j = 0; j < 2; j++) {
      const points = channelSlice(planner, w, j, locked, 1, 0.5);
      const current = points.find((point) => point.share === w[j])!;
      assert.deepEqual(
        current.predictive,
        planner.summarize(w, 1, 0.5).predictive,
      );
      const end = points.at(-1)!;
      const expected = locked
        ? changeWeight(w, j, 1, planner.prior)
        : w.map((v, i) => (i === j ? 1 : v));
      assert.deepEqual(
        end.predictive,
        planner.summarize(expected, 1, 0.5).predictive,
      );
    }
  }
});
void test('prior and risk reshape the objective without inventing a different sales response', () => {
  const planner = createPlanner(
    data,
    {
      ...p,
      beta: [
        [4, 1],
        [1, 4],
      ],
    },
    2,
  );
  const free = channelSlice(planner, [0.7, 0.3], 0, true, 0, 0);
  const close = channelSlice(planner, [0.7, 0.3], 0, true, 5, 2);
  for (let i = 0; i < free.length; i++)
    assert.deepEqual(free[i].predictive, close[i].predictive);
  assert.ok(close[0].score < free[0].score);
});
void test('sales projection matches paired scenario predictive draws and handles budgets above 100 percent', () => {
  const planner = createPlanner(data, p, 2);
  const weights = [1.3, 0.4];
  const predicted = planner.summarize(weights, 0, 0).predictive!;
  const exact = scenario(
    data,
    p,
    2,
    weights.map((w, i) => w / planner.prior[i]),
  ).predictive!;
  for (const key of ['low', 'median', 'high'] as const)
    assert.ok(Math.abs(predicted[key] - exact[key]) < 1e-10);
});
void test('legacy fits show only contribution uncertainty', () => {
  const planner = createPlanner(data, { ...p, predictiveMean: undefined }, 2);
  assert.equal(planner.summarize([0.7, 0.3], 1, 1).predictive, null);
  assert.ok(
    channelSlice(planner, [0.7, 0.3], 0, true, 1, 1).every(
      (p) => p.predictive === null,
    ),
  );
});

void test('the default example suggestion improves expected sales at the original budget', () => {
  const planner = createPlanner(data, p, 2);
  const { adherence, risk } = defaultPreferences;
  const weights = planner.optimize(adherence, risk);
  const result = planner.summarize(weights, adherence, risk);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(result.mean > 0);
  assert.ok(result.score > 0);
  assert.ok(
    result.predictive!.median >
      planner.summarize(planner.prior, 0, 0).predictive!.median,
  );
  // An example with indistinguishable channels should keep the observed mix.
  const balanced = createPlanner(
    data,
    {
      ...p,
      beta: [
        [1, 1],
        [1, 1],
      ],
    },
    2,
  );
  assert.deepEqual(balanced.optimize(adherence, risk), balanced.prior);
});
