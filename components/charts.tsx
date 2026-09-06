'use client';
import { useId, useState } from 'react';
import { compact, interval, type Dataset, type Posterior } from '@/lib/core';
export function RevenueChart({
  data,
  posterior,
  lastYear = false,
}: {
  data: Dataset;
  posterior: Posterior | null;
  lastYear?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const start = lastYear ? Math.max(0, data.y.length - 52) : 0,
    y = data.y.slice(start),
    pred = posterior?.prediction;
  const max = Math.max(...y, ...(pred?.high.slice(start) ?? [])) * 1.1,
    min = Math.min(0, ...(pred?.low.slice(start) ?? []));
  const xx = (i: number) => 48 + (i / Math.max(1, y.length - 1)) * 900,
    yy = (v: number) => 245 - ((v - min) / (max - min)) * 220;
  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${xx(i)},${yy(v)}`).join(' ');
  const ticks = [
    0,
    Math.floor((y.length - 1) / 3),
    Math.floor((2 * (y.length - 1)) / 3),
    y.length - 1,
  ];
  const selected =
    hover === null ? null : Math.min(y.length - 1, Math.max(0, hover));
  return (
    <div className="chart">
      <svg
        viewBox="0 0 980 285"
        role="img"
        aria-label={`Observed weekly outcome for ${y.length} weeks${pred ? ', with fitted median and 90 percent posterior predictive interval' : ''}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(
            Math.round(
              ((((e.clientX - r.left) / r.width) * 980 - 48) / 900) *
                (y.length - 1),
            ),
          );
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b5f268" stopOpacity=".15" />
            <stop offset="100%" stopColor="#b5f268" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1="48"
              x2="948"
              y1={25 + i * 55}
              y2={25 + i * 55}
              stroke="#303a31"
              strokeDasharray="3 6"
            />
            <text x="0" y={30 + i * 55} fill="#a0afa3" fontSize="13">
              {compact(max - ((max - min) * i) / 4)}
            </text>
          </g>
        ))}
        {pred ? (
          <>
            <path
              d={`${path(pred.high.slice(start))} ${pred.low
                .slice(start)
                .map((_, i) => {
                  const k = y.length - 1 - i;
                  return `L${xx(k)},${yy(pred.low[start + k])}`;
                })
                .join(' ')}Z`}
              fill="#b3a5ff"
              opacity=".2"
            />
            <path
              d={path(pred.median.slice(start))}
              fill="none"
              stroke="#b3a5ff"
              strokeWidth="2.5"
            />
          </>
        ) : (
          <path d={`${path(y)} L948,245 L48,245Z`} fill={`url(#${id})`} />
        )}
        <path d={path(y)} fill="none" stroke="#b5f268" strokeWidth="2" />
        {ticks.map((i, j) => (
          <text
            key={j}
            x={xx(i)}
            y="276"
            textAnchor={j === 3 ? 'end' : 'start'}
            fill="#a0afa3"
            fontSize="13"
          >
            {data.dates[start + i].slice(0, 7)}
          </text>
        ))}
        {selected !== null && (
          <g>
            <line
              x1={xx(selected)}
              x2={xx(selected)}
              y1="25"
              y2="245"
              stroke="#6a786b"
            />
            <circle
              cx={xx(selected)}
              cy={yy(y[selected])}
              r="4"
              fill="#b5f268"
            />
          </g>
        )}
      </svg>
      <div className="chart-readout">
        {selected !== null ? (
          <>
            <strong>{data.dates[start + selected]}</strong>
            <span>Observed {compact(y[selected])}</span>
            {pred && (
              <span>
                Predicted {compact(pred.median[start + selected])} · 90%
                interval {compact(pred.low[start + selected])}–
                {compact(pred.high[start + selected])}
              </span>
            )}
          </>
        ) : (
          <span>
            {pred
              ? 'Shaded region: 90% posterior predictive interval · In-sample fit'
              : 'Hover to inspect a week · Values in your outcome units'}
          </span>
        )}
      </div>
    </div>
  );
}
export function Histogram({ values }: { values: number[] }) {
  const bins = Array(24).fill(0);
  values.forEach((v) => bins[Math.min(23, Math.max(0, Math.floor(v * 24)))]++);
  const max = Math.max(1, ...bins);
  return (
    <svg
      viewBox="0 0 280 92"
      className="histogram"
      role="img"
      aria-label={`Live posterior for the first channel's adstock retention, ${values.length} draws`}
    >
      {bins.map((n, i) => (
        <rect
          key={i}
          x={i * 11.5 + 2}
          y={70 - (n / max) * 64}
          width="8"
          height={(n / max) * 64}
          fill="#b5f268"
          opacity={0.3 + (0.7 * n) / max}
        />
      ))}
      <text x="0" y="90" fill="#a0afa3" fontSize="12">
        0 · short memory
      </text>
      <text x="278" y="90" textAnchor="end" fill="#a0afa3" fontSize="12">
        long memory · 1
      </text>
    </svg>
  );
}
export function ResponseCurve({
  color,
  scale,
  posterior,
  channel = 0,
  priorScale = 2,
}: {
  color: string;
  scale: number;
  posterior?: Posterior | null;
  channel?: number;
  priorScale?: number;
}) {
  const points = Array.from({ length: 41 }, (_, i) => i / 20),
    summary = points.map((x) => {
      if (!posterior)
        return { low: 0, median: priorScale * Math.tanh((3 * x) / 2), high: 0 };
      return interval(
        posterior.beta.map(
          (b, i) =>
            b[channel] *
            Math.tanh((posterior.lam[i][channel] * x) / 2) *
            posterior.targetScale,
        ),
      );
    });
  const max =
    Math.max(...summary.map((v) => (posterior ? v.high : v.median))) * 1.05;
  const path = (key: 'low' | 'median' | 'high') =>
    summary
      .map(
        (v, i) =>
          `${i ? 'L' : 'M'}${30 + (i / 40) * 370},${145 - (v[key] / max) * 125}`,
      )
      .join(' ');
  return (
    <svg
      viewBox="0 0 425 185"
      className="response-curve"
      role="img"
      aria-label={
        posterior
          ? 'Posterior saturation curve with a 90 percent credible interval'
          : 'Illustrative logistic response curve'
      }
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1="30"
          x2="400"
          y1={20 + i * 42}
          y2={20 + i * 42}
          stroke="#303a31"
          strokeDasharray="3 5"
        />
      ))}
      {posterior && (
        <path
          d={`${path('high')} ${[...summary]
            .reverse()
            .map(
              (v, i) =>
                `L${30 + ((40 - i) / 40) * 370},${145 - (v.low / max) * 125}`,
            )
            .join(' ')} Z`}
          fill={color}
          opacity=".15"
        />
      )}
      <path d={path('median')} fill="none" stroke={color} strokeWidth="2.5" />
      <text x="30" y="171" fontSize="12" fill="#a0afa3">
        0
      </text>
      <text x="215" y="171" fontSize="12" fill="#a0afa3" textAnchor="middle">
        {compact(scale)}
      </text>
      <text x="400" y="171" fontSize="12" fill="#a0afa3" textAnchor="end">
        {compact(scale * 2)}
      </text>
    </svg>
  );
}
