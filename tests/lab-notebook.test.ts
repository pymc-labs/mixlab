import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { makeLabNotebook } from '../public/lab-notebook.mjs';

test('edited lab notebook preserves Unicode, multiline code, settings and follow-up through Python', () => {
  const payload = {
    source: '# Grüße 🧪\nname = "quoted \\"text\\""\npath = r"C:\\tmp"\n',
    csv: 'date,y,search\n2024-01-01,42,5\n',
    config: {
      chains: 4,
      draws: 1000,
      tune: 1000,
      targetAccept: 0.95,
      seed: 42,
    },
    varNames: ['beta', 'λ'],
    afterSample: 'idata = sampler_result\nprint("done")',
    followup: 'print(idata.posterior.sizes)\n# keep my analysis',
  };
  const nb = makeLabNotebook(payload, 'https://example.com');
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import ast, json, sys
nb = json.load(sys.stdin)
scope = {}
for cell in nb['cells']:
    if cell['cell_type'] == 'code':
        source = ''.join(cell['source'])
        ast.parse(source)
        if cell['id'] != 'launch':
            exec(compile(source, '<notebook>', 'exec'), scope)
print(json.dumps({k: scope[v] for k, v in dict(source='model_source', csv='csv_text', config='sampling_options', varNames='variable_names', afterSample='after_sample', followup='followup_code').items()}))
`,
    ],
    { input: JSON.stringify(nb), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout.trim().split('\n').at(-1)!),
    payload,
  );
  assert.equal(nb.nbformat, 4);
});
