'use client';
import { useMemo, useState } from 'react';
import { compact, type Config, type Dataset } from '../lib/core';
import { priorPredictive } from '../lib/prior-predictive';

export function PriorPredictive({
  data,
  config,
}: {
  data: Dataset;
  config: Config;
}) {
  const [mode, setMode] = useState<'outcome' | 'media'>('outcome');
  const [hover, setHover] = useState<number | null>(null);
  const result = useMemo(() => priorPredictive(data, config), [data, config]);
  const { intervals, paths } = result[mode];
  const lower = Math.min(
    0,
    ...data.y,
    ...intervals.map((v) => v.low),
    ...paths.map((p) => Math.min(...p)),
  );
  const upper = Math.max(
    1,
    ...data.y,
    ...intervals.map((v) => v.high),
    ...paths.map((p) => Math.max(...p)),
  );
  const pad = (upper - lower) * 0.05,
    min = lower - pad,
    max = upper + pad;
  const xx = (i: number) => 75 + (i / Math.max(1, data.y.length - 1)) * 860;
  const yy = (v: number) => 250 - ((v - min) / (max - min)) * 225;
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${xx(i)},${yy(v)}`).join(' ');
  const outside = intervals.filter(
    (v, i) => data.y[i] < v.low || data.y[i] > v.high,
  ).length;
  return (
    <div className="prior-predictive">
      <div className="prior-predictive-heading">
        <div>
          <h4>Prior predictive · live preview</h4>
          <p className="tiny">
            {result.draws} simulations at your observed spend and control
            values. Updates as you drag, before applying.
          </p>
        </div>
        <label>
          Show{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="outcome">Full outcome + noise</option>
            <option value="media">Channel contributions only</option>
          </select>
        </label>
      </div>
      <div className="prior-legend">
        <span style={{ color: '#b5f268' }}>━ Observed outcome</span>
        <span style={{ color: '#b3a5ff' }}>
          ━ Prior median · shaded 90% interval
        </span>
        <span>8 simulated paths</span>
      </div>
      <svg
        viewBox="0 0 980 290"
        role="img"
        aria-label={`Prior predictive ${mode === 'outcome' ? 'outcome' : 'channel contributions'} with observed data and a 90 percent interval`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.max(
              0,
              Math.min(
                data.y.length - 1,
                Math.round(
                  ((((e.clientX - r.left) / r.width) * 980 - 75) / 860) *
                    (data.y.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const v = min + ((max - min) * i) / 4;
          return (
            <g key={i}>
              <line
                x1="75"
                x2="935"
                y1={yy(v)}
                y2={yy(v)}
                stroke="#303a31"
                strokeDasharray="3 6"
              />
              <text
                x="65"
                y={yy(v) + 5}
                textAnchor="end"
                fill="#a0afa3"
                fontSize="14"
              >
                {compact(v)}
              </text>
            </g>
          );
        })}
        <path
          d={`${path(intervals.map((v) => v.high))} ${intervals
            .map((_, i) => {
              const k = intervals.length - 1 - i;
              return `L${xx(k)},${yy(intervals[k].low)}`;
            })
            .join(' ')}Z`}
          fill="#b3a5ff"
          opacity=".16"
        />
        {paths.map((p, i) => (
          <path
            key={i}
            d={path(p)}
            fill="none"
            stroke="#b3a5ff"
            opacity=".23"
            strokeWidth="1"
          />
        ))}
        <path
          d={path(intervals.map((v) => v.median))}
          fill="none"
          stroke="#b3a5ff"
          strokeWidth="2.5"
        />
        <path d={path(data.y)} fill="none" stroke="#b5f268" strokeWidth="2.5" />
        {[0, 0.5, 1].map((f) => {
          const i = Math.round(f * (data.y.length - 1));
          return (
            <text
              key={f}
              x={xx(i)}
              y="280"
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
              fill="#a0afa3"
              fontSize="14"
            >
              {data.dates[i]}
            </text>
          );
        })}
        {hover !== null && (
          <line
            x1={xx(hover)}
            x2={xx(hover)}
            y1="25"
            y2="250"
            stroke="#a0afa3"
          />
        )}
      </svg>
      <div className="chart-readout">
        {hover === null ? (
          <span>
            Hover to inspect a week · Outcome units · Axis adjusts to the
            simulated range
          </span>
        ) : (
          <span>
            {data.dates[hover]} · Observed {compact(data.y[hover])} · Prior
            median {compact(intervals[hover].median)} · 90% interval{' '}
            {compact(intervals[hover].low)} to {compact(intervals[hover].high)}
          </span>
        )}
      </div>
      <p className="tiny">
        {mode === 'outcome'
          ? `${outside} of ${data.y.length} observed weeks fall outside the pointwise 90% interval. Includes intercept, controls, seasonality when enabled, and observation noise.`
          : 'Channel contributions exclude baseline, controls, seasonality and noise. The observed total is shown for scale, not as a channel-level fit target.'}{' '}
        These are prior draws, not a fit or forecast. Fixed random streams make
        slider comparisons repeatable.
      </p>
      <details>
        <summary>Simulation assumptions</summary>
        <p className="tiny">
          Guided model preview: normalized geometric carryover, logistic
          saturation, independent channel priors; intercept Normal(0, 2),
          control coefficients Normal(0, 2), Fourier coefficients Laplace(0, 1),
          noise scale HalfNormal(2). Spend and outcome use their maximum
          absolute value for scaling; controls retain their original units.
          Broad control priors can dominate the full outcome. Custom Python
          models are not included.
        </p>
      </details>
    </div>
  );
}
