"""Summaries and predictions from the actual sampled posterior, on original units."""
import arviz_stats as az
mmm.idata = idata
parameters = ['adstock_alpha', 'saturation_lam', 'saturation_beta', 'y_sigma', 'intercept_contribution']
if controls:
    parameters.append('gamma_control')
if config['seasonality']:
    parameters.append('gamma_fourier')
summary = az.summary(idata, var_names=parameters, round_to='none')

def finite(value):
    value = float(value)
    return value if np.isfinite(value) else None

def complete_metric(series, reduction):
    values = np.asarray(series, dtype=float)
    return finite(reduction(values)) if values.size and np.all(np.isfinite(values)) else None

diagnostics = dict(
    maxRhat=complete_metric(summary.r_hat, np.max), minEss=complete_metric(summary.ess_bulk, np.min),
    minTailEss=complete_metric(summary.ess_tail, np.min),
    divergences=int(idata.sample_stats.diverging.sum()),
    compileSeconds=float(_nuts_compile_seconds), samplingSeconds=float(_nuts_result['sampling_seconds']),
)
emit(type='diagnostics', diagnostics=diagnostics)
emit(type='phase', phase='Computing posterior predictions')
scales = mmm.get_scales_as_xarray()
target_scale = float(scales['target_scale'].values.squeeze())
channel_scale = scales['channel_scale'].sel(channel=channels).values.reshape(-1).tolist()

def draws(name):
    return idata.posterior[name].transpose('chain', 'draw', 'channel').values.reshape(-1, len(channels)).tolist()

contribution = idata.posterior.channel_contribution.mean('date').transpose('chain', 'draw', 'channel').values.reshape(-1, len(channels)) * target_scale
contribution_q = np.quantile(contribution, [.05, .5, .95], axis=0)
prediction = mmm.sample_posterior_predictive(data.drop(columns='y'), combined=False,
    backend='numba', random_seed=config['seed'] + 100, progressbar=False)
y_pred = prediction['y'] * target_scale
q = y_pred.quantile([.05, .5, .95], dim=['chain', 'draw']).transpose('quantile', 'date').values

def diagnostic_plots(idata, parameters):
    """Use ArviZ's data backend; the UI renders its results interactively."""
    import arviz_plots as azp
    import xarray as xr
    result = []
    for name in parameters:
        variable = idata.posterior[name]
        extra_dims = [d for d in variable.dims if d not in ('chain', 'draw')]
        shape = tuple(variable.sizes[d] for d in extra_dims)
        for index in np.ndindex(shape):
            selection = dict(zip(extra_dims, index))
            values = variable.isel(selection).transpose('chain', 'draw')
            coordinate = ', '.join(str(variable[d].values[i]) for d, i in selection.items())
            title = name + (' [' + coordinate + ']' if coordinate else '')
            dataset = xr.Dataset({'value': values})
            item = dict(name=title, chains=values.values.tolist(),
                divergences=[np.flatnonzero(chain).tolist()
                    for chain in idata.sample_stats.diverging.transpose('chain', 'draw').values])
            try:
                if values.sizes['chain'] < 2:
                    raise ValueError('Rank comparison needs at least two chains.')
                rank = azp.plot_rank(dataset, backend='none', method='envelope',
                    envelope_prob=.95, thin=1, aes={'color': ['chain']})
                lines = rank.viz['ecdf_lines'].dataset['value'].values.flatten()
                band = rank.viz['credible_interval'].dataset['value'].item()
                item['rank'] = [dict(x=line['x'].tolist(), y=line['y'].tolist()) for line in lines]
                item['envelope'] = dict(x=band['x'].tolist(), low=band['y_bottom'].tolist(), high=band['y_top'].tolist())
            except Exception as error:
                item['rankError'] = str(error)[:240]
            try:
                ess = azp.plot_ess(dataset, backend='none', kind='quantile', min_ess=400)
                points = ess.viz['ess'].dataset['value'].item()
                item['ess'] = dict(x=points['x'].tolist(), y=[finite(v) for v in points['y']])
            except Exception as error:
                item['essError'] = str(error)[:240]
            result.append(item)
    return result

emit(type='phase', phase='Computing interactive ArviZ diagnostics')
try:
    plots = diagnostic_plots(idata, parameters)
except Exception as error:
    plots = []
    emit(type='warning', message='Interactive diagnostics unavailable: ' + str(error)[:240])

emit(type='result', posterior=dict(
    alpha=draws('adstock_alpha'), lam=draws('saturation_lam'), beta=draws('saturation_beta'),
    channelScale=channel_scale, targetScale=target_scale,
    predictiveMean=y_pred.mean('date').transpose('chain', 'draw').values.reshape(-1).tolist(),
    contributions=[dict(low=float(contribution_q[0,i]), median=float(contribution_q[1,i]), high=float(contribution_q[2,i])) for i in range(len(channels))],
    prediction=dict(low=q[0].tolist(), median=q[1].tolist(), high=q[2].tolist()),
    diagnostics=diagnostics, diagnosticPlots=plots,
))
