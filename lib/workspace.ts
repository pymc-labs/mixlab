import {
  defaultConfig,
  inferMapping,
  type Config,
  type Mapping,
  type Posterior,
  type RawTable,
} from './core.ts';
import { readProjectValue, type SavedProject } from './exports.ts';

export type Draft = Pick<SavedProject, 'dataset' | 'mapping' | 'config'>;
export type FitArtifact = { model: string; analysis: string; runtime: string };
export type CompletedFit = Draft & {
  id: string;
  number: number;
  completedAt: string;
  posterior: Posterior;
  artifact: FitArtifact | null;
};
export type Workspace = {
  format: 'mixlab-project';
  version: 2;
  draft: Draft;
  fits: CompletedFit[];
  selectedFitId: string | null;
  scenarios: Record<string, number[]>;
};
export function createWorkspace(dataset: RawTable): Workspace {
  return {
    format: 'mixlab-project',
    version: 2,
    draft: {
      dataset,
      mapping: inferMapping(dataset),
      config: { ...defaultConfig },
    },
    fits: [],
    selectedFitId: null,
    scenarios: {},
  };
}
export function datasetKey(d: Pick<Draft, 'dataset' | 'mapping'>) {
  return JSON.stringify([
    d.dataset.headers,
    d.dataset.rows,
    d.mapping.date,
    d.mapping.target,
    d.mapping.channels,
    d.mapping.controls,
  ]);
}
function normalizedConfig(c: Config) {
  return [
    c.lag,
    c.seasonality,
    c.priorScale,
    c.adstockPrior?.alpha ?? 1,
    c.adstockPrior?.beta ?? 3,
    c.saturationPrior?.alpha ?? 3,
    c.saturationPrior?.beta ?? 1,
    c.chains,
    c.tune,
    c.draws,
    c.targetAccept,
    c.seed,
  ];
}
export function settingsMatch(a: Config, b: Config) {
  return (
    JSON.stringify(normalizedConfig(a)) === JSON.stringify(normalizedConfig(b))
  );
}
export function selectedFit(w: Workspace) {
  const fit = w.fits.find((f) => f.id === w.selectedFitId);
  return fit && datasetKey(fit) === datasetKey(w.draft) ? fit : null;
}
export function describeChanges(a: Config, b: Config): string[] {
  const changes: string[] = [];
  if (a.lag !== b.lag) changes.push(`carryover ${a.lag} → ${b.lag} weeks`);
  if (a.priorScale !== b.priorScale)
    changes.push(`effect prior ${a.priorScale} → ${b.priorScale}`);
  if (
    (a.adstockPrior?.alpha ?? 1) !== (b.adstockPrior?.alpha ?? 1) ||
    (a.adstockPrior?.beta ?? 3) !== (b.adstockPrior?.beta ?? 3)
  )
    changes.push(
      `carryover prior Beta(${b.adstockPrior?.alpha ?? 1}, ${b.adstockPrior?.beta ?? 3})`,
    );
  if (
    (a.saturationPrior?.alpha ?? 3) !== (b.saturationPrior?.alpha ?? 3) ||
    (a.saturationPrior?.beta ?? 1) !== (b.saturationPrior?.beta ?? 1)
  )
    changes.push(
      `saturation prior Gamma(${b.saturationPrior?.alpha ?? 3}, ${b.saturationPrior?.beta ?? 1})`,
    );
  if (a.seasonality !== b.seasonality)
    changes.push(`seasonality ${b.seasonality ? 'on' : 'off'}`);
  for (const key of [
    'chains',
    'draws',
    'tune',
    'targetAccept',
    'seed',
  ] as const) {
    if (a[key] !== b[key])
      changes.push(
        `${key === 'tune' ? 'warmup' : key === 'targetAccept' ? 'target acceptance' : key} ${a[key]} → ${b[key]}`,
      );
  }
  return changes;
}
export type WorkspaceAction =
  | { type: 'configure'; patch: Partial<Config> }
  | { type: 'mapping'; mapping: Mapping }
  | { type: 'data'; dataset: RawTable; resetConfig?: boolean }
  | { type: 'complete'; fit: CompletedFit; multipliers?: number[] }
  | { type: 'select'; id: string }
  | { type: 'use-settings'; id: string }
  | { type: 'scenario'; multipliers: number[] }
  | { type: 'restore'; workspace: Workspace };

/** The same transitions serve manual controls, the assistant and restoration. */
export function workspaceReducer(
  w: Workspace,
  action: WorkspaceAction,
): Workspace {
  switch (action.type) {
    case 'configure':
      return {
        ...w,
        draft: { ...w.draft, config: { ...w.draft.config, ...action.patch } },
      };
    case 'mapping':
      return { ...w, draft: { ...w.draft, mapping: action.mapping } };
    case 'data':
      return {
        ...w,
        draft: {
          dataset: action.dataset,
          mapping: inferMapping(action.dataset),
          config: action.resetConfig ? { ...defaultConfig } : w.draft.config,
        },
      };
    case 'complete': {
      if (w.fits.some((f) => f.id === action.fit.id)) return w;
      const fit = structuredClone(action.fit);
      const compatible = datasetKey(fit) === datasetKey(w.draft);
      return {
        ...w,
        fits: [...w.fits, fit],
        selectedFitId: compatible ? fit.id : w.selectedFitId,
        scenarios: {
          ...w.scenarios,
          [fit.id]: [...(action.multipliers ?? [])],
        },
      };
    }
    case 'select': {
      const fit = w.fits.find((f) => f.id === action.id);
      if (!fit) return w;
      // Viewing another fit never replaces the edited model settings.
      return {
        ...w,
        selectedFitId: fit.id,
        draft: { ...w.draft, dataset: fit.dataset, mapping: fit.mapping },
      };
    }
    case 'use-settings': {
      const fit = w.fits.find((f) => f.id === action.id);
      return fit
        ? { ...w, draft: { ...w.draft, config: structuredClone(fit.config) } }
        : w;
    }
    case 'scenario': {
      const fit = selectedFit(w);
      return fit
        ? {
            ...w,
            scenarios: { ...w.scenarios, [fit.id]: [...action.multipliers] },
          }
        : w;
    }
    case 'restore':
      return action.workspace;
  }
}
const legacy = (
  d: Draft,
  posterior: Posterior | null = null,
  multipliers: number[] = [],
) => ({
  format: 'mixlab-project',
  version: 1,
  ...d,
  posterior,
  scenarioMultipliers: multipliers,
});
export function readWorkspace(value: unknown): Workspace {
  const p = value as Workspace;
  if (!p || p.format !== 'mixlab-project')
    throw Error('This is not a Mixlab project.');
  if ((p.version as number) === 1) {
    const old = readProjectValue(p);
    const w = createWorkspace(old.dataset);
    w.draft = {
      dataset: old.dataset,
      mapping: old.mapping,
      config: old.config,
    };
    if (old.posterior) {
      w.fits = [
        {
          ...w.draft,
          id: 'imported-fit-1',
          number: 1,
          completedAt: '',
          posterior: old.posterior,
          artifact: null,
        },
      ];
      w.selectedFitId = w.fits[0].id;
      w.scenarios[w.fits[0].id] = old.scenarioMultipliers;
    }
    return w;
  }
  if (
    p.version !== 2 ||
    !p.draft ||
    !Array.isArray(p.fits) ||
    !p.scenarios ||
    typeof p.scenarios !== 'object' ||
    Array.isArray(p.scenarios)
  )
    throw Error('This workspace format is unsupported.');
  const draft = readProjectValue(legacy(p.draft), true);
  const ids = new Set<string>(),
    numbers = new Set<number>();
  const scenarios: Record<string, number[]> = {};
  const fits = p.fits.map((f) => {
    if (
      !f ||
      typeof f.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(f.id) ||
      ids.has(f.id) ||
      !Number.isSafeInteger(f.number) ||
      f.number < 1 ||
      numbers.has(f.number) ||
      typeof f.completedAt !== 'string' ||
      (f.completedAt !== '' && !Number.isFinite(Date.parse(f.completedAt)))
    )
      throw Error('The saved fit history is malformed.');
    ids.add(f.id);
    numbers.add(f.number);
    const checked = readProjectValue(legacy(f, f.posterior, p.scenarios[f.id]));
    if (!checked.posterior)
      throw Error('A completed fit is missing its posterior.');
    if (
      f.artifact !== null &&
      (!f.artifact ||
        !['model', 'analysis', 'runtime'].every(
          (k) => typeof f.artifact![k as keyof FitArtifact] === 'string',
        ))
    )
      throw Error('The saved model source is malformed.');
    scenarios[f.id] = checked.scenarioMultipliers;
    return {
      dataset: checked.dataset,
      mapping: checked.mapping,
      config: checked.config,
      posterior: checked.posterior,
      id: f.id,
      number: f.number,
      completedAt: f.completedAt,
      artifact: f.artifact,
    };
  });
  if (p.selectedFitId !== null && !ids.has(p.selectedFitId))
    throw Error('The selected fit is missing.');
  return {
    format: 'mixlab-project',
    version: 2,
    draft: {
      dataset: draft.dataset,
      mapping: draft.mapping,
      config: draft.config,
    },
    fits,
    selectedFitId: p.selectedFitId,
    scenarios,
  };
}
export function parseWorkspace(text: string) {
  if (text.length > 100_000_000)
    throw Error('Choose a project smaller than 100 MB.');
  return readWorkspace(JSON.parse(text));
}
