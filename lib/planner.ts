import { interval, type Dataset, type Posterior } from './core.ts';

export const defaultPreferences = { adherence: 1, risk: 0.5 } as const;

export function normalizeWeights(
  values: number[],
  fallback?: number[],
): number[] {
  const clean = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  return sum > 0
    ? clean.map((v) => v / sum)
    : fallback
      ? normalizeWeights(fallback)
      : clean.map(() => 1 / clean.length);
}

/** Move one share while redistributing the remainder proportionally. */
export function changeWeight(
  weights: number[],
  channel: number,
  value: number,
  prior: number[],
) {
  if (weights.length === 1) return [1];
  const w = Math.max(0, Math.min(1, value));
  const others = weights.map((v, i) => (i === channel ? 0 : v));
  let sum = others.reduce((a, b) => a + b, 0);
  if (sum < 1e-12) {
    others.forEach((_, i) => {
      others[i] = i === channel ? 0 : prior[i];
    });
    sum = others.reduce((a, b) => a + b, 0);
  }
  return others.map((v, i) =>
    i === channel
      ? w
      : (1 - w) * (sum > 0 ? v / sum : 1 / (weights.length - 1)),
  );
}

/** Cache per-draw response curves on a 1 percentage point allocation grid.
 * Interpolate contributions, then sum matching draws to preserve covariance.
 */
export function createPlanner(data: Dataset, p: Posterior, lag: number) {
  const spend = data.channels.map(
    (_, j) => data.x.reduce((s, r) => s + r[j], 0) / data.x.length,
  );
  const total = spend.reduce((a, b) => a + b, 0);
  const prior = normalizeWeights(spend);
  const n = p.alpha.length;
  const curves = data.channels.map((_, j) => {
    const grid = Array.from({ length: 201 }, () => new Float64Array(n));
    for (let d = 0; d < n; d++) {
      const a = p.alpha[d][j];
      let norm = 0;
      for (let k = 0; k < lag; k++) norm += a ** k;
      const xs = data.x.map((_, t) => {
        let x = 0;
        for (let k = 0; k < lag && k <= t; k++) x += data.x[t - k][j] * a ** k;
        return (p.lam[d][j] * x) / (2 * p.channelScale[j] * norm);
      });
      for (let g = 0; g <= 200; g++) {
        const multiplier = spend[j] > 0 ? (total * g) / 100 / spend[j] : 0;
        grid[g][d] =
          (xs.reduce((s, x) => s + Math.tanh(x * multiplier), 0) / xs.length) *
          p.beta[d][j] *
          p.targetScale;
      }
    }
    return grid;
  });
  const draws = (weights: number[]) =>
    Array.from({ length: n }, (_, d) =>
      weights.reduce((s, w, j) => {
        const g = Math.max(0, Math.min(200, w * 100)),
          lo = Math.floor(g),
          hi = Math.min(200, lo + 1);
        return (
          s + curves[j][lo][d] * (1 - (g - lo)) + curves[j][hi][d] * (g - lo)
        );
      }, 0),
    );
  const baseline = draws(prior);
  // Scale penalties by baseline expected channel contribution, keeping controls interpretable across units.
  const scale = Math.max(1e-9, baseline.reduce((a, b) => a + b, 0) / n);
  const evaluate = (weights: number[], adherence: number, risk: number) => {
    const outcomes = draws(weights);
    const delta = outcomes.map((v, i) => v - baseline[i]);
    const mean = delta.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(delta.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    const distance = weights.reduce((s, w, j) => s + (w - prior[j]) ** 2, 0);
    return {
      mean,
      sd,
      score: mean / scale - (risk * sd) / scale - adherence * distance,
      delta,
    };
  };
  const optimize = (adherence: number, risk: number) => {
    let weights = [...prior],
      best = evaluate(weights, adherence, risk).score;
    for (const step of [0.1, 0.05, 0.02, 0.01]) {
      for (let iter = 0; iter < 100; iter++) {
        let next = weights,
          nextScore = best;
        for (let from = 0; from < weights.length; from++)
          for (let to = 0; to < weights.length; to++) {
            if (from === to || weights[from] < step) continue;
            const candidate = [...weights];
            candidate[from] -= step;
            candidate[to] += step;
            const score = evaluate(candidate, adherence, risk).score;
            if (score > nextScore + 1e-10) {
              next = candidate;
              nextScore = score;
            }
          }
        if (next === weights) break;
        weights = next;
        best = nextScore;
      }
    }
    return weights;
  };
  const summarize = (weights: number[], adherence: number, risk: number) => {
    const result = evaluate(weights, adherence, risk);
    return {
      ...result,
      interval: interval(result.delta),
      predictive: p.predictiveMean
        ? interval(result.delta.map((v, i) => v + p.predictiveMean![i]))
        : null,
    };
  };
  return { prior, total, evaluate, summarize, optimize };
}

export type Planner = ReturnType<typeof createPlanner>;

/** Slices pass through the actual allocation, including variable-budget scenarios. */
export function channelSlice(
  planner: Planner,
  weights: number[],
  channel: number,
  locked: boolean,
  adherence: number,
  risk: number,
) {
  const max = locked ? 1 : Math.max(1, planner.prior[channel] * 2);
  const points = Array.from({ length: 51 }, (_, i) => {
    const share = (max * i) / 50;
    const next = locked
      ? changeWeight(weights, channel, share, planner.prior)
      : weights.map((v, j) => (j === channel ? share : v));
    return {
      share: next[channel],
      ...planner.summarize(next, adherence, risk),
    };
  });
  points.push({
    share: weights[channel],
    ...planner.summarize(weights, adherence, risk),
  });
  return points.sort((a, b) => a.share - b.share);
}
