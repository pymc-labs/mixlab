import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeProvider, validateAction } from '../lib/agent.ts';

test('agent cannot inject unknown configuration keys or out-of-budget sampling', () => {
  for (const patch of [
    { draws: 100000 },
    { lag: NaN },
    { seasonality: 'false' },
    { endpoint: 'https://example.com' },
    { adstockPrior: { alpha: Infinity, beta: 1 } },
  ]) {
    assert.throws(() => validateAction({ kind: 'configure', patch }));
  }
  assert.deepEqual(
    validateAction({
      kind: 'configure',
      patch: { seasonality: false, draws: 500 },
    }),
    { kind: 'configure', patch: { seasonality: false, draws: 500 } },
  );
});
test('unsupported scenario channels and nonfinite multipliers are rejected', () => {
  for (const [channel, multiplier] of [
    [-1, 1],
    [8, 1],
    [0.5, 1],
    [0, Infinity],
    [0, -1],
  ])
    assert.throws(() =>
      validateAction({ kind: 'scenario', channel, multiplier }),
    );
});
test('custom Python drafting is distinct from running code or sharing output', () => {
  assert.throws(() =>
    validateAction({
      kind: 'python_draft',
      source: 'model = None',
      varNames: [null],
      analysis: '',
    }),
  );
  const draft = validateAction({
    kind: 'python_draft',
    source: 'model = None',
    varNames: ['beta'],
    analysis: 'print(idata)',
  });
  assert.equal(draft.kind, 'python_draft');
  assert.deepEqual(validateAction({ kind: 'python_output' }), {
    kind: 'python_output',
  });
  assert.throws(() => validateAction({ kind: 'shell', source: 'rm -rf /' }));
});
test('Claude transport preserves tool results, uses only supplied context, and keeps keys out of message bodies', async () => {
  const original = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    request = options;
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'Verified.' }],
        stop_reason: 'end_turn',
      }),
    );
  }) as typeof fetch;
  try {
    const result = await claudeProvider('test-secret', 'test-model').respond(
      [{ role: 'user', content: 'Inspect' }],
      { weeks: 52 },
      new AbortController().signal,
    );
    assert.equal(result[0].type, 'text');
    assert.ok(!String(request?.body).includes('test-secret'));
    const body = JSON.parse(String(request?.body));
    assert.equal(body.messages[0].content, 'Inspect');
    assert.ok(body.system.includes('"weeks":52'));
    assert.equal(
      (request?.headers as Record<string, string>)['x-api-key'],
      'test-secret',
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('truncated responses and authentication failures never become successful assistant turns', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response('{}', { status: 401 })) as typeof fetch;
    await assert.rejects(
      claudeProvider('key', 'model').respond(
        [],
        {},
        new AbortController().signal,
      ),
      /not accepted/,
    );
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ content: [], stop_reason: 'max_tokens' }),
      )) as typeof fetch;
    await assert.rejects(
      claudeProvider('key', 'model').respond(
        [],
        {},
        new AbortController().signal,
      ),
      /cut short/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('OpenAI preserves reasoning and pairs function call results without sending keys in the body', async () => {
  const { openAIProvider, openAIInput } = await import('../lib/agent.ts');
  const original = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'opaque' },
      { type: 'function_call', call_id: 'call_test', name: 'inspect_workspace', arguments: '{}' },
    ] }));
  }) as typeof fetch;
  try {
    const blocks = await openAIProvider('private-test-key', 'gpt-5.4').respond([{ role: 'user', content: 'Inspect' }], { weeks: 52 }, new AbortController().signal);
    const next = openAIInput([{ role: 'assistant', content: blocks }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_test', content: '{"weeks":52}' }] }]);
    assert.equal(next[0].encrypted_content, 'opaque');
    assert.equal(next[1].call_id, next[2].call_id);
    assert.equal(next[2].type, 'function_call_output');
    assert.equal(requests[0].store, false);
    assert.ok(!JSON.stringify(requests).includes('private-test-key'));
  } finally { globalThis.fetch = original; }
});

test('OpenAI incomplete responses cannot trigger workspace actions', async () => {
  const { openAIProvider } = await import('../lib/agent.ts');
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'incomplete', output: [{ type: 'function_call', call_id: 'c', name: 'workspace_action', arguments: '{"kind":"fit"}' }] }))) as typeof fetch;
  try { await assert.rejects(openAIProvider('key', 'gpt-5.4').respond([], {}, new AbortController().signal), /did not complete/); }
  finally { globalThis.fetch = original; }
});
