'use client';
import { useEffect, useRef, useState } from 'react';
import betaWidget from '../vendor/modist/beta.mjs';
import gammaWidget from '../vendor/modist/gamma.mjs';
import '../vendor/modist/styles.css';
import { PriorPredictive } from './prior-predictive';
import type { Dataset, Config, ShapePrior } from '../lib/core';

// Minimal anywidget model contract; all state stays in React on this device.
function Distribution({
  family,
  value,
  onChange,
}: {
  family: 'Beta' | 'Gamma';
  value: ShapePrior;
  onChange: (p: ShapePrior) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const state = useRef<{ update: (p: ShapePrior) => void } | null>(null);
  useEffect(() => {
    const el = host.current!;
    let params = { ...value };
    const listeners = new Map<string, (() => void)[]>();
    const notify = () => listeners.forEach((fns) => fns.forEach((fn) => fn()));
    const model = {
      get: (key: keyof ShapePrior) => params[key],
      set: (key: keyof ShapePrior, v: number) => {
        params[key] = v;
      },
      on: (event: string, fn: () => void) => {
        listeners.set(event, [...(listeners.get(event) || []), fn]);
      },
      save_changes: () => {
        notify();
        callback.current({ ...params });
      },
    };
    (family === 'Beta' ? betaWidget : gammaWidget).render({ model, el });
    state.current = {
      update: (p) => {
        params = { ...p };
        notify();
      },
    };
    return () => {
      listeners.clear();
      state.current = null;
      el.replaceChildren();
    };
  }, [family]);
  useEffect(() => {
    if (valid(value)) state.current?.update(value);
  }, [value]);
  return (
    <div
      ref={host}
      className="modist-chart"
      aria-label={`${family} prior density — drag the mean or quartiles`}
    />
  );
}
const valid = (p: ShapePrior) =>
  [p.alpha, p.beta].every((v) => Number.isFinite(v) && v >= 0.001 && v <= 400);
export function PriorEditor({
  config,
  data,
  disabled,
  onApply,
}: {
  config: Config;
  data: Dataset | null;
  disabled: boolean;
  onApply: (
    adstock: ShapePrior,
    saturation: ShapePrior,
    priorScale: number,
  ) => void;
}) {
  const appliedA = config.adstockPrior ?? { alpha: 1, beta: 3 };
  const appliedS = config.saturationPrior ?? { alpha: 3, beta: 1 };
  const [priorScale, setPriorScale] = useState(config.priorScale);
  useEffect(() => setPriorScale(config.priorScale), [config.priorScale]);
  const [adstock, setAdstock] = useState(appliedA);
  const [saturation, setSaturation] = useState(appliedS);
  useEffect(() => {
    setAdstock(appliedA);
    setSaturation(appliedS);
  }, [appliedA.alpha, appliedA.beta, appliedS.alpha, appliedS.beta]);
  const changed =
    JSON.stringify([adstock, saturation, priorScale]) !==
    JSON.stringify([appliedA, appliedS, config.priorScale]);
  const okay = valid(adstock) && valid(saturation);
  return (
    <section className="panel prior-studio">
      <div className="eyebrow">PRIOR STUDIO · POWERED BY MODIST</div>
      <h3>Shape what you believe.</h3>
      <p>
        Drag a curve to express your assumptions before fitting. Explore freely;
        apply when ready.
      </p>
      <fieldset disabled={disabled}>
        <div className="prior-grid">
          {(
            [
              {
                title: 'Carryover',
                variable: 'α',
                family: 'Beta',
                value: adstock,
                set: setAdstock,
                description:
                  'Fraction retained each week, before finite-window normalization. Shared prior across channels.',
              },
              {
                title: 'Saturation speed',
                variable: 'λ',
                family: 'Gamma',
                value: saturation,
                set: setSaturation,
                description:
                  'Higher values saturate sooner. Spend is scaled by each channel’s maximum. β below is the Gamma rate.',
              },
            ] as const
          ).map((item) => (
            <div className="prior-card" key={item.family}>
              <h4>
                {item.title}{' '}
                <span>
                  {item.variable} ~ {item.family}
                </span>
              </h4>
              <Distribution
                family={item.family}
                value={item.value}
                onChange={item.set}
              />
              <div className="prior-parameters">
                {(['alpha', 'beta'] as const).map((key) => (
                  <label key={key}>
                    {key === 'alpha'
                      ? 'Shape α'
                      : item.family === 'Gamma'
                        ? 'Rate β'
                        : 'Shape β'}
                    <input
                      aria-label={`${item.title} ${key}`}
                      type="number"
                      min="0.001"
                      max="400"
                      step="0.1"
                      value={
                        Number.isNaN(item.value[key]) ? '' : item.value[key]
                      }
                      onChange={(e) =>
                        item.set({
                          ...item.value,
                          [key]: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="tiny">{item.description}</p>
            </div>
          ))}
        </div>
        <label className="prior-scale">
          Channel effect prior scale · HalfNormal(σ = {priorScale})
          <input
            type="range"
            aria-label="Preview channel effect prior scale"
            min="0.25"
            max="4"
            step="0.25"
            value={priorScale}
            onChange={(e) => setPriorScale(Number(e.target.value))}
          />
        </label>
        {okay && data ? (
          <PriorPredictive
            data={data}
            config={{
              ...config,
              priorScale,
              adstockPrior: adstock,
              saturationPrior: saturation,
            }}
          />
        ) : (
          <p role="status">
            {okay
              ? 'Load and validate a dataset to preview prior predictions against observations.'
              : 'Enter valid prior parameters to resume the preview.'}
          </p>
        )}
        <div className="prior-actions">
          <button
            className="primary"
            disabled={!changed || !okay || disabled}
            onClick={() => onApply(adstock, saturation, priorScale)}
          >
            Apply priors to model
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setPriorScale(2);
              setAdstock({ alpha: 1, beta: 3 });
              setSaturation({ alpha: 3, beta: 1 });
            }}
          >
            PyMC-Marketing defaults
          </button>
          <span className="tiny" role="status">
            {!okay
              ? 'Use finite parameters between 0.001 and 400.'
              : changed
                ? 'Unapplied changes · applying clears the previous fit.'
                : 'These priors are in your model and exports.'}
          </span>
        </div>
      </fieldset>
      <p className="tiny">
        Actual{' '}
        <a
          href="https://github.com/williambdean/modist"
          target="_blank"
          rel="noreferrer"
        >
          Modist widgets by Will Dean ↗
        </a>
        . Curve editing expresses assumptions; it does not estimate priors from
        your data. The effect scale above is applied to the model together with
        the curve priors.
      </p>
    </section>
  );
}
