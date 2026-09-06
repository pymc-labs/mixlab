'use client';

import { useMemo, useState } from 'react';
import { colors, type Posterior } from '@/lib/core';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush,
} from 'recharts';

type Kind = 'rank' | 'trace' | 'ess';
const views = {
  rank: {
    title: 'Rank ΔECDF',
    description:
      'Compare chains across the posterior. Persistent departures from the 95% reference band can indicate different explored regions. Autocorrelation can also cause departures; read alongside ESS and traces.',
    axis: 'Fractional rank',
  },
  trace: {
    title: 'Trace',
    description:
      'Look for overlapping, stable chains without drift or long stuck stretches. Red dots mark divergent transitions. Drag the handles below to zoom into a draw range.',
    axis: 'Draw (after warmup)',
  },
  ess: {
    title: 'ESS by quantile',
    description:
      'Check sampling precision across the distribution, including its tails. The reference line marks 400 effective samples. Hover over points to inspect each quantile.',
    axis: 'Quantile',
  },
};
const format = (value: number) =>
  Number.isFinite(value)
    ? Number(value.toPrecision(4)).toString()
    : 'Unavailable';

export function DiagnosticPlots({ posterior }: { posterior: Posterior }) {
  const [kind, setKind] = useState<Kind>('rank');
  const [selected, setSelected] = useState('');
  const [hidden, setHidden] = useState<number[]>([]);
  const plots = posterior.diagnosticPlots;
  const parameter = plots?.find((p) => p.name === selected) ?? plots?.[0];
  const rows = useMemo<Record<string, number | number[] | null>[]>(() => {
    if (!parameter) return [];
    if (kind === 'ess')
      return (
        parameter.ess?.x.map((x, i) => ({ x, ess: parameter.ess!.y[i] })) ?? []
      );
    if (kind === 'trace') {
      const divergences = parameter.divergences.map(
        (indices) => new Set(indices),
      );
      return parameter.chains[0].map((_, i) => {
        const row: Record<string, number> = { x: i + 1 };
        parameter.chains.forEach((chain, c) => {
          row[`chain${c}`] = chain[i];
          if (divergences[c]?.has(i)) row[`divergence${c}`] = chain[i];
        });
        return row;
      });
    }
    // ArviZ returns step curves and a separate confidence grid. Preserve both grids.
    const grid = [
      ...new Set([
        ...(parameter.envelope?.x ?? []),
        ...(parameter.rank?.flatMap((r) => r.x) ?? []),
      ]),
    ].sort((a, b) => a - b);
    return grid.map((x) => {
      const row: Record<string, number | number[]> = { x };
      parameter.rank?.forEach((line, c) => {
        const index = line.x.findIndex((v) => v >= x);
        row[`chain${c}`] = line.y[index < 0 ? line.y.length - 1 : index];
      });
      const band = parameter.envelope;
      if (band) {
        const found = band.x.findIndex((v) => v >= x);
        const i = found < 0 ? band.x.length - 1 : found;
        row.band = [band.low[i], band.high[i]];
      }
      return row;
    });
  }, [parameter, kind]);
  const error =
    kind === 'rank'
      ? parameter?.rankError
      : kind === 'ess'
        ? parameter?.essError
        : undefined;
  return (
    <section
      className="panel diagnostic-plots"
      aria-label="Interactive ArviZ diagnostics"
    >
      <div className="diagnostic-plots-heading">
        <div>
          <div className="eyebrow">POSTERIOR DIAGNOSTICS</div>
          <h3>Look inside the chains</h3>
        </div>
        <span className="diagnostic-plots-source">
          ArviZ · interactive · full posterior draws
        </span>
      </div>
      <div className="diagnostic-plots-controls">
        <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)}>
          <TabsList aria-label="Diagnostic plot">
            {Object.entries(views).map(([value, view]) => (
              <TabsTrigger key={value} value={value}>
                {view.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {parameter && (
          <label className="diagnostic-parameter">
            Parameter
            <select
              value={parameter.name}
              onChange={(e) => setSelected(e.target.value)}
            >
              {plots!.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="diagnostic-plots-caption">
        <p>{views[kind].description}</p>
      </div>
      {!parameter || error || !rows.length ? (
        <output className="diagnostic-plots-unavailable">
          {error ??
            'Run the model again to generate interactive plots. Older saved fits retain their numerical diagnostics.'}
        </output>
      ) : (
        <>
          {kind !== 'ess' && (
            <div
              className="diagnostic-chain-legend"
              aria-label="Visible chains"
            >
              {parameter.chains.map((_, c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={!hidden.includes(c)}
                  onClick={() =>
                    setHidden(
                      hidden.includes(c)
                        ? hidden.filter((v) => v !== c)
                        : [...hidden, c],
                    )
                  }
                  style={{
                    color: colors[c % colors.length],
                    opacity: hidden.includes(c) ? 0.45 : 1,
                  }}
                >
                  ● Chain {c + 1}
                </button>
              ))}
              {kind === 'rank' && <span>Shaded: 95% reference band</span>}
              {kind === 'trace' && <span>Red: divergent transition</span>}
            </div>
          )}
          <section
            className="diagnostic-interactive-chart"
            aria-label={`${views[kind].title} for ${parameter.name}`}
          >
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart
                key={`${parameter.name}-${kind}`}
                data={rows}
                margin={{ top: 15, right: 24, bottom: 30, left: 16 }}
                accessibilityLayer
              >
                <CartesianGrid stroke="#303a31" strokeDasharray="3 6" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={format}
                  stroke="#a0afa3"
                  label={{
                    value: views[kind].axis,
                    position: 'bottom',
                    offset: 10,
                    fill: '#bdc9bf',
                  }}
                />
                <YAxis
                  tickFormatter={format}
                  stroke="#a0afa3"
                  domain={kind === 'ess' ? [0, 'auto'] : ['auto', 'auto']}
                  width={65}
                />
                <Tooltip
                  contentStyle={{
                    background: '#172019',
                    border: '1px solid #435047',
                    borderRadius: 8,
                  }}
                  labelFormatter={(v) =>
                    `${views[kind].axis}: ${format(Number(v))}`
                  }
                  formatter={(v, name) => [
                    Array.isArray(v)
                      ? v.map((n) => format(Number(n))).join(' to ')
                      : format(Number(v)),
                    name,
                  ]}
                />
                {kind === 'rank' && (
                  <>
                    <Area
                      dataKey="band"
                      name="95% reference band"
                      type="stepBefore"
                      stroke="none"
                      fill="#a0afa3"
                      fillOpacity={0.16}
                      isAnimationActive={false}
                    />
                    <ReferenceLine y={0} stroke="#819085" />
                  </>
                )}
                {kind === 'ess' ? (
                  <>
                    <ReferenceLine
                      y={400}
                      ifOverflow="extendDomain"
                      stroke="#f4be73"
                      strokeDasharray="5 5"
                      label={{
                        value: 'ESS 400',
                        fill: '#f4be73',
                        position: 'insideTopRight',
                      }}
                    />
                    <Line
                      dataKey="ess"
                      name="Effective samples"
                      stroke={colors[0]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  parameter.chains.map(
                    (_, c) =>
                      !hidden.includes(c) && (
                        <Line
                          key={c}
                          dataKey={`chain${c}`}
                          name={`Chain ${c + 1}`}
                          type={kind === 'rank' ? 'stepBefore' : 'linear'}
                          stroke={colors[c % colors.length]}
                          strokeWidth={kind === 'rank' ? 2 : 1}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ),
                  )
                )}
                {kind === 'trace' &&
                  parameter.chains.map(
                    (_, c) =>
                      !hidden.includes(c) && (
                        <Scatter
                          key={c}
                          dataKey={`divergence${c}`}
                          name={`Divergence · chain ${c + 1}`}
                          fill="#ff7676"
                          isAnimationActive={false}
                        />
                      ),
                  )}
                {kind === 'trace' && (
                  <Brush
                    dataKey="x"
                    height={24}
                    stroke="#819085"
                    fill="#172019"
                    travellerWidth={10}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </section>
        </>
      )}
    </section>
  );
}
