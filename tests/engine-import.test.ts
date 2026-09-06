import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSampler } from '../vendor/nuts-rs-wasm/client.mjs';
import { wrap } from '../vendor/nuts-rs-wasm/comlink.mjs';

test('the guided engine can initialize its bundled client without a public-directory module import', () => {
  const sampler = createSampler({
    runtimeUrl: 'https://example.com/runtime/',
    environment: 'pymc-marketing-wasm',
    assetsUrl: new URL('https://example.com/nuts/'),
    wrap,
  });
  assert.equal(sampler.wrap, wrap);
  assert.equal(sampler.assets.href, 'https://example.com/nuts/');
  sampler.close();
});
test('bundler and standalone-lab clients are the same pinned upstream modules', () => {
  for (const name of ['client.mjs', 'comlink.mjs'])
    assert.deepEqual(
      readFileSync(new URL(`../vendor/nuts-rs-wasm/${name}`, import.meta.url)),
      readFileSync(new URL(`../public/nuts/${name}`, import.meta.url)),
    );
});
