// Run in the development site's browser console:
// await (await import('/tests/browser-sampler.mjs')).checkBrowserSampler(console.log)
import { fit, cancelFit } from '../lib/engine.ts';
import {
  parseCSV,
  inferMapping,
  validate,
  defaultConfig,
} from '../lib/core.ts';

export async function checkBrowserSampler(report = console.log) {
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const table = parseCSV(await (await fetch('/example.csv')).text());
  const { data, errors } = validate(table, inferMapping(table));
  assert(data, errors.join('; '));
  const config = { ...defaultConfig, chains: 2, tune: 100, draws: 100 };
  const run = (
    settings = config,
    onUpdate = () => {},
    signal = new AbortController().signal,
  ) => fit(data, settings, onUpdate, signal);
  try {
    report('Fitting the actual MMM with predictions and diagnostics');
    const first = await run();
    assert(
      first.posterior.diagnostics.compileSeconds > 0,
      'Cold fit must compile',
    );
    assert(
      first.traces.length === 4 &&
        first.traces.every((t) => t.bytes.byteLength > 0),
      'Posterior and statistics Arrow traces',
    );
    assert(
      Number.isFinite(first.posterior.diagnostics.maxRhat),
      'R-hat produced',
    );
    assert(
      first.posterior.diagnosticPlots?.length > 0,
      'Interactive diagnostic payload',
    );
    report('Repeating the same seed with the cached model');
    const second = await run();
    assert(
      second.posterior.diagnostics.compileSeconds === 0,
      'Repeated fit must reuse compilation',
    );
    assert(
      JSON.stringify([
        first.posterior.alpha,
        first.posterior.lam,
        first.posterior.beta,
        first.posterior.prediction,
      ]) ===
        JSON.stringify([
          second.posterior.alpha,
          second.posterior.lam,
          second.posterior.beta,
          second.posterior.prediction,
        ]),
      'Seeded posterior reproducibility',
    );
    report('Cancelling during sampling');
    const controller = new AbortController();
    let aborted = false;
    try {
      await run(
        { ...config, tune: 100000 },
        (progress) => {
          if (progress.phase === 'Warming up the sampler') controller.abort();
        },
        controller.signal,
      );
    } catch (error) {
      aborted = error.name === 'AbortError';
    }
    assert(aborted, 'Active sampling must reject with AbortError');
    report('Fitting again after cancellation');
    const recovered = await run();
    assert(
      recovered.posterior.diagnostics.compileSeconds > 0,
      'Cancelled worker must be rebuilt',
    );
    assert(
      JSON.stringify([
        first.posterior.alpha,
        first.posterior.lam,
        first.posterior.beta,
        first.posterior.prediction,
      ]) ===
        JSON.stringify([
          recovered.posterior.alpha,
          recovered.posterior.lam,
          recovered.posterior.beta,
          recovered.posterior.prediction,
        ]),
      'Fresh worker reproducibility',
    );
    report(
      'PASS: MMM fit, diagnostics, Arrow, cached repeat, cancellation and recovery',
    );
    return {
      first: first.posterior.diagnostics,
      repeated: second.posterior.diagnostics,
      recovered: recovered.posterior.diagnostics,
    };
  } finally {
    cancelFit();
  }
}
