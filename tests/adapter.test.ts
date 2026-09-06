import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { sample } from '../public/nuts/bridge.mjs';

const assets = new URL('../public/nuts/', import.meta.url);
void test('adapter assets match the pinned build, including the local warning patch', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../adapter-manifest.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    readdirSync(assets).sort(),
    Object.keys(manifest.files).sort(),
  );
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(name, assets)))
        .digest('hex'),
      expected,
      name,
    );
  }
});

void test('bundled WASM supports seeded jitter, retained binary draws and Arrow traces', async () => {
  const bytes = readFileSync(new URL('nuts_browser_adapter.wasm', assets));
  const memory = new WebAssembly.Memory({ initial: 1 });
  const runtime = {
    wasmMemory: memory,
    wasmTable: {
      get: () => (xp: number, gp: number) => {
        const x = new Float64Array(memory.buffer, xp, 1)[0];
        new Float64Array(memory.buffer, gp, 1)[0] = -x;
        return (-x * x) / 2;
      },
    },
  };
  const options = {
    bytes,
    runtime,
    model: { initial: [0.2], x_pointer: 0, g_pointer: 8, callback_pointer: 1 },
    chains: 2,
    tune: 50,
    draws: 30,
    seed: 42,
    resultFormat: 'binary',
    retainUnconstrained: false,
    onTrace: undefined,
  };
  let streamed = 0;
  const first = await sample({
    ...options,
    onSamples: (batch?: { draws: number }) => {
      assert.ok(batch);
      streamed += batch.draws;
    },
  });
  const repeated = await sample(options);
  assert.notDeepEqual(first.initial_positions[0], first.initial_positions[1]);
  assert.deepEqual(first.initial_positions, repeated.initial_positions);
  assert.deepEqual(first.expanded_samples, repeated.expanded_samples);
  assert.equal(streamed, 60);
  assert.equal(first.samples, undefined);
  assert.equal(first.expanded_samples.length, 60);
  assert.equal(first.traces.length, 4);
  assert.ok(
    first.traces.every(
      (trace: { bytes: Uint8Array }) => trace.bytes.byteLength > 0,
    ),
  );
  const fixed = await sample({ ...options, jitter: 0 });
  assert.deepEqual(fixed.initial_positions, [[0.2], [0.2]]);
});
