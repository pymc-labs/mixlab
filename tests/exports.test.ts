import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCSV,
  inferMapping,
  validate,
  defaultConfig,
} from '../lib/core.ts';
import {
  notebook,
  readProject,
  modelSource,
  labPayload,
} from '../lib/exports.ts';
const raw = parseCSV(
  readFileSync(new URL('../public/example.csv', import.meta.url), 'utf8'),
);
const mapping = inferMapping(raw),
  data = validate(raw, mapping).data!;
const saved = {
  format: 'mixlab-project',
  version: 1,
  dataset: raw,
  mapping,
  config: defaultConfig,
  posterior: null,
};
test('native notebook embeds data and all model settings', () => {
  const nb = notebook(data, defaultConfig, 'native', 'https://example.com');
  assert.equal(nb.nbformat, 4);
  assert.ok(nb.cells.some((c) => c.source.join('').includes('csv_text =')));
  assert.ok(nb.cells.some((c) => c.source.join('').includes('chains=4')));
  assert.ok(nb.cells.every((c) => c.id));
  assert.ok(
    !nb.cells.some((c) => c.source.join('').includes('/mixlab-config.json')),
  );
});
test('browser notebook carries model and data in fragment, not query parameters', () => {
  const nb = notebook(data, defaultConfig, 'browser', 'https://example.com');
  const text = nb.cells.map((c) => c.source.join('')).join('\n');
  assert.ok(text.includes('/notebook.html#'));
  assert.ok(text.includes('variable_names'));
  assert.ok(text.includes('Nothing executes until'));
  const payload = labPayload(data, defaultConfig);
  assert.ok(payload.source.includes("pd.read_csv('/mixlab-data.csv'"));
  assert.ok(payload.varNames.includes('channel_contribution'));
});
test('project import restores a validated data/config snapshot', () => {
  const restored = readProject(JSON.stringify(saved));
  assert.deepEqual(restored.config, defaultConfig);
  assert.equal(restored.dataset.rows.length, 179);
  assert.equal(restored.posterior, null);
});
test('project import rejects unsupported settings and malformed posteriors', () => {
  assert.throws(() =>
    readProject(
      JSON.stringify({ ...saved, config: { ...defaultConfig, chains: 100 } }),
    ),
  );
  assert.throws(() =>
    readProject(JSON.stringify({ ...saved, posterior: { alpha: [[1]] } })),
  );
  assert.throws(() =>
    readProject(JSON.stringify({ ...saved, format: 'different' })),
  );
});
