import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, validate, scenario, type Posterior } from '../lib/core.ts';
import {
  createWorkspace,
  workspaceReducer as act,
  selectedFit,
  settingsMatch,
  parseWorkspace,
  describeChanges,
  type CompletedFit,
  type Workspace,
} from '../lib/workspace.ts';

const raw = parseCSV(
  readFileSync(new URL('../public/example.csv', import.meta.url), 'utf8'),
  'Example',
);
function completed(w: Workspace, number = 1): CompletedFit {
  const k = w.draft.mapping.channels.length,
    rows = raw.rows.length;
  const n = w.draft.config.chains * w.draft.config.draws;
  const posterior: Posterior = {
    alpha: Array.from({ length: n }, () => Array(k).fill(0.5)),
    beta: Array.from({ length: n }, () => Array(k).fill(number)),
    lam: Array.from({ length: n }, () => Array(k).fill(1)),
    channelScale: Array(k).fill(100),
    targetScale: 100,
    contributions: Array.from({ length: k }, () => ({
      low: number,
      median: 2 * number,
      high: 3 * number,
    })),
    prediction: {
      low: Array(rows).fill(1),
      median: Array(rows).fill(2),
      high: Array(rows).fill(3),
    },
    diagnostics: {
      maxRhat: 1.001,
      minEss: 500,
      minTailEss: 490,
      divergences: 0,
      compileSeconds: 2,
      samplingSeconds: 3,
    },
  };
  return {
    ...structuredClone(w.draft),
    id: `fit-${number}`,
    number,
    completedAt: '2026-09-06T12:00:00.000Z',
    posterior,
    artifact: {
      model: 'model = original_model',
      analysis: 'original_analysis()',
      runtime: 'pinned-runtime',
    },
  };
}
function withFit() {
  const w = createWorkspace(raw);
  return act(w, { type: 'complete', fit: completed(w) });
}
void test('A → edit priors and sampling → B → reload preserves both fits and the separate draft', () => {
  let w = withFit();
  const first = selectedFit(w)!;
  w = act(w, {
    type: 'configure',
    patch: { lag: 16, draws: 500, adstockPrior: { alpha: 4, beta: 2 } },
  });
  assert.equal(selectedFit(w), first);
  assert.equal(selectedFit(w)!.config.lag, 8);
  assert.equal(settingsMatch(w.draft.config, first.config), false);
  w = act(w, {
    type: 'complete',
    fit: completed(w, 2),
    multipliers: [0.5, 1.5],
  });
  w = act(w, { type: 'configure', patch: { priorScale: 3 } });
  const restored = parseWorkspace(JSON.stringify(w));
  assert.equal(restored.fits.length, 2);
  assert.equal(selectedFit(restored)!.number, 2);
  assert.equal(restored.draft.config.priorScale, 3);
  assert.equal(selectedFit(restored)!.config.priorScale, 2);
  assert.deepEqual(restored.fits[0].artifact, first.artifact);
  assert.equal(restored.fits[0].posterior.alpha.length, 4000);
  assert.equal(restored.fits[1].posterior.alpha.length, 2000);
  assert.deepEqual(restored.scenarios['fit-2'], [0.5, 1.5]);
});
void test('viewing a fit preserves edited assumptions; restoring its settings is explicit', () => {
  let w = withFit();
  w = act(w, { type: 'configure', patch: { lag: 16 } });
  w = act(w, { type: 'complete', fit: completed(w, 2) });
  w = act(w, { type: 'configure', patch: { priorScale: 3 } });
  w = act(w, { type: 'select', id: 'fit-1' });
  assert.equal(selectedFit(w)!.config.lag, 8);
  assert.equal(w.draft.config.lag, 16);
  assert.equal(w.draft.config.priorScale, 3);
  w = act(w, { type: 'use-settings', id: 'fit-1' });
  assert.equal(settingsMatch(w.draft.config, selectedFit(w)!.config), true);
  assert.equal(w.fits.length, 2);
});
void test('scenario calculations remain tied to the saved lag after editing current settings', () => {
  let w = withFit();
  const data = validate(raw, w.draft.mapping).data!;
  const multipliers = [0.5, 1.5];
  const before = scenario(
    data,
    selectedFit(w)!.posterior,
    selectedFit(w)!.config.lag,
    multipliers,
  );
  w = act(w, { type: 'configure', patch: { lag: 2 } });
  const f = selectedFit(w)!;
  assert.deepEqual(
    scenario(data, f.posterior, f.config.lag, multipliers),
    before,
  );
  assert.notDeepEqual(
    scenario(data, f.posterior, w.draft.config.lag, multipliers),
    before,
  );
});
void test('new datasets and incomplete mappings hide incompatible results without deleting history', () => {
  let w = withFit();
  const other = structuredClone(raw);
  other.rows[0][w.draft.mapping.target] = '123';
  w = act(w, { type: 'data', dataset: other });
  assert.equal(selectedFit(w), null);
  w = act(w, {
    type: 'mapping',
    mapping: { ...w.draft.mapping, date: 'missing' },
  });
  w = parseWorkspace(JSON.stringify(w));
  assert.equal(w.draft.mapping.date, 'missing');
  assert.equal(w.fits.length, 1);
  w = act(w, { type: 'select', id: 'fit-1' });
  assert.equal(selectedFit(w)!.number, 1);
  assert.deepEqual(w.draft.dataset.rows, raw.rows);
});
void test('completed snapshots are isolated and history never silently drops the fifth fit', () => {
  let w = createWorkspace(raw);
  const f = completed(w);
  w = act(w, { type: 'complete', fit: f });
  f.config.lag = 2;
  f.posterior.alpha[0][0] = 0.9;
  assert.equal(w.fits[0].config.lag, 8);
  assert.equal(w.fits[0].posterior.alpha[0][0], 0.5);
  for (let n = 2; n <= 5; n++)
    w = act(w, { type: 'complete', fit: completed(w, n) });
  assert.equal(parseWorkspace(JSON.stringify(w)).fits.length, 5);
  // Unsuccessful attempts do not dispatch complete; settings alone cannot erase evidence.
  w = act(w, { type: 'configure', patch: { seed: 123 } });
  assert.equal(selectedFit(w)!.number, 5);
});
void test('scenario choices belong to each fit, not whichever settings are edited', () => {
  let w = withFit();
  w = act(w, { type: 'scenario', multipliers: [0.5, 1.5] });
  w = act(w, { type: 'complete', fit: completed(w, 2) });
  w = act(w, { type: 'scenario', multipliers: [1, 1] });
  w = act(parseWorkspace(JSON.stringify(w)), { type: 'select', id: 'fit-1' });
  assert.deepEqual(w.scenarios[selectedFit(w)!.id], [0.5, 1.5]);
});
void test('legacy project files migrate to one saved fit without fabricating original source', () => {
  const w = withFit();
  const old = {
    format: 'mixlab-project',
    version: 1,
    ...w.draft,
    posterior: selectedFit(w)!.posterior,
  };
  const restored = parseWorkspace(JSON.stringify(old));
  assert.equal(restored.version, 2);
  assert.equal(restored.fits.length, 1);
  assert.equal(restored.fits[0].artifact, null);
  assert.equal(restored.fits[0].completedAt, '');
});
void test('imports validate every run against its own sampling settings and reject broken history', () => {
  const w = withFit();
  for (const breakIt of [
    (v: Workspace) => {
      v.fits[0].config.draws = 500;
    },
    (v: Workspace) => {
      v.fits.push(v.fits[0]);
    },
    (v: Workspace) => {
      v.selectedFitId = 'unknown';
    },
    (v: Workspace) => {
      v.fits[0].artifact = { model: 123 } as never;
    },
    (v: Workspace) => {
      v.fits[0].posterior = null as never;
    },
  ]) {
    const broken = structuredClone(w);
    breakIt(broken);
    assert.throws(() => parseWorkspace(JSON.stringify(broken)));
  }
});
void test('default prior spelling does not create a false changed-settings warning', () => {
  const c = createWorkspace(raw).draft.config;
  assert.ok(
    settingsMatch(c, {
      ...c,
      adstockPrior: { alpha: 1, beta: 3 },
      saturationPrior: { alpha: 3, beta: 1 },
    }),
  );
  assert.deepEqual(describeChanges(c, { ...c, lag: 12, seed: 123 }), [
    'carryover 8 → 12 weeks',
    'seed 42 → 123',
  ]);
});
