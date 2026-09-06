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
let active: { close: () => void } | null = null;
export function cancelFit() {
  active?.close();
  active = null;
}
export async function fit(
  data: Dataset,
  config: Config,
  onUpdate: (p: ProgressState) => void,
  signal: AbortSignal,
): Promise<{ posterior: Posterior; traces: Trace[] }> {
  const clientUrl = '/nuts/client.mjs';
  const [module, modelResponse, analysisResponse] = await Promise.all([
    import(/* @vite-ignore */ clientUrl),
    fetch('/python/model.py'),
    fetch('/python/analyze.py'),
  ]);
  if (!modelResponse.ok || !analysisResponse.ok)
    throw Error('Model files could not be loaded. Reload and try again.');
  const model = await modelResponse.text(),
    analysis = await analysisResponse.text();
  const sampler = module.createSampler({
    runtimeUrl: '/runtime/',
    environment: 'pymc-marketing-wasm',
    assetsUrl: new URL('/nuts/', location.href),
  });
  active = sampler;
  const progress: ProgressState = {
    phase: 'Loading browser runtime',
    percent: null,
    chain: 0,
    retained: 0,
    alpha: [],
  };
  let output = '',
    posterior: Posterior | null = null;
  try {
    const result = await sampler.sample(model, {
      ...config,
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
        '/mixlab-config.json': JSON.stringify(config),
      },
      signal,
      afterSample: analysis,
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
    if (!posterior)
      throw Error(
        'The sampler finished without complete results. Please retry.',
      );
    return { posterior, traces: result.traces };
  } finally {
    sampler.close();
    if (active === sampler) active = null;
  }
}
