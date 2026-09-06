import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

void test('runtime setup overlays the matching adapter bootstrap and rejects mismatches', () => {
  const root = mkdtempSync(join(tmpdir(), 'mixlab-bootstrap-test-'));
  try {
    for (const dir of ['scripts', 'public/nuts', 'source'])
      mkdirSync(join(root, dir), { recursive: true });
    for (const name of ['setup-runtime.mjs', 'check-runtime.mjs'])
      cpSync(
        new URL(`../scripts/${name}`, import.meta.url),
        join(root, 'scripts', name),
      );
    const originals = {
      'nuts-worker-loader.js': 'old bootstrap',
      'kernel.bin': 'pinned kernel',
    };
    writeFileSync(
      join(root, 'runtime-manifest.json'),
      JSON.stringify({
        files: Object.entries(originals).map(([path, value]) => ({
          path,
          sha256: createHash('sha256').update(value).digest('hex'),
        })),
      }),
    );
    for (const [name, value] of Object.entries(originals))
      writeFileSync(join(root, 'source', name), value);
    writeFileSync(
      join(root, 'public/nuts/worker-loader.js'),
      'matching bootstrap',
    );
    const run = (name: string, ...args: string[]) =>
      execFileSync(process.execPath, [join(root, 'scripts', name), ...args], {
        stdio: 'pipe',
      });
    run('setup-runtime.mjs', '--from', join(root, 'source'));
    assert.equal(
      readFileSync(join(root, 'public/runtime/nuts-worker-loader.js'), 'utf8'),
      'matching bootstrap',
    );
    run('check-runtime.mjs');
    // An already upgraded runtime is also a valid --from source.
    run('setup-runtime.mjs', '--from', join(root, 'public/runtime'));
    run('check-runtime.mjs');
    writeFileSync(
      join(root, 'public/runtime/nuts-worker-loader.js'),
      'old bootstrap',
    );
    assert.throws(() => run('check-runtime.mjs'), /Checksum mismatch/);
    writeFileSync(join(root, 'source/kernel.bin'), 'corrupt kernel');
    assert.throws(
      () => run('setup-runtime.mjs', '--from', join(root, 'source')),
      /Runtime file mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
