import { quantile, type Mapping, type RawTable } from './core.ts';

/** Descriptive aggregates only: never include raw rows or categorical values. */
export function summarizeAgentData(table: RawTable, mapping: Mapping) {
  const numeric = (value: string | undefined) =>
    value?.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  const columns = table.headers.map((name) => {
    const values = table.rows.map((row) => numeric(row[name]));
    const valid = values.filter((v): v is number => v !== null);
    const missing = table.rows.filter((row) => !row[name]?.trim()).length;
    return {
      name,
      role:
        name === mapping.date
          ? 'date'
          : name === mapping.target
            ? 'target'
            : mapping.channels.includes(name)
              ? 'channel'
              : mapping.controls.includes(name)
                ? 'control'
                : 'unmapped',
      missing,
      nonnumeric: table.rows.length - missing - valid.length,
      numericCount: valid.length,
      statistics: valid.length
        ? {
            min: Math.min(...valid),
            max: Math.max(...valid),
            mean: valid.reduce((sum, v) => sum + v / valid.length, 0),
            median: quantile(valid, 0.5),
            q25: quantile(valid, 0.25),
            q75: quantile(valid, 0.75),
            zeros: valid.filter((v) => v === 0).length,
            negative: valid.filter((v) => v < 0).length,
          }
        : null,
    };
  });
  const names = [
    ...new Set([mapping.target, ...mapping.channels, ...mapping.controls]),
  ].filter((name) => table.headers.includes(name));
  const correlations = names.flatMap((left, i) =>
    names.slice(i + 1).map((right) => {
      const pairs = table.rows
        .map((row) => [numeric(row[left]), numeric(row[right])])
        .filter((pair): pair is number[] => pair.every((v) => v !== null));
      const n = pairs.length;
      const mx = pairs.reduce((s, p) => s + p[0] / n, 0);
      const my = pairs.reduce((s, p) => s + p[1] / n, 0);
      let xx = 0,
        yy = 0,
        xy = 0;
      for (const [x, y] of pairs) {
        xx += (x - mx) ** 2;
        yy += (y - my) ** 2;
        xy += (x - mx) * (y - my);
      }
      const r = xy / Math.sqrt(xx * yy);
      return {
        left,
        right,
        pairedRows: n,
        pearson:
          n >= 2 && Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null,
      };
    }),
  );
  return {
    rows: table.rows.length,
    synthetic: table.example,
    columns,
    correlations,
    note: 'Statistics use finite numeric values; correlations use pairwise complete rows, without lag adjustment. Correlation is descriptive, not causal. No raw rows or categorical values are included.',
  };
}
