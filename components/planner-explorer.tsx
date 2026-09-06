'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG charts expose descriptive image roles. */
import { useEffect, useMemo, useState } from 'react';
import { compact, colors, label, type Interval } from '../lib/core';
import { channelSlice, type Planner } from '../lib/planner';
import { Button } from './ui/button';
import styles from './planner-explorer.module.css';

export function SalesProjection({
  planner,
  weights,
}: {
  planner: Planner;
  weights: number[];
}) {
  const current = planner.summarize(weights, 0, 0),
    prior = planner.summarize(planner.prior, 0, 0);
  const prediction = current.predictive;
  const intervals = [prior.predictive, prediction].filter(
    (v): v is Interval => v !== null,
  );
  const low = Math.min(...intervals.map((v) => v.low)),
    high = Math.max(...intervals.map((v) => v.high));
  const x = (v: number) => 110 + (355 * (v - low)) / (high - low || 1);
  return (
    <section className={styles.forecast} aria-live="polite">
      <div className="eyebrow">PROJECTED SALES / OUTCOME · AVERAGE WEEK</div>
      {prediction ? (
        <>
          <strong>{compact(prediction.median)}</strong>
          <p>
            90% predictive interval: {compact(prediction.low)}–
            {compact(prediction.high)}
          </p>
          <svg
            className={styles.chart}
            viewBox="0 0 500 112"
            role="img"
            aria-label="Original and current mix projected sales, median and 90 percent predictive intervals"
          >
            {intervals.map((v, i) => (
              <g key={i}>
                <text x="0" y={32 + i * 45}>
                  {i ? 'Current mix' : 'Original mix'}
                </text>
                <line
                  x1={x(v.low)}
                  x2={x(v.high)}
                  y1={28 + i * 45}
                  y2={28 + i * 45}
                  stroke={i ? colors[0] : '#9ba3aa'}
                  strokeWidth="10"
                  strokeLinecap="round"
                  opacity=".45"
                />
                <circle
                  cx={x(v.median)}
                  cy={28 + i * 45}
                  r="5"
                  fill={i ? colors[0] : '#9ba3aa'}
                />
              </g>
            ))}
            <text x="110" y="108">
              {compact(low)}
            </text>
            <text x="465" y="108" textAnchor="end">
              {compact(high)}
            </text>
          </svg>
        </>
      ) : (
        <>
          <strong>
            {current.mean >= 0 ? '+' : ''}
            {compact(current.mean)}
          </strong>
          <p>
            Expected weekly change · 90% credible interval{' '}
            {compact(current.interval.low)}–{compact(current.interval.high)}.
            Refit to see total projected sales with observation noise.
          </p>
        </>
      )}
      <p>
        Expected change: {current.mean >= 0 ? '+' : ''}
        {compact(current.mean)} / week ·{' '}
        {Math.round(
          (current.delta.filter((v) => v > 0).length / current.delta.length) *
            100,
        )}
        % of posterior draws improve on the original mix.
      </p>
      <p>
        In the target’s original units. Same dates, seasonality and controls as
        the observed period; uncertainty is for the period’s average week, not
        an individual future week.
      </p>
    </section>
  );
}

export function PreferenceSurface({
  channels,
  planner,
  adherence,
  risk,
  onChoose,
}: {
  planner: Planner;
  adherence: number;
  risk: number;
  onChoose: (a: number, r: number) => void;
  channels: string[];
}) {
  type Cell = {
    a: number;
    r: number;
    mean: number;
    moved: number;
    weights: number[];
  };
  const [grid, setGrid] = useState<{ planner: Planner; cells: Cell[] } | null>(
    null,
  );
  const [metric, setMetric] = useState<'gain' | 'movement' | number>('gain');
  useEffect(() => {
    let stopped = false,
      index = 0;
    const cells: Cell[] = [];
    const next = () => {
      if (stopped) return;
      const a = (index % 6) * 2,
        r = 3 - Math.floor(index / 6) * 0.6;
      const weights = planner.optimize(a, r),
        result = planner.evaluate(weights, a, r);
      cells.push({
        a,
        r,
        weights,
        mean: result.mean,
        moved:
          weights.reduce((s, w, j) => s + Math.abs(w - planner.prior[j]), 0) *
          50,
      });
      index++;
      if (index < 36) timer = setTimeout(next, 0);
      else setGrid({ planner, cells });
    };
    let timer = setTimeout(next, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [planner]);
  const cells = grid?.planner === planner ? grid.cells : [];
  const values = cells.map((c) =>
    metric === 'gain'
      ? c.mean
      : metric === 'movement'
        ? c.moved
        : c.weights[metric] * 100,
  );
  const min = Math.min(...values),
    max = Math.max(...values);
  const active = Math.round(adherence / 2) + Math.round((3 - risk) / 0.6) * 6;
  return (
    <section>
      <div className={styles.head}>
        <h3>Prior closeness × risk aversion</h3>
        <div>
          <Button
            size="sm"
            variant={metric === 'gain' ? 'secondary' : 'ghost'}
            onClick={() => setMetric('gain')}
          >
            Sales gain
          </Button>
          <Button
            size="sm"
            variant={metric === 'movement' ? 'secondary' : 'ghost'}
            onClick={() => setMetric('movement')}
          >
            Reallocated %
          </Button>
        </div>
      </div>
      <div
        className={styles.head}
        aria-label="Show channel allocation across preferences"
      >
        {channels.map((c, j) => (
          <Button
            key={c}
            size="sm"
            variant={metric === j ? 'secondary' : 'ghost'}
            aria-pressed={metric === j}
            onClick={() => setMetric(j)}
          >
            {label(c)} %
          </Button>
        ))}
      </div>
      <p className={styles.note}>
        {typeof metric === 'number'
          ? `${label(channels[metric])} share of total budget`
          : metric === 'gain'
            ? 'Expected weekly sales / outcome gain'
            : 'Share of the total budget reallocated'}
      </p>
      {cells.length ? (
        <>
          <div className={styles.map}>
            <div className={styles.yaxis}>
              <span>ρ 3</span>
              <span>0</span>
            </div>
            <div>
              <div
                className={styles.grid}
                aria-label="Prior closeness by risk aversion; each cell applies its optimized allocation"
              >
                {cells.map((c, i) => {
                  const v = values[i],
                    t = (v - min) / (max - min || 1);
                  return (
                    <button
                      key={i}
                      className={`${styles.cell} ${active === i ? styles.active : ''}`}
                      style={{
                        background: `hsl(${160 - t * 70} ${25 + t * 50}% ${28 + t * 42}%)`,
                        color: t < 0.4 ? '#fff' : '#111b14',
                      }}
                      aria-pressed={active === i}
                      aria-label={`Prior ${c.a}, risk ${c.r.toFixed(1)}: gain ${compact(c.mean)}, ${c.moved.toFixed(1)} percent reallocated`}
                      title={planner.prior
                        .map(
                          (_, j) =>
                            `${label(channels[j])}: ${(c.weights[j] * 100).toFixed(1)}%`,
                        )
                        .join(' · ')}
                      onClick={() => onChoose(c.a, c.r)}
                    >
                      {metric === 'gain' ? compact(v) : `${v.toFixed(0)}%`}
                    </button>
                  );
                })}
              </div>
              <div className={styles.xaxis}>
                <span>λ 0 · free</span>
                <span>10 · close to prior</span>
              </div>
            </div>
          </div>
          <div className={styles.key} />
          <div className={styles.xaxis}>
            <span>
              {compact(min)}
              {metric !== 'gain' ? '%' : ''}
            </span>
            <span>
              {compact(max)}
              {metric !== 'gain' ? '%' : ''}
            </span>
          </div>
        </>
      ) : (
        <p className={styles.note} role="status">
          Calculating the preference surface…
        </p>
      )}
      <p className={styles.note}>
        Each cell optimizes the mix at the original total budget. Click to apply
        it. The outline marks the nearest grid setting; sliders use their exact
        values.
      </p>
    </section>
  );
}

export function ChannelSurfaces({
  planner,
  weights,
  channels,
  locked,
  adherence,
  risk,
}: {
  planner: Planner;
  weights: number[];
  channels: string[];
  locked: boolean;
  adherence: number;
  risk: number;
}) {
  const [view, setView] = useState<'sales' | 'objective'>('sales');
  const key = weights.join(',');
  const slices = useMemo(
    () =>
      channels.map((_, j) =>
        channelSlice(
          planner,
          key.split(',').map(Number),
          j,
          locked,
          adherence,
          risk,
        ),
      ),
    [planner, key, channels, locked, adherence, risk],
  );
  return (
    <section>
      <div className={styles.head}>
        <h3>Every channel, in your current mix</h3>
        <div>
          <Button
            size="sm"
            variant={view === 'sales' ? 'secondary' : 'ghost'}
            onClick={() => setView('sales')}
          >
            Sales + uncertainty
          </Button>
          <Button
            size="sm"
            variant={view === 'objective' ? 'secondary' : 'ghost'}
            onClick={() => setView('objective')}
          >
            Objective
          </Button>
        </div>
      </div>
      <div className={styles.cards}>
        {slices.map((points, j) => {
          const lo = Math.min(
            ...points.map((p) =>
              view === 'objective' ? p.score : (p.predictive ?? p.interval).low,
            ),
          );
          const hi = Math.max(
            ...points.map((p) =>
              view === 'objective'
                ? p.score
                : (p.predictive ?? p.interval).high,
            ),
          );
          const x = (w: number) =>
            48 + (w / (locked ? 1 : Math.max(1, planner.prior[j] * 2))) * 260;
          const y = (v: number) => 145 - ((v - lo) / (hi - lo || 1)) * 120;
          const line = points
            .map(
              (p) =>
                `${x(p.share)},${y(view === 'objective' ? p.score : (p.predictive ?? p.interval).median)}`,
            )
            .join(' ');
          const band = [
            ...points.map(
              (p) => `${x(p.share)},${y((p.predictive ?? p.interval).low)}`,
            ),
            ...[...points]
              .reverse()
              .map(
                (p) => `${x(p.share)},${y((p.predictive ?? p.interval).high)}`,
              ),
          ].join(' ');
          const current = planner.summarize(weights, adherence, risk);
          const value =
            view === 'objective'
              ? current.score
              : (current.predictive ?? current.interval).median;
          return (
            <article className={styles.card} key={channels[j]}>
              <h4>
                {label(channels[j])}
                <span>{(weights[j] * 100).toFixed(1)}%</span>
              </h4>
              <svg
                className={styles.chart}
                viewBox="0 0 330 178"
                role="img"
                aria-label={`${label(channels[j])}: ${view === 'objective' ? 'risk and prior adjusted objective' : current.predictive ? 'projected total sales and 90 percent predictive interval' : 'contribution change and 90 percent credible interval'} by channel budget share`}
              >
                {[lo, hi].map((v, i) => (
                  <g key={i}>
                    <line
                      x1="48"
                      x2="308"
                      y1={y(v)}
                      y2={y(v)}
                      stroke="currentColor"
                      opacity=".15"
                    />
                    <text x="43" y={y(v) + 4} textAnchor="end">
                      {view === 'objective' ? v.toFixed(2) : compact(v)}
                    </text>
                  </g>
                ))}
                {view === 'sales' && (
                  <polygon points={band} fill={colors[j]} opacity=".18" />
                )}
                <polyline
                  points={line}
                  fill="none"
                  stroke={colors[j]}
                  strokeWidth="2"
                />
                <line
                  x1={x(planner.prior[j])}
                  x2={x(planner.prior[j])}
                  y1="20"
                  y2="148"
                  stroke="currentColor"
                  strokeDasharray="3 4"
                />
                <line
                  x1={x(weights[j])}
                  x2={x(weights[j])}
                  y1="20"
                  y2="148"
                  stroke={colors[j]}
                  opacity=".6"
                />
                <circle
                  cx={x(weights[j])}
                  cy={y(value)}
                  r="4"
                  fill={colors[j]}
                />
                <text x="48" y="170">
                  0%
                </text>
                <text x="308" y="170" textAnchor="end">
                  {locked
                    ? '100%'
                    : `${Math.max(100, planner.prior[j] * 200).toFixed(0)}%`}
                </text>
              </svg>
            </article>
          );
        })}
      </div>
      <p className={styles.note}>
        {locked
          ? 'Fixed total: other channels adjust proportionally.'
          : 'Variable total: other channel budgets stay at their current settings.'}{' '}
        Dots show the current mix; dashed lines show original shares.{' '}
        {view === 'objective'
          ? 'Score = expected gain / scale − ρ × SD(gain) / scale − λ × Σ(w − prior)².'
          : 'Bands show 90% predictive uncertainty when draws are available; otherwise credible uncertainty in the contribution change.'}
      </p>
    </section>
  );
}
