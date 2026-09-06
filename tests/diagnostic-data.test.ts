import test from 'node:test';
import assert from 'node:assert/strict';
import { validDiagnosticPlots } from '../lib/diagnostic-data.ts';
const plot = {
  name: 'beta [search]',
  chains: [
    [1, 2],
    [3, 4],
  ],
  divergences: [[], [1]],
  rank: [
    { x: [0, 1], y: [0, 0] },
    { x: [0, 1], y: [0, 0] },
  ],
  envelope: { x: [0, 1], low: [-0.1, -0.1], high: [0.1, 0.1] },
  ess: { x: [0.1, 0.9], y: [400, null] },
};
void test('interactive diagnostic imports accept full data and older projects', () => {
  assert.ok(validDiagnosticPlots(undefined, 2, 2));
  assert.ok(validDiagnosticPlots([plot], 2, 2));
  assert.ok(
    validDiagnosticPlots(
      [
        {
          name: 'beta',
          chains: plot.chains,
          divergences: plot.divergences,
          rankError: 'Unavailable',
        },
      ],
      2,
      2,
    ),
  );
});
void test('malformed diagnostic grids, chain sizes and divergent indices reject', () => {
  for (const invalid of [
    null,
    {},
    [{ ...plot, chains: [[1, 2]] }],
    [{ ...plot, divergences: [[], [2]] }],
    [{ ...plot, rank: [{ x: [0, 1], y: [0] }] }],
    [{ ...plot, ess: { x: [0.9, 0.1], y: [1, 2] } }],
    [{ ...plot, envelope: { x: [0, 1], low: [1, 1], high: [0, 0] } }],
    [{ ...plot, essError: { message: 'bad' } }],
  ])
    assert.equal(validDiagnosticPlots(invalid, 2, 2), false);
});
