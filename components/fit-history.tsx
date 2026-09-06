// oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The horizontally scrollable comparison must be keyboard focusable.
'use client';
import { Button } from '@/components/ui/button';
import { compact, download, healthy, label } from '../lib/core';
import {
  datasetKey,
  describeChanges,
  selectedFit,
  settingsMatch,
  type Workspace,
} from '../lib/workspace';

type Props = {
  workspace: Workspace;
  busy: boolean;
  onSelect: (id: string) => void;
  onUseSettings: (id: string) => void;
};
export function FitHistory({
  workspace,
  busy,
  onSelect,
  onUseSettings,
}: Props) {
  if (!workspace.fits.length) return null;
  const active = selectedFit(workspace);
  const comparable = workspace.fits.filter(
    (f) => datasetKey(f) === datasetKey(workspace.draft),
  );
  return (
    <details className="fit-history">
      <summary>
        {workspace.fits.length} saved{' '}
        {workspace.fits.length === 1 ? 'fit' : 'fits'} ·{' '}
        {comparable.length > 1 ? 'Compare fits' : 'View history'}
      </summary>
      <p>
        Fits are saved automatically. Viewing a fit keeps your edited settings.
        “Use these settings” brings its assumptions back into the controls.
      </p>
      {comparable.length > 1 && (
        <section
          className="fit-comparison"
          tabIndex={0}
          aria-label="Comparison of fits on the same data"
        >
          <table>
            <caption>
              Same data · average weekly contribution, median [90% interval].
              Intervals describe each fit separately.
            </caption>
            <thead>
              <tr>
                <th scope="col">Channel / diagnostic</th>
                {comparable.map((f) => (
                  <th scope="col" key={f.id}>
                    Fit {f.number}
                    {active?.id === f.id ? ' · showing' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspace.draft.mapping.channels.map((channel, i) => (
                <tr key={channel}>
                  <th scope="row">{label(channel)}</th>
                  {comparable.map((f) => {
                    const c = f.posterior.contributions[i];
                    return (
                      <td key={f.id}>
                        {compact(c.median)}{' '}
                        <span>
                          [{compact(c.low)}, {compact(c.high)}]
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row">Max R-hat</th>
                {comparable.map((f) => (
                  <td key={f.id}>
                    {f.posterior.diagnostics.maxRhat?.toFixed(3) ??
                      'Unavailable'}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Min bulk / tail ESS</th>
                {comparable.map((f) => (
                  <td key={f.id}>
                    {f.posterior.diagnostics.minEss?.toFixed(0) ??
                      'Unavailable'}{' '}
                    /{' '}
                    {f.posterior.diagnostics.minTailEss?.toFixed(0) ??
                      'Unavailable'}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Divergences</th>
                {comparable.map((f) => (
                  <td key={f.id}>{f.posterior.diagnostics.divergences}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      )}
      <div className="fit-cards">
        {[...workspace.fits].reverse().map((f) => {
          const previous = workspace.fits
            .filter(
              (candidate) =>
                candidate.number < f.number &&
                datasetKey(candidate) === datasetKey(f),
            )
            .at(-1);
          const changes = previous
            ? describeChanges(previous.config, f.config)
            : [];
          return (
            <article key={f.id}>
              <strong>
                Fit {f.number}
                {active?.id === f.id ? ' · showing' : ''}
              </strong>
              <p>
                {previous
                  ? changes.length
                    ? changes.join(' · ')
                    : 'Repeated with the same settings'
                  : 'First fit on these data'}
              </p>
              <p>
                {f.dataset.name} · {f.dataset.rows.length} weeks
                {f.completedAt
                  ? ` · ${new Date(f.completedAt).toLocaleString()}`
                  : ' · imported'}
              </p>
              <p>
                {healthy(f.posterior)
                  ? 'Convergence checks passed'
                  : 'Needs convergence review'}
              </p>
              <details>
                <summary>Saved assumptions</summary>
                <p>
                  {f.config.lag}-week carryover · effect prior scale{' '}
                  {f.config.priorScale} · seasonality{' '}
                  {f.config.seasonality ? 'on' : 'off'}
                </p>
                <p>
                  Carryover Beta({f.config.adstockPrior?.alpha ?? 1},{' '}
                  {f.config.adstockPrior?.beta ?? 3}) · saturation Gamma(
                  {f.config.saturationPrior?.alpha ?? 3},{' '}
                  {f.config.saturationPrior?.beta ?? 1})
                </p>
                <p>
                  {f.config.chains} chains × {f.config.draws} draws ·{' '}
                  {f.config.tune} warmup · target acceptance{' '}
                  {f.config.targetAccept} · seed {f.config.seed}
                </p>
                {!f.artifact && (
                  <p>
                    Imported legacy fit: the original executed source was not
                    stored.
                  </p>
                )}
              </details>
              <div className="fit-card-actions">
                <Button
                  variant="outline"
                  disabled={busy || active?.id === f.id}
                  onClick={() => onSelect(f.id)}
                >
                  {datasetKey(f) === datasetKey(workspace.draft)
                    ? 'View results'
                    : 'View data & results'}
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    busy || settingsMatch(workspace.draft.config, f.config)
                  }
                  onClick={() => onUseSettings(f.id)}
                >
                  Use these settings
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    download(
                      `mixlab-fit-${f.number}.json`,
                      JSON.stringify({
                        ...workspace,
                        draft: {
                          dataset: f.dataset,
                          mapping: f.mapping,
                          config: f.config,
                        },
                        fits: [f],
                        selectedFitId: f.id,
                        scenarios: { [f.id]: workspace.scenarios[f.id] ?? [] },
                      }),
                    )
                  }
                >
                  Export this fit
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </details>
  );
}
