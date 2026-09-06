import { interval, type Config, type Dataset } from './core.ts';

// Independent, repeatable streams keep unrelated draws fixed as a prior changes.
function random(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 + 0.5 / 4294967296;
  };
  const normal = () =>
    Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
  // Log space also handles shape parameters near zero without 0/0 beta draws.
  const logGamma = (shape: number): number => {
    if (shape < 1) return logGamma(shape + 1) + Math.log(uniform()) / shape;
    const d = shape - 1 / 3,
      c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = normal(),
        v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      const u = uniform();
      if (
        u < 1 - 0.0331 * x ** 4 ||
        Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))
      )
        return Math.log(d * v);
    }
  };
  return { uniform, normal, logGamma };
}

/** Monte Carlo preview of the guided MMM, including its default nuisance priors.
 * X and y use max-abs scaling; controls remain on their original scale.
 * No observed outcomes enter the simulation except the model's outcome scale.
 */
export function priorPredictive(data: Dataset, config: Config, draws = 300) {
  const n = data.y.length,
    scale = Math.max(...data.y.map(Math.abs)) || 1;
  const a = config.adstockPrior ?? { alpha: 1, beta: 3 };
  const s = config.saturationPrior ?? { alpha: 3, beta: 1 };
  const xScale = data.channels.map(
    (_, j) => Math.max(...data.x.map((r) => Math.abs(r[j]))) || 1,
  );
  const fourier = data.dates.map((date) => {
    const d = new Date(date);
    const day =
      (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1;
    return [1, 2].flatMap((k) => [
      Math.sin((2 * Math.PI * k * day) / 365.25),
      Math.cos((2 * Math.PI * k * day) / 365.25),
    ]);
  });
  const media: number[][] = [],
    outcome: number[][] = [];
  for (let draw = 0; draw < draws; draw++) {
    const stream = (key: number) =>
      random(config.seed + draw * 104729 + key * 15485863);
    const contributions = Array(n).fill(0) as number[];
    for (let j = 0; j < data.channels.length; j++) {
      const ar = stream(10 + j * 3),
        sr = stream(11 + j * 3);
      const la = ar.logGamma(a.alpha),
        lb = ar.logGamma(a.beta);
      const alpha = 1 / (1 + Math.exp(lb - la));
      const lam = Math.exp(sr.logGamma(s.alpha)) / s.beta;
      const beta = Math.abs(stream(12 + j * 3).normal()) * config.priorScale;
      const weights = Array.from({ length: config.lag }, (_, k) => alpha ** k);
      const denominator = weights.reduce((sum, w) => sum + w, 0) * xScale[j];
      for (let t = 0; t < n; t++) {
        let spend = 0;
        for (let k = 0; k < weights.length && k <= t; k++)
          spend += weights[k] * data.x[t - k][j];
        contributions[t] +=
          beta * Math.tanh((lam * spend) / denominator / 2) * scale;
      }
    }
    const r = stream(100),
      intercept = 2 * r.normal(),
      sigma = Math.abs(2 * r.normal());
    const controls = data.controls.map(() => 2 * r.normal());
    const seasonal = Array.from({ length: 4 }, () => {
      const u = r.uniform() - 0.5;
      return -Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    });
    const noise = stream(101);
    media.push(contributions);
    outcome.push(
      contributions.map(
        (v, t) =>
          v +
          scale *
            (intercept +
              controls.reduce((sum, b, j) => sum + b * data.z[t][j], 0) +
              (config.seasonality
                ? seasonal.reduce((sum, b, j) => sum + b * fourier[t][j], 0)
                : 0) +
              sigma * noise.normal()),
      ),
    );
  }
  const summarize = (samples: number[][]) => ({
    intervals: Array.from({ length: n }, (_, t) =>
      interval(samples.map((row) => row[t])),
    ),
    paths: samples.slice(0, 8),
  });
  return { outcome: summarize(outcome), media: summarize(media), draws };
}
