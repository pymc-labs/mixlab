export type RawTable = {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  example: boolean;
};
export type Mapping = {
  date: string;
  target: string;
  channels: string[];
  controls: string[];
};
export type Dataset = {
  dates: string[];
  y: number[];
  channels: string[];
  x: number[][];
  controls: string[];
  z: number[][];
};
export type ShapePrior = { alpha: number; beta: number };
export type Config = {
  lag: number;
  seasonality: boolean;
  chains: number;
  tune: number;
  draws: number;
  targetAccept: number;
  seed: number;
  priorScale: number;
  adstockPrior?: ShapePrior;
  saturationPrior?: ShapePrior;
};
export const defaultConfig: Config = {
  lag: 8,
  seasonality: true,
  chains: 4,
  tune: 1000,
  draws: 1000,
  targetAccept: 0.95,
  seed: 42,
  priorScale: 2,
};
export type Interval = { low: number; median: number; high: number };
export type DiagnosticPlot = {
  name: string;
  chains: number[][];
  divergences: number[][];
  rank?: { x: number[]; y: number[] }[];
  envelope?: { x: number[]; low: number[]; high: number[] };
  ess?: { x: number[]; y: (number | null)[] };
  rankError?: string;
  essError?: string;
};
export type Posterior = {
  diagnosticPlots?: DiagnosticPlot[];
  alpha: number[][];
  lam: number[][];
  beta: number[][];
  channelScale: number[];
  targetScale: number;
  contributions: Interval[];
  /** Paired posterior predictive average-week draws, including observation noise. */
  predictiveMean?: number[];
  prediction: { low: number[]; median: number[]; high: number[] };
  diagnostics: {
    maxRhat: number | null;
    minEss: number | null;
    minTailEss: number | null;
    divergences: number;
    compileSeconds: number;
    samplingSeconds: number;
  };
};
export const colors = [
  '#b5f268',
  '#b3a5ff',
  '#6ad9e9',
  '#f4be73',
  '#ed98bf',
  '#82b9ff',
  '#f0937e',
  '#d4dd88',
];
export const label = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const compact = (n: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
export const number = (n: number, d = 0) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: d }).format(n);

/** RFC-4180-style CSV parsing, including quoted commas/newlines and escaped quotes. */
export function parseCSV(text: string, name = 'Imported dataset'): RawTable {
  if (text.length > 5_000_000) throw Error('Choose a CSV smaller than 5 MB.');
  text = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const pushField = () => {
    row.push(field.trim());
    field = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw Error('A quoted CSV value is malformed.');
      quoted = true;
    } else if (c === ',') pushField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushField();
      if (row.some((v) => v !== '')) records.push(row);
      row = [];
    } else if (closed) {
      if (c !== ' ' && c !== '\t')
        throw Error('Unexpected text after a quoted CSV value.');
    } else field += c;
  }
  if (quoted) throw Error('A quoted CSV value is missing its closing quote.');
  pushField();
  if (row.some((v) => v !== '')) records.push(row);
  const headers = records.shift();
  if (!headers || headers.length < 3)
    throw Error(
      'Include a date, an outcome, and at least one spend column. Use comma-separated CSV.',
    );
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw Error('Column names must be nonempty and unique.');
  if (headers.length > 60) throw Error('Use at most 60 columns.');
  if (records.length > 520)
    throw Error(
      'This browser edition supports at most 520 weekly observations.',
    );
  const rows = records.map((r, i) => {
    if (r.length !== headers.length)
      throw Error(
        `Row ${i + 2} has ${r.length} values; expected ${headers.length}.`,
      );
    return Object.fromEntries(headers.map((h, j) => [h, r[j]]));
  });
  return { name, headers, rows, example: false };
}
export function inferMapping(t: RawTable): Mapping {
  const date = t.headers.find((h) => /date|week/i.test(h)) ?? t.headers[0];
  const target =
    t.headers.find((h) => /revenue|sales|outcome|^y$/i.test(h)) ??
    t.headers.find((h) => h !== date) ??
    '';
  const rest = t.headers.filter((h) => h !== date && h !== target);
  const controls = rest.filter((h) =>
    /event|trend|control|price|holiday|^t$/i.test(h),
  );
  return {
    date,
    target,
    channels: rest.filter((h) => !controls.includes(h)).slice(0, 8),
    controls,
  };
}
export function validate(
  t: RawTable,
  m: Mapping,
): { data: Dataset | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [],
    warnings: string[] = [];
  if (t.rows.length < 52)
    errors.push(
      'At least 52 weeks are required; two or more years are preferable.',
    );
  if (m.channels.length < 1 || m.channels.length > 8)
    errors.push('Select between 1 and 8 marketing channels.');
  const cols = [m.date, m.target, ...m.channels, ...m.controls];
  if (new Set(cols).size !== cols.length)
    errors.push('Each column must have only one role.');
  if (cols.some((h) => !t.headers.includes(h)))
    errors.push('Map every role to an existing column.');
  const dates: string[] = [],
    y: number[] = [],
    x: number[][] = [],
    z: number[][] = [];
  const numeric = (
    r: Record<string, string>,
    col: string,
    i: number,
    nonnegative: boolean,
  ) => {
    const raw = r[col]?.trim();
    const v = Number(raw);
    if (!raw || !Number.isFinite(v) || (nonnegative && v < 0)) {
      if (errors.length < 8)
        errors.push(
          `Row ${i + 2}, ${col}: enter a ${nonnegative ? 'nonnegative ' : ''}number without currency symbols.`,
        );
      return 0;
    }
    return v;
  };
  t.rows.forEach((r, i) => {
    const date = r[m.date] ?? '';
    const d = new Date(date + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(d.valueOf()) ||
      d.toISOString().slice(0, 10) !== date
    ) {
      if (errors.length < 8)
        errors.push(`Row ${i + 2}: dates must be valid YYYY-MM-DD values.`);
    }
    dates.push(date);
    y.push(numeric(r, m.target, i, true));
    x.push(m.channels.map((c) => numeric(r, c, i, true)));
    z.push(m.controls.map((c) => numeric(r, c, i, false)));
  });
  if (errors.length === 0) {
    const times = dates.map((d) => Date.parse(d + 'T00:00:00Z'));
    if (times.some((v, i) => i > 0 && v - times[i - 1] !== 7 * 86400000))
      errors.push(
        'Sort the data by date and provide exactly one row per week, with no gaps or duplicates.',
      );
    if (Math.max(...y) === Math.min(...y))
      errors.push('The outcome must vary over time.');
    m.channels.forEach((c, j) => {
      const v = x.map((r) => r[j]);
      if (Math.max(...v) === Math.min(...v))
        errors.push(
          `${label(c)} has no variation. Remove it or provide varying spend.`,
        );
    });
    m.controls.forEach((c, j) => {
      const v = z.map((r) => r[j]);
      if (Math.max(...v) === Math.min(...v))
        errors.push(`${label(c)} is constant. Remove it from controls.`);
    });
    if (t.rows.length < 104)
      warnings.push(
        'Less than two years: annual seasonality and slow carryover may be difficult to identify.',
      );
    if (m.channels.length > 4)
      warnings.push(
        'Larger channel sets need more memory and can be harder to identify.',
      );
    for (let a = 0; a < m.channels.length; a++)
      for (let b = a + 1; b < m.channels.length; b++) {
        const u = x.map((r) => r[a]),
          v = x.map((r) => r[b]),
          mu = u.reduce((s, n) => s + n, 0) / u.length,
          mv = v.reduce((s, n) => s + n, 0) / v.length;
        const corr =
          u.reduce((s, n, i) => s + (n - mu) * (v[i] - mv), 0) /
          Math.sqrt(
            u.reduce((s, n) => s + (n - mu) ** 2, 0) *
              v.reduce((s, n) => s + (n - mv) ** 2, 0),
          );
        if (Math.abs(corr) > 0.9)
          warnings.push(
            `${label(m.channels[a])} and ${label(m.channels[b])} move together (correlation ${corr.toFixed(2)}). Their separate effects may be hard to identify.`,
          );
      }
  }
  return {
    data: errors.length
      ? null
      : {
          dates,
          y,
          channels: [...m.channels],
          x,
          controls: [...m.controls],
          z,
        },
    errors,
    warnings,
  };
}
export function canonicalCSV(data: Dataset): string {
  const lines = [
    [
      'date',
      'y',
      ...data.channels.map((_, i) => `channel_${i}`),
      ...data.controls.map((_, i) => `control_${i}`),
    ].join(','),
  ];
  data.dates.forEach((d, i) =>
    lines.push([d, data.y[i], ...data.x[i], ...data.z[i]].join(',')),
  );
  return lines.join('\n');
}
export function quantile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const k = (s.length - 1) * p,
    a = Math.floor(k);
  return s[a] + (s[Math.min(a + 1, s.length - 1)] - s[a]) * (k - a);
}
export function interval(xs: number[]): Interval {
  return {
    low: quantile(xs, 0.05),
    median: quantile(xs, 0.5),
    high: quantile(xs, 0.95),
  };
}
export function healthy(p: Posterior) {
  const d = p.diagnostics;
  return (
    d.maxRhat !== null &&
    d.maxRhat <= 1.01 &&
    d.minEss !== null &&
    d.minEss >= 400 &&
    d.minTailEss !== null &&
    d.minTailEss >= 400 &&
    d.divergences === 0
  );
}
/** Exact finite normalized geometric adstock followed by beta*tanh(lam*x/2).
 * Counterfactual multiplies the historical spend series; it is not a future forecast.
 */
export function channelResponse(
  x: number[],
  alpha: number,
  lam: number,
  beta: number,
  lag: number,
  channelScale: number,
  targetScale: number,
  multiplier = 1,
) {
  let weightSum = 0;
  for (let k = 0; k < lag; k++) weightSum += alpha ** k;
  let total = 0;
  for (let t = 0; t < x.length; t++) {
    let adstock = 0;
    for (let k = 0; k < lag && k <= t; k++) adstock += x[t - k] * alpha ** k;
    total +=
      beta *
      Math.tanh((lam * adstock * multiplier) / (channelScale * weightSum) / 2) *
      targetScale;
  }
  return total / x.length;
}
export function scenario(
  data: Dataset,
  p: Posterior,
  lag: number,
  multipliers: number[],
) {
  const n = p.alpha.length,
    base = Array(n).fill(0) as number[],
    changed = Array(n).fill(0) as number[];
  const channels = data.channels.map((_, j) => {
    const x = data.x.map((r) => r[j]),
      a: number[] = [],
      b: number[] = [];
    for (let i = 0; i < n; i++) {
      const before = channelResponse(
        x,
        p.alpha[i][j],
        p.lam[i][j],
        p.beta[i][j],
        lag,
        p.channelScale[j],
        p.targetScale,
      );
      const after = channelResponse(
        x,
        p.alpha[i][j],
        p.lam[i][j],
        p.beta[i][j],
        lag,
        p.channelScale[j],
        p.targetScale,
        multipliers[j],
      );
      a.push(before);
      b.push(after);
      base[i] += before;
      changed[i] += after;
    }
    return { baseline: interval(a), changed: interval(b) };
  });
  const delta = changed.map((v, i) => v - base[i]);
  return {
    channels,
    baseline: interval(base),
    changed: interval(changed),
    delta: interval(delta),
    predictive: p.predictiveMean
      ? interval(p.predictiveMean.map((v, i) => v + delta[i]))
      : null,
    predictiveBaseline: p.predictiveMean ? interval(p.predictiveMean) : null,
    probabilityPositive: delta.filter((v) => v > 0).length / n,
  };
}
export function download(
  name: string,
  body: string | Uint8Array,
  type = 'application/json',
) {
  const blob = new Blob(
    [typeof body === 'string' ? body : Uint8Array.from(body)],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
