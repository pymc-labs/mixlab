import runtimeManifest from '../runtime-manifest.json';
import type { FitArtifact } from './workspace';
import { createSampler } from '../vendor/nuts-rs-wasm/client.mjs';
import { createSamplerSession } from './sampler-session.mjs';
import { wrap } from '../vendor/nuts-rs-wasm/comlink.mjs';
import {
  canonicalCSV,
  type Config,
  type Dataset,
  type Posterior,
} from './core';
export type ProgressState = {
  phase: string;
  percent: number | null;
  chain: number;
  retained: number;
  alpha: number[];
};
export type Trace = { chain: number; group: string; bytes: Uint8Array };
const session = createSamplerSession(() =>
  createSampler({
    wrap,
    runtimeUrl: '/runtime/',
    environment: 'pymc-marketing-wasm',
    assetsUrl: new URL('/nuts/', location.href),
  }),
);
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', session.close);
export function cancelFit() {
  session.close();
}
export async function fit(
  data: Dataset,
  config: Config,
  onUpdate: (p: ProgressState) => void,
  signal: AbortSignal,
): Promise<{ posterior: Posterior; traces: Trace[]; artifact: FitArtifact }> {
  const [modelResponse, analysisResponse, sensitivityResponse] =
    await Promise.all([
      fetch('/python/model.py', { signal }),
      fetch('/python/analyze.py', { signal }),
      fetch('/python/sensitivity.py', { signal }),
    ]).catch((error) => {
      if (signal.aborted) throw error;
      throw Error(
        'Could not reach the Mixlab server to load the model files. Check that this site or local preview is still running, then retry the fit.',
      );
    });
  if (!modelResponse.ok || !analysisResponse.ok || !sensitivityResponse.ok)
    throw Error('Model files could not be loaded. Reload and try again.');
  const model = await modelResponse.text(),
    analysis =
      (await sensitivityResponse.text()) +
      '\n' +
      (await analysisResponse.text());
  const progress: ProgressState = {
    phase: 'Loading browser runtime',
    percent: null,
    chain: 0,
    retained: 0,
    alpha: [],
  };
  let output = '',
    posterior: Posterior | null = null;
  const result = await session.run(model, {
    ...config,
    resultFormat: 'binary',
    retainUnconstrained: false,
    varNames: [
      'adstock_alpha',
      'saturation_lam',
      'saturation_beta',
      'y_sigma',
      'intercept_contribution',
      'channel_contribution',
      ...(data.controls.length ? ['gamma_control'] : []),
      ...(config.seasonality ? ['gamma_fourier'] : []),
    ],
    files: {
      '/mixlab-data.csv': canonicalCSV(data),
      '/mixlab-config.json': JSON.stringify({
        lag: config.lag,
        seasonality: config.seasonality,
        priorScale: config.priorScale,
        adstockPrior: config.adstockPrior ?? { alpha: 1, beta: 3 },
        saturationPrior: config.saturationPrior ?? { alpha: 3, beta: 1 },
      }),
    },
    signal,
    // Model handles restore `model`, but other Python globals remain shared.
    // Refresh run settings (especially prediction seed) for every fit.
    afterSample:
      `config.update(json.loads(${JSON.stringify(JSON.stringify(config))}))\n` +
      analysis,
    onPhase: (phase: string) => {
      progress.phase = phase;
      progress.percent = null;
      onUpdate({ ...progress });
    },
    onProgress: ({
      chain,
      index,
      tuning,
    }: {
      chain: number;
      index: number;
      tuning: boolean;
    }) => {
      progress.phase = tuning
        ? 'Warming up the sampler'
        : 'Drawing from the posterior';
      progress.chain = chain + 1;
      progress.percent =
        (100 * (chain * (config.tune + config.draws) + index + 1)) /
        (config.chains * (config.tune + config.draws));
      onUpdate({ ...progress });
    },
    onSamples: ({
      draws,
      values,
      layout,
    }: {
      draws: number;
      values: Float64Array;
      layout: { name: string; size: number }[];
    }) => {
      let offset = 0,
        width = 0;
      for (const v of layout) {
        if (v.name === 'adstock_alpha') offset = width;
        width += v.size;
      }
      progress.retained += draws;
      for (let i = 0; i < draws; i++)
        progress.alpha.push(values[i * width + offset]);
      if (progress.alpha.length > 4000)
        progress.alpha.splice(0, progress.alpha.length - 4000);
      onUpdate({ ...progress, alpha: [...progress.alpha] });
    },
    onOutput: (text: string) => {
      output += text;
      const lines = output.split('\n');
      output = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('MIXLAB_EVENT ')) continue;
        const event = JSON.parse(line.slice(13));
        if (event.type === 'phase') {
          progress.phase = event.phase;
          onUpdate({ ...progress });
        }
        if (event.type === 'result') posterior = event.posterior;
      }
    },
  });
  if (!posterior) {
    session.close();
    throw Error('The sampler finished without complete results. Please retry.');
  }
  (posterior as Posterior).diagnostics.compileSeconds = result.compile_seconds;
  return {
    posterior,
    traces: result.traces,
    artifact: { model, analysis, runtime: runtimeManifest.archive.sha256 },
  };
}
