'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- SVG charts use an accessible image role. */
import { useDeferredValue, useMemo, useState } from 'react';
import {
  SalesProjection,
  PreferenceSurface,
  ChannelSurfaces,
} from './planner-explorer';
import styles from './planner-explorer.module.css';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import {
  changeWeight,
  createPlanner,
  defaultPreferences,
  normalizeWeights,
} from '../lib/planner';
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
  const [adherence, setAdherence] = useState<number>(
    defaultPreferences.adherence,
  );
  const [risk, setRisk] = useState<number>(defaultPreferences.risk);
  const weights = planner.prior.map((v, i) => v * multipliers[i]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const normalized = normalizeWeights(weights, planner.prior);
  const deferred = useDeferredValue(
    JSON.stringify({ weights, adherence, risk }),
  );
  const display = JSON.parse(deferred) as {
    weights: number[];
    adherence: number;
    risk: number;
  };
  const apply = (w: number[]) =>
    onChange(
      w.map((v, i) => (planner.prior[i] > 0 ? v / planner.prior[i] : 0)),
    );
  const choosePreferences = (a: number, r: number) => {
    setAdherence(a);
    setRisk(r);
    setLocked(true);
    apply(planner.optimize(a, r));
  };
  const moved =
    normalized.reduce((s, v, i) => s + Math.abs(v - planner.prior[i]), 0) / 2;
  const extrapolated = weights.some((w, i) => w > planner.prior[i] + 1e-6);
  return (
    <section className={`panel allocation-planner ${styles.root}`}>
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
      <div className={styles.workspace}>
        <div className={styles.controls}>
          <div className="allocation-toolbar">
            <div>
              <strong>{compact(planner.total * sum)}</strong>
              <span> / week · {(sum * 100).toFixed(1)}%</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => apply(normalized)}
            >
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
                <span className="allocation-channel">
                  <i style={{ background: colors[i] }} />
                  {label(c)}
                </span>
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
                  {((weights[i] - planner.prior[i]) * 100).toFixed(1)} pp vs.
                  prior
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
                onValueChange={(v) =>
                  choosePreferences(Array.isArray(v) ? v[0] : v, risk)
                }
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
                onValueChange={(v) =>
                  choosePreferences(adherence, Array.isArray(v) ? v[0] : v)
                }
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
              Preference sliders immediately update the mix at the original
              total budget.
            </p>
          </div>
          {extrapolated && (
            <p className={styles.note} style={{ padding: '0 24px 20px' }}>
              Some channel spend exceeds historical levels. Estimates may
              extrapolate beyond observed data.
            </p>
          )}
        </div>
        <div
          className={styles.explorer}
          aria-busy={deferred !== JSON.stringify({ weights, adherence, risk })}
        >
          <ChannelSurfaces
            planner={planner}
            weights={display.weights}
            channels={data.channels}
            locked={locked && Math.abs(sum - 1) < 0.001}
            adherence={display.adherence}
            risk={display.risk}
          />
        </div>
      </div>
      <div
        className={styles.results}
        aria-busy={deferred !== JSON.stringify({ weights, adherence, risk })}
      >
        <SalesProjection planner={planner} weights={display.weights} />
        <PreferenceSurface
          channels={data.channels}
          planner={planner}
          adherence={adherence}
          risk={risk}
          onChoose={choosePreferences}
        />
        <p className={styles.note}>
          Preference penalties change the recommended allocation and objective,
          not the underlying sales response. Suggestions use an approximate 1 pp
          search; no global-optimum guarantee.
        </p>
      </div>
    </section>
  );
}
