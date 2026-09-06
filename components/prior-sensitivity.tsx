'use client';
import { useState } from 'react';
import { Activity, ArrowRight, RotateCcw, TriangleAlert } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Brush,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { compact, healthy, label, number, type Posterior } from '@/lib/core';
import { sensitivityDiagnosis, type SensitivityGroup } from '@/lib/sensitivity';

const baseColor = '#b3a5ff';
const selectedColor = '#b5f268';
const tooltipStyle = {
  background: '#172119',
  border: '1px solid #51604c',
  borderRadius: 10,
  color: '#ecf3e6',
  fontSize: 14,
};
const axis = { fill: '#a9b6a8', fontSize: 12 };

export function PriorSensitivity({
  posterior,
  channels,
  busy,
  onConfigure,
}: {
  posterior: Posterior | null;
  channels: string[];
  busy: boolean;
  onConfigure: () => void;
}) {
  const [channel, setChannel] = useState(0);
  const [group, setGroup] = useState<SensitivityGroup>('prior');
  const [powerIndex, setPowerIndex] = useState(0);
  const s = posterior?.sensitivity;
  if (!s || s.status !== 'available')
    return (
      <section className="panel sensitivity-empty">
        <Activity size={28} />
        <h3>
          {busy
            ? 'Sensitivity follows sampling'
            : posterior
              ? 'This fit has no sensitivity analysis'
              : 'Fit a model to explore sensitivity'}
        </h3>
        <p>
          {busy
            ? 'Log densities and reweighted channel contributions are computed after the sampler finishes.'
            : s?.status === 'unavailable'
              ? s.reason
              : posterior
                ? 'Older saved fits do not include log-density diagnostics. Run the model again to add them.'
                : 'See how much your channel contributions change when the prior or likelihood is strengthened or weakened.'}
        </p>
        <Button variant="outline" onClick={onConfigure}>
          {busy ? 'View fitting progress' : 'Go to fitting'} <ArrowRight />
        </Button>
      </section>
    );
  const c = Math.min(channel, channels.length - 1);
  const points = s.groups[group];
  const selected = points[powerIndex],
    baseline = points[10];
  const current = selected.channels[c],
    reference = baseline.channels[c];
  const fitHealthy = healthy(posterior!);
  const reliable = selected.reliable && fitHealthy;
  const delta = current.median - reference.median;
  const density = s.binCenters[c].map((x, i) => ({
    x,
    baseline: reference.density[i],
    selected: current.density[i],
  }));
  const trajectory = points.map((p, i) => ({
    power: p.power,
    median: p.channels[c].median,
    interval: [p.channels[c].low, p.channels[c].high],
    reliable: p.reliable,
    index: i,
  }));
  const choosePower = (value: unknown) => {
    if (value === null || value === undefined) return;
    const power = Number(value);
    if (!Number.isFinite(power)) return;
    setPowerIndex(
      points.reduce(
        (best, p, i) =>
          Math.abs(p.power - power) < Math.abs(points[best].power - power)
            ? i
            : best,
        0,
      ),
    );
  };
  return (
    <div className="sensitivity-workspace">
      <section className="panel sensitivity-controls">
        <div className="sensitivity-heading">
          <div>
            <h3>How much do your assumptions matter?</h3>
            <p>
              Explore average weekly channel contributions, on the original
              outcome scale.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setPowerIndex(10);
              setGroup('prior');
            }}
          >
            <RotateCcw size={15} /> Reset
          </Button>
        </div>
        <div className="sensitivity-inputs">
          <div>
            <label htmlFor="sensitivity-channel">Channel</label>
            <Select
              value={String(c)}
              onValueChange={(v) => v !== null && setChannel(Number(v))}
            >
              <SelectTrigger id="sensitivity-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((name, i) => (
                  <SelectItem key={name} value={String(i)}>
                    {label(name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className="sensitivity-field-label">What to perturb</span>
            <Tabs
              value={group}
              onValueChange={(v) => setGroup(v as SensitivityGroup)}
            >
              <TabsList aria-label="Sensitivity component">
                <TabsTrigger value="prior">Prior</TabsTrigger>
                <TabsTrigger value="likelihood">Likelihood</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="sensitivity-power">
            <label htmlFor="sensitivity-power">
              {group === 'prior' ? 'Prior' : 'Likelihood'} power{' '}
              <output>{selected.power.toFixed(2)}×</output>
            </label>
            <Slider
              id="sensitivity-power"
              aria-label={`${group} power`}
              aria-valuetext={`${selected.power.toFixed(2)} times the original ${group} power`}
              min={0}
              max={20}
              step={1}
              value={[powerIndex]}
              onValueChange={(v) => setPowerIndex(Array.isArray(v) ? v[0] : v)}
            />
            <div>
              <span>0.80 · weaker</span>
              <button onClick={() => setPowerIndex(10)}>1.00 · original</button>
              <span>1.25 · stronger</span>
            </div>
          </div>
        </div>
        <p className="sensitivity-method">
          Power-scaling reweights the existing draws using ArviZ PSIS.{' '}
          {group === 'prior'
            ? 'All model priors are perturbed jointly; this is not a change to one prior’s scale parameter.'
            : 'The joint likelihood is perturbed while the priors stay fixed.'}{' '}
          The fitted model stays unchanged.
        </p>
      </section>

      <div
        className={`sensitivity-status ${reliable ? '' : 'sensitivity-caution'}`}
        aria-live="polite"
      >
        {reliable ? <Activity size={20} /> : <TriangleAlert size={20} />}
        <div>
          <strong>
            {!fitHealthy
              ? 'Review convergence first'
              : selected.reliable
                ? 'Reweighting checks passed'
                : 'Reweighting is unreliable at this power'}
          </strong>
          <p>
            {!fitHealthy
              ? 'These plots are exploratory because the source fit did not pass convergence checks.'
              : selected.reliable
                ? 'Local sensitivity is an approximation, not a test of causal identification.'
                : 'Move closer to 1.00, or refit with explicit alternative assumptions before interpreting this shift.'}
          </p>
        </div>
        <div className="sensitivity-health">
          <span>
            Pareto k{' '}
            <b>
              {selected.paretoK === null
                ? 'Unavailable'
                : selected.paretoK.toFixed(2)}
            </b>
            <small>below {s.paretoThreshold.toFixed(2)}</small>
          </span>
          <span>
            Weight ESS <b>{number(selected.weightEss)}</b>
            <small>of {number(s.draws)} draws · not MCMC ESS</small>
          </span>
        </div>
      </div>

      <div className="sensitivity-plots">
        <section className="panel sensitivity-plot">
          <div className="sensitivity-plot-heading">
            <div className="eyebrow">POSTERIOR DISTRIBUTION</div>
            <h3>{label(channels[c])} contribution</h3>
            <p>
              <span className="sensitivity-key original" /> Original{' '}
              <span className="sensitivity-key perturbed" /> {group} ×{' '}
              {selected.power.toFixed(2)}
            </p>
          </div>
          <div
            className="sensitivity-chart"
            aria-label="Original and power-scaled posterior density; drag the lower handles to zoom"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={density}
                margin={{ top: 12, right: 20, bottom: 12, left: 6 }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke="#344032"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={axis}
                  tickFormatter={compact}
                  minTickGap={30}
                />
                <YAxis
                  tick={axis}
                  width={58}
                  tickFormatter={(v) => Number(v).toPrecision(2)}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) =>
                    `Weekly contribution: ${number(Number(v), 1)}`
                  }
                  formatter={(v, name) => [
                    Number(v).toPrecision(3),
                    name === 'baseline'
                      ? 'Original density'
                      : 'Reweighted density',
                  ]}
                />
                <Area
                  type="linear"
                  dataKey="baseline"
                  stroke={baseColor}
                  fill={baseColor}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Area
                  type="linear"
                  dataKey="selected"
                  stroke={selectedColor}
                  fill={selectedColor}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  strokeDasharray={reliable ? undefined : '5 4'}
                  isAnimationActive={false}
                />
                <Brush
                  dataKey="x"
                  height={22}
                  stroke="#728569"
                  fill="#172119"
                  tickFormatter={compact}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="sensitivity-caption">
            Density · original outcome units per week. Drag the lower handles to
            zoom; hover for exact values.
          </p>
        </section>
        <section className="panel sensitivity-plot">
          <div className="sensitivity-plot-heading">
            <div className="eyebrow">SENSITIVITY ACROSS POWERS</div>
            <h3>How the estimate moves</h3>
            <p>Median and 90% credible interval · click to select a power</p>
          </div>
          <div
            className="sensitivity-chart"
            aria-label="Posterior median and 90 percent interval across power settings"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={trajectory}
                margin={{ top: 12, right: 20, bottom: 12, left: 6 }}
                accessibilityLayer
                onClick={(state) => choosePower(state?.activeLabel)}
              >
                <CartesianGrid
                  stroke="#344032"
                  strokeDasharray="3 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="power"
                  type="number"
                  domain={[0.8, 1.25]}
                  ticks={[0.8, 0.9, 1, 1.1, 1.25]}
                  tick={axis}
                  tickFormatter={(v) => `${Number(v).toFixed(2)}×`}
                />
                <YAxis
                  tick={axis}
                  width={58}
                  tickFormatter={compact}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => `Power: ${Number(v).toFixed(2)}×`}
                  formatter={(v, name) => [
                    Array.isArray(v)
                      ? v.map((x) => number(Number(x), 1)).join(' – ')
                      : number(Number(v), 1),
                    name === 'interval' ? '90% interval' : 'Median',
                  ]}
                />
                <ReferenceLine x={1} stroke={baseColor} strokeDasharray="4 4" />
                <ReferenceLine
                  y={reference.median}
                  stroke={baseColor}
                  strokeDasharray="4 4"
                />
                <Area
                  dataKey="interval"
                  type="linear"
                  stroke="none"
                  fill={selectedColor}
                  fillOpacity={0.12}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="median"
                  type="linear"
                  stroke={selectedColor}
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    return (
                      <circle
                        key={payload.index}
                        cx={cx}
                        cy={cy}
                        r={payload.index === powerIndex ? 6 : 3}
                        fill={payload.reliable ? selectedColor : '#edb866'}
                        stroke="#172119"
                        strokeWidth={1.5}
                      />
                    );
                  }}
                />
                <ReferenceLine x={selected.power} stroke={selectedColor} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="sensitivity-caption">
            Purple guides mark the original fit. Amber points flag unreliable
            reweighting. The power slider also works with arrow keys.
          </p>
        </section>
      </div>
      <div className="sensitivity-summary" aria-live="polite">
        <span>
          Original median <strong>{number(reference.median, 1)}</strong>
        </span>
        <span>
          Selected median <strong>{number(current.median, 1)}</strong>
        </span>
        <span>
          Median change{' '}
          <strong>
            {delta > 0 ? '+' : ''}
            {number(delta, 1)}
          </strong>
        </span>
        <span>
          Selected 90% interval{' '}
          <strong>
            {number(current.low, 1)} – {number(current.high, 1)}
          </strong>
        </span>
      </div>
      <section className="panel sensitivity-score-panel">
        <h3>Local sensitivity by channel</h3>
        <p>
          ArviZ CJS sensitivity near power 1.00 (0.99 / 1.01). The 0.05
          reference flags potential issues for investigation; it is not a
          universal pass/fail test.
        </p>
        <div className="sensitivity-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Prior</th>
                <th>Likelihood</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((name, i) => (
                <tr key={name} data-selected={i === c}>
                  <td>
                    <button
                      aria-pressed={i === c}
                      onClick={() => setChannel(i)}
                    >
                      {label(name)} <ArrowRight size={14} />
                    </button>
                  </td>
                  <td>{s.scores.prior[i]?.toFixed(3) ?? 'Unavailable'}</td>
                  <td>{s.scores.likelihood[i]?.toFixed(3) ?? 'Unavailable'}</td>
                  <td>
                    {sensitivityDiagnosis(
                      s.scores.prior[i],
                      s.scores.likelihood[i],
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Inspect flagged channels with alternative priors and refits.{' '}
          <a
            href="https://arviz-devs.github.io/EABM/Chapters/Sensitivity_checks.html"
            target="_blank"
            rel="noreferrer"
          >
            How to interpret sensitivity ↗
          </a>
        </p>
      </section>
    </div>
  );
}
