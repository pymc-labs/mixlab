import {
  canonicalCSV,
  type Config,
  type Dataset,
  type Mapping,
  type Posterior,
  type RawTable,
  validate,
} from './core.ts';
export const SOURCE_URL = 'https://github.com/twiecki/mixlab';
export const NOTEBOOK_URL = 'https://notebook.link/github.com/twiecki/mixlab';
export function modelSource(config: Config) {
  return `from pathlib import Path
import json
import pandas as pd
from pymc_marketing.mmm import MMM, GeometricAdstock, LogisticSaturation
from pymc_extras.prior import Prior

config = json.loads(${JSON.stringify(JSON.stringify(config))})
data = pd.read_csv('mixlab-data.csv', parse_dates=['date'])
channels = [c for c in data.columns if c.startswith('channel_')]
controls = [c for c in data.columns if c.startswith('control_')]

mmm = MMM(
    date_column='date',
    channel_columns=channels,
    control_columns=controls or None,
    adstock=GeometricAdstock(
        l_max=config['lag'], normalize=True,
        priors={'alpha': Prior('Beta', **config.get('adstockPrior', {'alpha': 1, 'beta': 3}))},
    ),
    saturation=LogisticSaturation(
        priors={
            'beta': Prior('HalfNormal', sigma=config['priorScale']),
            'lam': Prior('Gamma', **config.get('saturationPrior', {'alpha': 3, 'beta': 1})),
        },
    ),
    yearly_seasonality=2 if config['seasonality'] else None,
)
mmm.build_model(data.drop(columns='y'), data.y)
model = mmm._get_sampling_model()
`;
}
export function sampleSource(c: Config) {
  return `import pymc as pm

with model:
    idata = pm.sample(
        chains=${c.chains}, tune=${c.tune}, draws=${c.draws},
        target_accept=${c.targetAccept}, random_seed=${c.seed},
    )
mmm.idata = idata
`;
}
export function pythonScript(c: Config) {
  return `# Mixlab: an ordinary, editable PyMC-Marketing model.
# Install: pip install pymc-marketing==1.1.0 pymc==6.2.0
# Place the exported mixlab-data.csv beside this script.
${modelSource(c)}
${sampleSource(c)}
idata.to_netcdf('mixlab-posterior.nc')
`;
}
export function labPayload(data: Dataset, c: Config) {
  return {
    version: 1,
    source: modelSource(c).replace(
      "pd.read_csv('mixlab-data.csv'",
      "pd.read_csv('/mixlab-data.csv'",
    ),
    csv: canonicalCSV(data),
    config: c,
    varNames: [
      'adstock_alpha',
      'saturation_lam',
      'saturation_beta',
      'y_sigma',
      'intercept_contribution',
      'channel_contribution',
      ...(data.controls.length ? ['gamma_control'] : []),
      ...(c.seasonality ? ['gamma_fourier'] : []),
    ],
  };
}
function markdown(source: string, id: string) {
  return {
    cell_type: 'markdown',
    id,
    metadata: {},
    source: source.split(/(?<=\n)/),
  };
}
function code(source: string, id: string) {
  return {
    cell_type: 'code',
    id,
    metadata: {},
    execution_count: null,
    outputs: [],
    source: source.split(/(?<=\n)/),
  };
}
export function notebook(
  data: Dataset,
  c: Config,
  mode: 'native' | 'browser',
  origin: string,
) {
  const cells: ReturnType<typeof markdown | typeof code>[] = [
    markdown(
      `# Your mix, your model\n\nExported from **Mixlab**. This notebook contains your data and the complete model configuration. It is yours to inspect, change, and extend.\n\n- ${data.y.length} weeks\n- Channels: ${data.channels.join(', ')}\n- Controls: ${data.controls.join(', ') || 'none'}\n- ${c.chains} chains × ${c.draws} retained draws\n\nThe data remain local until you choose to upload or share this notebook.`,
      'intro',
    ),
  ];
  if (mode === 'native') {
    cells.push(
      markdown(
        '## Environment\nRun in a local Jupyter environment with Python 3.13. This native notebook uses ordinary PyMC sampling. For browser sampling, export the **Browser notebook** instead.',
        'environment',
      ),
    );
    cells.push(
      code(
        '# Run once if these packages are not installed:\n# %pip install pymc-marketing==1.1.0 pymc==6.2.0 arviz-stats==1.3.0 matplotlib\n',
        'install',
      ),
    );
    cells.push(
      code(
        `from pathlib import Path\nimport json\n\ncsv_text = json.loads(${JSON.stringify(JSON.stringify(canonicalCSV(data)))})\nPath('mixlab-data.csv').write_text(csv_text)\n`,
        'data',
      ),
    );
    cells.push(
      markdown(
        '## The model\nEdit the priors, transformations, controls, or model structure directly. There is no Mixlab-specific model format.',
        'model-description',
      ),
    );
    cells.push(code(modelSource(c), 'model'));
    cells.push(code(sampleSource(c), 'sample'));
    cells.push(
      code(
        "import arviz_stats as az\n\nparameters = ['adstock_alpha', 'saturation_lam', 'saturation_beta', 'y_sigma']\naz.summary(idata, var_names=parameters)\n",
        'diagnostics',
      ),
    );
    cells.push(
      markdown(
        '## Check predictions\nAn in-sample posterior predictive check assesses fit, not out-of-sample performance or causal identification. Inspect R-hat, bulk/tail ESS, divergences, priors, and identification before interpreting channel effects.',
        'prediction-note',
      ),
    );
    cells.push(
      code(
        `prediction = mmm.sample_posterior_predictive(\n    data.drop(columns='y'), combined=False, random_seed=${c.seed + 100}, progressbar=False,\n)\ntarget_scale = mmm.get_scales_as_xarray()['target_scale']\nq = (prediction['y'] * target_scale).quantile([.05, .5, .95], dim=['chain', 'draw'])\n\nimport matplotlib.pyplot as plt\nfig, ax = plt.subplots(figsize=(12, 4))\nax.plot(data.date, data.y, label='Observed', alpha=.7)\nax.plot(data.date, q.sel(quantile=.5), label='Predicted median')\nax.fill_between(data.date, q.sel(quantile=.05), q.sel(quantile=.95), alpha=.2, label='90% predictive interval')\nax.legend()\nax.set_ylabel('Outcome · original units')\n`,
        'prediction',
      ),
    );
    cells.push(
      code(
        "idata.to_netcdf('mixlab-posterior.nc')\nmmm.idata = idata\n# Continue with any PyMC-Marketing or xarray analysis here.\n",
        'continue',
      ),
    );
  } else {
    const payload = labPayload(data, c);
    cells.push(
      markdown(
        '## Browser-native route\nOpen this notebook in notebook.link or any Jupyter environment with IPython. The notebook prepares editable Python source and a local browser lab. PyMC, Numba, and nuts-rs run in the lab’s WebAssembly worker. The notebook kernel only needs Python and IPython.\n\nThe browser lab downloads about 120 MB on first use. Its origin must be reachable and, for a private deployment, signed in. If embedding is blocked, use the separate-tab link. Nothing executes until you click **Run model**.',
        'browser-route',
      ),
    );
    cells.push(
      code(
        `import json\n\nmodel_source = json.loads(${JSON.stringify(JSON.stringify(payload.source))})\nprint(model_source)\n`,
        'source',
      ),
    );
    cells.push(
      code(
        `csv_text = json.loads(${JSON.stringify(JSON.stringify(payload.csv))})\nsettings = json.loads(${JSON.stringify(JSON.stringify(c))})\nvariable_names = json.loads(${JSON.stringify(JSON.stringify(payload.varNames))})\n`,
        'data-settings',
      ),
    );
    cells.push(
      markdown(
        '## Edit freely, then open the lab\nThe code cell above contains `model_source` as a string; replace or edit it as needed. Define a PyMC `model`, and update `variable_names` if you change its variables. The lab also has an editable Python cell for continuing with `mmm` and `idata`.',
        'edit',
      ),
    );
    cells.push(
      code(
        `from IPython.display import IFrame, HTML, display\nfrom urllib.parse import quote\nfrom html import escape\n\napp_url = ${JSON.stringify(origin)}  # Or a self-hosted Mixlab origin.\npayload = dict(version=1, source=model_source, csv=csv_text, config=settings, varNames=variable_names)\n# A URL fragment is not sent in the HTTP request; do not share this link with private data.\nurl = app_url.rstrip('/') + '/notebook.html#' + quote(json.dumps(payload), safe='')\ndisplay(HTML('<a target="_blank" rel="noopener" href="' + escape(url, quote=True) + '">Open the Python lab in a separate tab</a>'))\ndisplay(IFrame(url, width='100%', height=1100))\n`,
        'launch',
      ),
    );
    cells.push(
      markdown(
        '## Take results anywhere\nDownload Arrow posterior and sampler-statistic files from the lab. Its follow-up Python cell can inspect `idata`, calculate predictions, or run other analysis in the same browser kernel.\n\nFor a native Python session, export the Native PyMC notebook from Mixlab. Both routes use the same model specification, but native PyMC and nuts-rs are different samplers and do not produce identical random draws.',
        'results',
      ),
    );
  }
  return {
    cells,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: { name: 'python', version: '3.13' },
      mixlab: { version: 1, mode },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}
export type SavedProject = {
  dataset: RawTable;
  mapping: Mapping;
  config: Config;
  posterior: Posterior | null;
  scenarioMultipliers: number[];
};
export function readProject(text: string): SavedProject {
  if (text.length > 20_000_000)
    throw Error('Choose a project smaller than 20 MB.');
  const p = JSON.parse(text);
  if (p.format !== 'mixlab-project' || p.version !== 1)
    throw Error('This is not a supported Mixlab project.');
  const t = p.dataset,
    m = p.mapping,
    c = p.config;
  if (
    !t ||
    typeof t.name !== 'string' ||
    !Array.isArray(t.headers) ||
    t.headers.some((h: unknown) => typeof h !== 'string') ||
    t.headers.length > 60 ||
    new Set(t.headers).size !== t.headers.length ||
    !Array.isArray(t.rows) ||
    t.rows.length > 520 ||
    t.rows.some(
      (r: unknown) =>
        !r ||
        typeof r !== 'object' ||
        t.headers.some(
          (h: string) => typeof (r as Record<string, unknown>)[h] !== 'string',
        ),
    )
  )
    throw Error('The project dataset is malformed.');
  if (
    !m ||
    typeof m.date !== 'string' ||
    typeof m.target !== 'string' ||
    !Array.isArray(m.channels) ||
    !Array.isArray(m.controls) ||
    [...m.channels, ...m.controls].some((v) => typeof v !== 'string')
  )
    throw Error('The project column mapping is malformed.');
  if (
    !c ||
    ![2, 4].includes(c.chains) ||
    ![500, 1000, 1500].includes(c.draws) ||
    ![750, 1000, 1500].includes(c.tune) ||
    ![0.9, 0.95, 0.99].includes(c.targetAccept) ||
    !Number.isInteger(c.lag) ||
    c.lag < 2 ||
    c.lag > 16 ||
    typeof c.seasonality !== 'boolean' ||
    !Number.isFinite(c.priorScale) ||
    c.priorScale < 0.25 ||
    c.priorScale > 4 ||
    !Number.isInteger(c.seed) ||
    c.seed < 0 ||
    c.seed > 2147483000
  )
    throw Error('The project sampling settings are unsupported.');
  for (const name of ['adstockPrior', 'saturationPrior']) {
    const prior = c[name];
    if (
      prior !== undefined &&
      (!prior ||
        typeof prior !== 'object' ||
        ![prior.alpha, prior.beta].every(
          (v) =>
            typeof v === 'number' &&
            Number.isFinite(v) &&
            v >= 0.001 &&
            v <= 400,
        ))
    )
      throw Error(
        'Prior shape and rate parameters must be between 0.001 and 400.',
      );
  }
  const checked = validate(t, m);
  if (!checked.data)
    throw Error(`The saved data need review: ${checked.errors[0]}`);
  let posterior: Posterior | null = p.posterior ?? null;
  if (posterior) {
    const n = posterior.alpha?.length,
      k = m.channels.length,
      rows = t.rows.length;
    const vector = (x: unknown, size: number) =>
      Array.isArray(x) && x.length === size && x.every(Number.isFinite);
    const matrix = (x: unknown) =>
      Array.isArray(x) && x.length === n && x.every((r) => vector(r, k));
    const ordered = (v: unknown) => {
      const q = v as { low: number; median: number; high: number };
      return (
        q &&
        [q.low, q.median, q.high].every(Number.isFinite) &&
        q.low <= q.median &&
        q.median <= q.high
      );
    };
    if (
      !Number.isInteger(n) ||
      n !== c.chains * c.draws ||
      n > 6000 ||
      (posterior.predictiveMean !== undefined &&
        !vector(posterior.predictiveMean, n)) ||
      !matrix(posterior.alpha) ||
      !matrix(posterior.beta) ||
      !matrix(posterior.lam) ||
      !vector(posterior.channelScale, k) ||
      posterior.channelScale.some((v) => v <= 0) ||
      !Number.isFinite(posterior.targetScale) ||
      posterior.targetScale <= 0 ||
      !Array.isArray(posterior.contributions) ||
      posterior.contributions.length !== k ||
      !posterior.contributions.every(ordered) ||
      !posterior.prediction ||
      !['low', 'median', 'high'].every((v) =>
        vector(posterior!.prediction[v as 'low'], rows),
      )
    )
      throw Error('The saved posterior is malformed.');
    if (
      posterior.alpha.some((r) => r.some((v) => v < 0 || v > 1)) ||
      posterior.beta.some((r) => r.some((v) => v < 0)) ||
      posterior.lam.some((r) => r.some((v) => v <= 0))
    )
      throw Error('The saved model parameters are outside their domains.');
    if (
      posterior.prediction.low.some(
        (v, i) =>
          v > posterior!.prediction.median[i] ||
          posterior!.prediction.median[i] > posterior!.prediction.high[i],
      )
    )
      throw Error('The saved predictive intervals are not ordered.');
    const d = posterior.diagnostics;
    if (
      !d ||
      !['maxRhat', 'minEss', 'minTailEss'].every(
        (k) =>
          d[k as 'maxRhat'] === null ||
          (Number.isFinite(d[k as 'maxRhat']) && d[k as 'maxRhat']! >= 0),
      ) ||
      !Number.isInteger(d.divergences) ||
      d.divergences < 0 ||
      ![d.compileSeconds, d.samplingSeconds].every(
        (v) => Number.isFinite(v) && v >= 0,
      )
    )
      throw Error('The saved diagnostics are malformed.');
  }
  const channelSpend = checked.data.channels.map((_, j) =>
    checked.data!.x.reduce((sum, row) => sum + row[j], 0),
  );
  const totalSpend = channelSpend.reduce((sum, v) => sum + v, 0);
  const multipliers =
    Array.isArray(p.scenarioMultipliers) &&
    p.scenarioMultipliers.length === m.channels.length &&
    p.scenarioMultipliers.every(
      (v: unknown, i: number) =>
        typeof v === 'number' &&
        Number.isFinite(v) &&
        v >= 0 &&
        v <= Math.max(2, totalSpend / channelSpend[i]) + 1e-9,
    )
      ? p.scenarioMultipliers
      : [];
  return {
    dataset: { ...t, example: false },
    mapping: {
      date: m.date,
      target: m.target,
      channels: m.channels,
      controls: m.controls,
    },
    config: {
      lag: c.lag,
      seasonality: c.seasonality,
      chains: c.chains,
      tune: c.tune,
      draws: c.draws,
      targetAccept: c.targetAccept,
      seed: c.seed,
      priorScale: c.priorScale,
      ...(c.adstockPrior
        ? {
            adstockPrior: {
              alpha: c.adstockPrior.alpha,
              beta: c.adstockPrior.beta,
            },
          }
        : {}),
      ...(c.saturationPrior
        ? {
            saturationPrior: {
              alpha: c.saturationPrior.alpha,
              beta: c.saturationPrior.beta,
            },
          }
        : {}),
    },
    posterior,
    scenarioMultipliers: multipliers,
  };
}
