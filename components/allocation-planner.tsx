'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG charts use an accessible image role. */
import { useDeferredValue, useMemo, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { changeWeight, createPlanner, normalizeWeights } from '../lib/planner';
import {
  colors,
  compact,
  label,
  type Dataset,
  type Posterior,
} from '../lib/core';

export function AllocationPlanner({
  data,
  posterior,
  lag,
  multipliers,
  onChange,
}: {
  data: Dataset;
  posterior: Posterior;
  lag: number;
  multipliers: number[];
  onChange: (v: number[]) => void;
}) {
  const planner = useMemo(
    () => createPlanner(data, posterior, lag),
    [data, posterior, lag],
  );
  const [locked, setLocked] = useState(true);
  const [adherence, setAdherence] = useState(1);
  const [risk, setRisk] = useState(0.5);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<'outcome' | 'objective'>('outcome');
  const channel = Math.min(selected, data.channels.length - 1);
  const weights = planner.prior.map((v, i) => v * multipliers[i]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const normalized = normalizeWeights(weights, planner.prior);
  const deferred = useDeferredValue(
    JSON.stringify({ normalized, adherence, risk, channel }),
  );
  const exploration = useMemo(() => {
    const state = JSON.parse(deferred) as {
      normalized: number[];
      adherence: number;
      risk: number;
      channel: number;
    };
    return Array.from({ length: 51 }, (_, i) => {
      const w = changeWeight(
        state.normalized,
        state.channel,
        i / 50,
        planner.prior,
      );
      const result = planner.summarize(w, state.adherence, state.risk);
      return { share: w[state.channel], ...result };
    });
  }, [planner, deferred]);
  const apply = (w: number[]) =>
    onChange(
      w.map((v, i) => (planner.prior[i] > 0 ? v / planner.prior[i] : 0)),
    );
  const low = Math.min(
    0,
    ...exploration.map((p) => (view === 'outcome' ? p.interval.low : p.score)),
  );
  const high = Math.max(
    1e-6,
    ...exploration.map((p) => (view === 'outcome' ? p.interval.high : p.score)),
  );
  const y = (v: number) => 170 - ((v - low) / (high - low)) * 145;
  const x = (v: number) => 58 + 460 * v;
  const line = exploration
    .map((p) => `${x(p.share)},${y(view === 'outcome' ? p.mean : p.score)}`)
    .join(' ');
  const band = [
    ...exploration.map((p) => `${x(p.share)},${y(p.interval.low)}`),
    ...[...exploration]
      .reverse()
      .map((p) => `${x(p.share)},${y(p.interval.high)}`),
  ].join(' ');
  const moved =
    normalized.reduce((s, v, i) => s + Math.abs(v - planner.prior[i]), 0) / 2;
  const extrapolated = weights.some((w, i) => w > planner.prior[i] + 1e-6);
  return (
    <section className="panel allocation-planner">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">BUDGET / SCENARIO PLANNER</div>
          <h2>Your next mix</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(data.channels.map(() => 1))}
        >
          <RotateCcw /> Reset
        </Button>
      </div>
      <div className="allocation-toolbar">
        <div>
          <strong>{compact(planner.total * sum)}</strong>
          <span> / week · {(sum * 100).toFixed(1)}%</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => apply(normalized)}>
          Sum to 100%
        </Button>
        <label htmlFor="allocation-lock" className="allocation-lock">
          <Switch
            id="allocation-lock"
            checked={locked && Math.abs(sum - 1) < 0.001}
            onCheckedChange={(v) => {
              setLocked(v);
              if (v) apply(normalized);
            }}
          />{' '}
          Keep total fixed
        </label>
      </div>
      <div className="allocation-legend">
        <span>● Scenario</span>
        <span>│ Prior allocation = observed mix</span>
      </div>
      {data.channels.map((c, i) => (
        <div className="budget-channel" key={c}>
          <div>
            <button
              className={`allocation-channel ${channel === i ? 'selected' : ''}`}
              onClick={() => setSelected(i)}
            >
              <i style={{ background: colors[i] }} />
              {label(c)}
            </button>
            <strong>
              {(weights[i] * 100).toFixed(1)}%{' '}
              <small>· {compact(planner.total * weights[i])}</small>
            </strong>
          </div>
          <div className="allocation-track">
            <span
              className="allocation-prior"
              style={{
                left: `${(planner.prior[i] * 10000) / (locked && Math.abs(sum - 1) < 0.001 ? 100 : Math.max(100, planner.prior[i] * 200))}%`,
              }}
              title={`Prior allocation: ${(planner.prior[i] * 100).toFixed(1)}%`}
            />
            <Slider
              aria-label={`${label(c)} share of original total budget`}
              value={[weights[i] * 100]}
              min={0}
              max={
                locked && Math.abs(sum - 1) < 0.001
                  ? 100
                  : Math.max(100, planner.prior[i] * 200)
              }
              step={1}
              onValueChange={(v) => {
                const share = (Array.isArray(v) ? v[0] : v) / 100;
                setSelected(i);
                if (locked)
                  apply(changeWeight(normalized, i, share, planner.prior));
                else {
                  const next = [...weights];
                  next[i] = share;
                  apply(next);
                }
              }}
            />
          </div>
          <div className="slider-scale">
            <span>Prior {(planner.prior[i] * 100).toFixed(1)}%</span>
            <span>
              {((weights[i] - planner.prior[i]) * 100).toFixed(1)} pp vs. prior
            </span>
          </div>
        </div>
      ))}
      <div className="allocation-preferences">
        <div className="allocation-control">
          <div id="adherence-label">
            Stay close to prior <output>λ = {adherence.toFixed(1)}</output>
          </div>
          <Slider
            aria-labelledby="adherence-label"
            value={[adherence]}
            min={0}
            max={10}
            step={0.1}
            onValueChange={(v) => setAdherence(Array.isArray(v) ? v[0] : v)}
          />
          <div className="slider-scale">
            <span>Explore freely</span>
            <span>Prefer smaller changes</span>
          </div>
        </div>
        <div className="allocation-control">
          <div id="risk-label">
            Risk aversion <output>ρ = {risk.toFixed(1)}</output>
          </div>
          <Slider
            aria-labelledby="risk-label"
            value={[risk]}
            min={0}
            max={3}
            step={0.1}
            onValueChange={(v) => setRisk(Array.isArray(v) ? v[0] : v)}
          />
          <div className="slider-scale">
            <span>Expected gain</span>
            <span>Penalize uncertain gains</span>
          </div>
        </div>
        <Button
          onClick={() => {
            apply(planner.optimize(adherence, risk));
            setLocked(true);
          }}
        >
          <Sparkles /> Suggest a mix
        </Button>
        <p>
          {(moved * 100).toFixed(1)}% of the fixed budget reallocated ·
          Suggestions keep the original total.
        </p>
      </div>
      <div className="allocation-surface">
        <div className="allocation-surface-heading">
          <div>
            <div className="eyebrow">ALLOCATION SURFACE</div>
            <h3>{label(data.channels[channel])}</h3>
          </div>
          <div className="allocation-views">
            <Button
              size="sm"
              variant={view === 'outcome' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'outcome'}
              onClick={() => setView('outcome')}
            >
              Outcome
            </Button>
            <Button
              size="sm"
              variant={view === 'objective' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'objective'}
              onClick={() => setView('objective')}
            >
              Objective
            </Button>
          </div>
        </div>
        {/* SVG needs an image role for its accessible chart description. */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        <svg
          viewBox="0 0 550 208"
          role="img"
          aria-label={`${label(data.channels[channel])} allocation sensitivity at fixed total budget; ${view === 'outcome' ? 'expected weekly change with 90 percent credible band' : 'risk and prior adjusted objective'}`}
        >
          {[low, (low + high) / 2, high].map((v, i) => (
            <g key={i}>
              <line
                x1="58"
                x2="518"
                y1={y(v)}
                y2={y(v)}
                stroke="currentColor"
                opacity=".12"
              />
              <text x="50" y={y(v) + 4} textAnchor="end">
                {view === 'outcome' ? compact(v) : v.toFixed(2)}
              </text>
            </g>
          ))}
          {view === 'outcome' && (
            <polygon points={band} fill={colors[channel]} opacity=".16" />
          )}
          <line
            x1="58"
            x2="518"
            y1={y(0)}
            y2={y(0)}
            stroke="currentColor"
            opacity=".4"
            strokeDasharray="3 5"
          />
          <polyline
            points={line}
            fill="none"
            stroke={colors[channel]}
            strokeWidth="2.5"
          />
          <line
            x1={x(planner.prior[channel])}
            x2={x(planner.prior[channel])}
            y1="20"
            y2="173"
            stroke="currentColor"
            opacity=".6"
            strokeDasharray="4 4"
          />
          <line
            x1={x(normalized[channel])}
            x2={x(normalized[channel])}
            y1="20"
            y2="173"
            stroke={colors[channel]}
            strokeWidth="2"
          />
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <text key={v} x={x(v)} y="195" textAnchor="middle">
              {v * 100}%
            </text>
          ))}
        </svg>
        <p>
          {view === 'outcome'
            ? 'Expected weekly contribution change · shaded 90% credible interval.'
            : 'Expected gain / scale − ρ × SD(gain) / scale − λ × Σ(w − prior)². Scale = expected original channel contribution.'}{' '}
          Dashed marker: prior. Solid marker: current normalized share.
        </p>
        <p>
          Move a channel slider to explore. This slice keeps the original total
          fixed and redistributes other shares proportionally. Suggestions use
          an approximate 1 pp search; no global-optimum guarantee.
        </p>
        {Math.abs(sum - 1) > 0.001 && (
          <p className="allocation-warning">
            Your scenario changes total spend. This surface uses its normalized
            mix at the original budget.
          </p>
        )}
        {extrapolated && (
          <p className="allocation-warning">
            Some channel spend exceeds its historical level. Response estimates
            may extrapolate beyond observed data.
          </p>
        )}
      </div>
    </section>
  );
}
