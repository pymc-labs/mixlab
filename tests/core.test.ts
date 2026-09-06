import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCSV,
  inferMapping,
  validate,
  canonicalCSV,
  channelResponse,
  scenario,
  interval,
  healthy,
  type Posterior,
} from '../lib/core.ts';
const example = parseCSV(
  readFileSync(new URL('../public/example.csv', import.meta.url), 'utf8'),
);
const mapping = inferMapping(example),
  data = validate(example, mapping).data!;
test('real synthetic fixture passes weekly data validation and canonical roundtrip', () => {
  assert.equal(data.y.length, 179);
  assert.equal(data.channels.length, 2);
  const r = parseCSV(canonicalCSV(data));
  assert.equal(r.rows.length, 179);
  assert.equal(Number(r.rows[0].y), data.y[0]);
});
test('CSV handles BOM, escaped quotes, comma and newline in quoted cells', () => {
  const t = parseCSV(
    '\ufeffdate,revenue,"paid, search"\r\n2024-01-01,12,"say ""yes""\nagain"\r\n',
  );
  assert.equal(t.headers[2], 'paid, search');
  assert.equal(t.rows[0]['paid, search'], 'say "yes"\nagain');
});
test('malformed CSV and duplicate headers reject', () => {
  assert.throws(() => parseCSV('date,y,y\n2024-01-01,2,3'));
  assert.throws(() => parseCSV('date,y,x\na,2,"oops'));
  assert.throws(() => parseCSV('date,y,x\na,2'));
  assert.throws(() => parseCSV('date,y,x\na,2,"x"bad'));
});
test('invalid calendar dates, gaps and negative spend reject', () => {
  for (const [col, value] of [
    ['date', '2024-02-30'],
    ['date', '2018-04-03'],
    ['paid_search', '-2'],
    ['revenue', ''],
  ]) {
    const t = structuredClone(example);
    t.rows[0][col] = value;
    assert.ok(validate(t, mapping).errors.length);
  }
});
test('duplicate roles and constant channels reject', () => {
  assert.ok(
    validate(example, { ...mapping, channels: [mapping.target] }).errors.length,
  );
  const t = structuredClone(example);
  t.rows.forEach((r) => (r.paid_search = '10'));
  assert.ok(
    validate(t, mapping).errors.some((e) => e.includes('no variation')),
  );
});
test('response matches exact normalized finite geometric convolution', () => {
  const x = [2, 0, 0],
    a = 0.5,
    w = [1, 0.5, 0.25],
    expected =
      w
        .map((v) => 2 * Math.tanh((3 * ((2 * v) / 1.75)) / 2))
        .reduce((s, v) => s + v, 0) / 3;
  assert.ok(Math.abs(channelResponse(x, a, 3, 2, 3, 1, 1) - expected) < 1e-12);
  assert.equal(channelResponse(x, a, 3, 2, 3, 1, 1, 0), 0);
});
test('paired scenario leaves unchanged spend exactly unchanged and zero spend removes contributions', () => {
  const p: Posterior = {
    alpha: [
      [0.2, 0.4],
      [0.6, 0.5],
    ],
    beta: [
      [1, 2],
      [1.2, 1.8],
    ],
    lam: [
      [3, 2],
      [2, 4],
    ],
    channelScale: [10000, 10000],
    targetScale: 100000,
    contributions: [],
    prediction: { low: [], median: [], high: [] },
    diagnostics: {
      maxRhat: 1,
      minEss: 500,
      minTailEss: 500,
      divergences: 0,
      compileSeconds: 1,
      samplingSeconds: 1,
    },
  };
  const same = scenario(data, p, 8, [1, 1]);
  assert.deepEqual(same.delta, { low: 0, median: 0, high: 0 });
  const zero = scenario(data, p, 8, [0, 0]);
  assert.deepEqual(zero.changed, { low: 0, median: 0, high: 0 });
  assert.ok(zero.delta.high < 0);
  assert.ok(healthy(p));
  assert.ok(
    !healthy({ ...p, diagnostics: { ...p.diagnostics, maxRhat: null } }),
  );
});
test('quantile interpolation and interval ordering', () => {
  assert.deepEqual(interval([0, 10]), { low: 0.5, median: 5, high: 9.5 });
});
