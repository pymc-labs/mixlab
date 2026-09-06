import test from 'node:test';
import assert from 'node:assert/strict';
import { createSamplerSession } from '../lib/sampler-session.mjs';
const options = { files: { '/data': 'original' }, varNames: ['alpha'] };
function fixture(idleMs = 10000) {
  const calls: {
    kind: string;
    id: number;
    options?: Record<string, unknown>;
  }[] = [];
  let number = 0;
  const session = createSamplerSession(
    () => {
      const id = ++number;
      return {
        prepare: async (source: string, opts: Record<string, unknown>) => {
          calls.push({ kind: 'prepare', id, options: { ...opts, source } });
          return { id, compile_seconds: 12 };
        },
        sample: async (_handle: unknown, opts: Record<string, unknown>) => {
          calls.push({ kind: 'sample', id, options: opts });
          if (opts.fail) throw Error('failed');
          return { compile_seconds: 0, model_compile_seconds: 12 };
        },
        close: () => calls.push({ kind: 'close', id }),
      };
    },
    { idleMs },
  );
  return { session, calls };
}
void test('sampling settings and analysis reuse preparation; model inputs invalidate it', async () => {
  const { session, calls } = fixture();
  try {
    assert.equal(
      (await session.run('model', { ...options, seed: 1 })).compile_seconds,
      12,
    );
    assert.equal(
      (
        await session.run('model', {
          ...options,
          seed: 2,
          draws: 100,
          afterSample: 'new analysis',
        })
      ).compile_seconds,
      0,
    );
    assert.equal(calls.filter((c) => c.kind === 'prepare').length, 1);
    assert.equal(calls.filter((c) => c.kind === 'sample')[1].options?.seed, 2);
    assert.ok(
      !('files' in calls.filter((c) => c.kind === 'sample')[1].options!),
    );
    await session.run('model', { ...options, files: { '/data': 'changed' } });
    await session.run('model', { ...options, varNames: ['beta'] });
    await session.run('changed model', options);
    assert.equal(calls.filter((c) => c.kind === 'prepare').length, 4);
    assert.equal(calls.filter((c) => c.kind === 'close').length, 3);
  } finally {
    session.close();
  }
});
void test('failed runs and explicit cancellation discard the cached worker', async () => {
  const { session, calls } = fixture();
  try {
    await assert.rejects(
      session.run('model', { ...options, fail: true }),
      /failed/,
    );
    await session.run('model', options);
    session.close();
    await session.run('model', options);
    assert.equal(calls.filter((c) => c.kind === 'prepare').length, 3);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      session.run('model', { ...options, signal: controller.signal }),
      { name: 'AbortError' },
    );
  } finally {
    session.close();
  }
});
void test('idle sessions release memory and compile again on next use', async () => {
  const { session, calls } = fixture(10);
  try {
    await session.run('model', options);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls.filter((c) => c.kind === 'close').length, 1);
    await session.run('model', options);
    assert.equal(calls.filter((c) => c.kind === 'prepare').length, 2);
  } finally {
    session.close();
  }
});
void test('closing during preparation cannot revive an expired handle; concurrent fits reject', async () => {
  let finish!: (value: { compile_seconds: number }) => void;
  let samples = 0;
  const session = createSamplerSession(() => ({
    prepare: () =>
      new Promise<{ compile_seconds: number }>((resolve) => {
        finish = resolve;
      }),
    sample: async () => {
      samples++;
    },
    close() {},
  }));
  const pending = session.run('model', options);
  await assert.rejects(session.run('model', options), /already active/);
  session.close();
  finish({ compile_seconds: 12 });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(samples, 0);
});
