"""Post-fit, joint prior/likelihood power scaling using the bundled ArviZ PSIS.

All log densities and channel contributions retain the same chain/draw order.
Only compact plot summaries leave Python. This does not alter the fitted model.
"""
import numpy as np
import xarray as xr
from arviz_stats.base import array_stats


def weighted_quantiles(values, weights, probabilities):
    order = np.argsort(values)
    values, weights = values[order], weights[order]
    positive = weights > 0
    values, weights = values[positive], weights[positive]
    if np.allclose(weights, weights[0], rtol=1e-12, atol=0):
        return np.quantile(values, probabilities)
    positions = np.cumsum(weights) - weights / 2
    positions /= weights.sum()
    return np.interp(probabilities, positions, values)


def summarize_sensitivity(log_prior, log_likelihood, contributions):
    """Compute genuine PSIS weights, CJS diagnostics, and linked chart summaries."""
    import arviz_stats as az
    prior, likelihood, values = map(np.asarray, (log_prior, log_likelihood, contributions))
    if prior.ndim != 2 or likelihood.shape != prior.shape or values.shape[:2] != prior.shape or values.ndim != 3:
        raise ValueError('Sensitivity arrays must have aligned chain and draw dimensions.')
    if not all(np.isfinite(v).all() for v in (prior, likelihood, values)):
        raise ValueError('Sensitivity requires finite log densities and contributions.')
    n = prior.size
    if n < 100:
        raise ValueError('Sensitivity requires at least 100 posterior draws.')
    k_limit = min(0.7, 1 - 1 / np.log10(n))
    powers = np.geomspace(0.8, 1.25, 21)
    powers[10] = 1.0
    flat = values.reshape(n, values.shape[-1])
    # Fixed bin edges keep every power comparable and make slider updates stable.
    edges = []
    for v in flat.T:
        lo, hi = float(v.min()), float(v.max())
        pad = max((hi - lo) * 0.025, abs(lo) * 1e-6, 1e-6)
        edges.append(np.linspace(lo - pad, hi + pad, 49))
    dt = xr.DataTree.from_dict({
        'posterior': xr.Dataset({'contribution': (('chain', 'draw', 'channel'), values)}),
        'log_prior': xr.Dataset({'joint': (('chain', 'draw'), prior)}),
        'log_likelihood': xr.Dataset({'joint': (('chain', 'draw'), likelihood)}),
    })
    sensitivity = {}
    for group in ('prior', 'likelihood'):
        density = prior if group == 'prior' else likelihood
        scores = np.zeros(values.shape[-1]) if np.ptp(density) < 1e-12 else az.psense(dt, var_names=['contribution'], group=group, sample_dims=['chain', 'draw'])['contribution'].values
        sensitivity[group] = [float(v) if np.isfinite(v) else None for v in scores]
    groups = {}
    for group, log_density in [('prior', prior), ('likelihood', likelihood)]:
        density = log_density.reshape(-1)
        constant = np.ptp(density) < 1e-12
        # Relative tail ESS accounts for dependence in the source MCMC draws.
        reff = 1.0 if constant else float(array_stats.ess(log_density, method='tail', prob=0.05, relative=True))
        if not np.isfinite(reff) or reff <= 0:
            raise ValueError('Could not estimate sampling efficiency for sensitivity weights.')
        points = []
        for power in powers:
            if power == 1 or constant:
                weights, khat = np.full(n, 1 / n), 0.0
            else:
                # ArviZ-stats 1.3.0 psislw consumes log likelihoods and NEGATES
                # its input internally (LOO convention), so pass -log ratios.
                logw, khat = array_stats.psislw(-(power - 1) * density, r_eff=min(1.0, reff))
                weights = np.exp(logw - np.max(logw))
                weights /= weights.sum()
                khat = float(khat)
            ess = float(1 / np.sum(weights ** 2))
            point_channels = []
            for i, v in enumerate(flat.T):
                low, median, high = weighted_quantiles(v, weights, [0.05, 0.5, 0.95])
                mass, _ = np.histogram(v, bins=edges[i], weights=weights)
                point_channels.append(dict(low=float(low), median=float(median), high=float(high),
                    density=(mass / np.diff(edges[i])).tolist()))
            points.append(dict(power=float(power), paretoK=khat if np.isfinite(khat) else None,
                weightEss=ess, reliable=bool(np.isfinite(khat) and khat < k_limit and ess >= min(400, n / 2)),
                channels=point_channels))
        groups[group] = points
    return dict(status='available', method='psis-power-scaling', draws=n, paretoThreshold=float(k_limit),
        binCenters=[((e[:-1] + e[1:]) / 2).tolist() for e in edges], scores=sensitivity, groups=groups)


def compute_sensitivity(model, idata, contributions):
    from pymc.stats import compute_log_prior, compute_log_likelihood
    compute_log_prior(idata, model=model, backend='numba', progressbar=False)
    compute_log_likelihood(idata, model=model, backend='numba', progressbar=False)

    def joint(group):
        return group.to_dataset().to_stacked_array('term', sample_dims=['chain', 'draw']).sum('term', skipna=False).transpose('chain', 'draw').values

    return summarize_sensitivity(joint(idata.log_prior), joint(idata.log_likelihood), contributions)
