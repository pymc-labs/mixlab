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
scales = mmm.get_scales_as_xarray()
target_scale = float(scales['target_scale'].values.squeeze())
channel_scale = scales['channel_scale'].sel(channel=channels).values.reshape(-1).tolist()

def draws(name):
    return idata.posterior[name].transpose('chain', 'draw', 'channel').values.reshape(-1, len(channels)).tolist()

contribution = idata.posterior.channel_contribution.mean('date').transpose('chain', 'draw', 'channel').values.reshape(-1, len(channels)) * target_scale
contribution_q = np.quantile(contribution, [.05, .5, .95], axis=0)
emit(type='phase', phase='Checking prior and likelihood sensitivity')
try:
    sensitivity = compute_sensitivity(model, idata, contribution.reshape(
        idata.posterior.sizes['chain'], idata.posterior.sizes['draw'], len(channels)))
except Exception as exc:
    # A diagnostic failure must not discard an otherwise valid fitted posterior.
    print('Sensitivity analysis unavailable: ' + str(exc), flush=True)
    sensitivity = dict(status='unavailable', reason='Sensitivity could not be computed for this fit. Export the model to investigate in Python.')
emit(type='phase', phase='Computing posterior predictions')

prediction = mmm.sample_posterior_predictive(data.drop(columns='y'), combined=False,
    backend='numba', random_seed=config['seed'] + 100, progressbar=False)
y_pred = prediction['y'] * target_scale
q = y_pred.quantile([.05, .5, .95], dim=['chain', 'draw']).transpose('quantile', 'date').values
emit(type='result', posterior=dict(
    alpha=draws('adstock_alpha'), lam=draws('saturation_lam'), beta=draws('saturation_beta'),
    channelScale=channel_scale, targetScale=target_scale,
    predictiveMean=y_pred.mean('date').transpose('chain', 'draw').values.reshape(-1).tolist(),
    contributions=[dict(low=float(contribution_q[0,i]), median=float(contribution_q[1,i]), high=float(contribution_q[2,i])) for i in range(len(channels))],
    prediction=dict(low=q[0].tolist(), median=q[1].tolist(), high=q[2].tolist()),
    diagnostics=diagnostics, sensitivity=sensitivity,
))
