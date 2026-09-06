import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('worker suppresses only optional IProgress warnings, preserving inference warnings', () => {
  const source = readFileSync(
    new URL('../public/nuts/compile_model.py', import.meta.url),
    'utf8',
  );
  const setup = source.slice(0, source.indexOf('\nimport json'));
  const check = spawnSync(
    'python3',
    [
      '-c',
      `${setup}
with warnings.catch_warnings(record=True) as seen:
    warnings.warn_explicit('IProgress not found. Please update jupyter and ipywidgets.', UserWarning, 'auto.py', 21, module='tqdm.auto')
    warnings.warn_explicit('Divergences found', UserWarning, 'sample.py', 1, module='pymc.sampling')
    warnings.warn_explicit('IProgress not found elsewhere', UserWarning, 'custom.py', 1, module='custom')
    assert len(seen) == 2, [str(w.message) for w in seen]
    assert str(seen[0].message) == 'Divergences found'
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(check.status, 0, check.stderr);
});
