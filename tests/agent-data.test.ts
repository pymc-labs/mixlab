import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAgentData } from '../lib/agent-data.ts';

const mapping = {
  date: 'date',
  target: 'sales',
  channels: ['spend', 'constant'],
  controls: [],
};
test('data exploration works before validation and excludes private categorical values', () => {
  const summary = summarizeAgentData(
    {
      name: 'test',
      example: false,
      headers: ['date', 'sales', 'spend', 'constant', 'customer'],
      rows: [
        {
          date: '2026-01-01',
          sales: '1',
          spend: '2',
          constant: '5',
          customer: 'PRIVATE_A',
        },
        {
          date: 'bad date',
          sales: '2',
          spend: '4',
          constant: '5',
          customer: 'PRIVATE_B',
        },
        {
          date: '',
          sales: '3',
          spend: '6',
          constant: '5',
          customer: 'PRIVATE_C',
        },
        { date: '', sales: '', spend: 'bad', constant: '5', customer: '' },
      ],
    },
    mapping,
  );
  const sales = summary.columns.find((c) => c.name === 'sales')!;
  assert.equal(sales.missing, 1);
  assert.equal(sales.statistics?.mean, 2);
  assert.equal(sales.statistics?.median, 2);
  assert.equal(summary.columns.find((c) => c.name === 'spend')!.nonnumeric, 1);
  assert.equal(summary.correlations[0].pearson, 1);
  assert.equal(summary.correlations[0].pairedRows, 3);
  assert.equal(summary.correlations[1].pearson, null);
  assert.ok(!JSON.stringify(summary).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(summary).includes('bad date'));
});
test('empty and nonfinite data produce explicit missing summaries', () => {
  const empty = summarizeAgentData(
    { name: '', example: true, headers: ['sales'], rows: [] },
    mapping,
  );
  assert.equal(empty.columns[0].statistics, null);
  const bad = summarizeAgentData(
    {
      name: '',
      example: false,
      headers: ['sales'],
      rows: [
        { sales: 'Infinity' },
        { sales: 'NaN' },
        { sales: '-2' },
        { sales: '0' },
      ],
    },
    mapping,
  );
  assert.equal(bad.columns[0].nonnumeric, 2);
  assert.equal(bad.columns[0].statistics?.negative, 1);
  assert.equal(bad.columns[0].statistics?.zeros, 1);
});
