# Prior and likelihood sensitivity

The **Fitting & diagnostics → Prior sensitivity** view is available after a new guided fit. Choose a channel, switch between prior and likelihood perturbation, and move the power slider from 0.80 to 1.25. The density plot supports hover values and horizontal zoom; clicking the interval trajectory selects a power. The slider provides the same selection with a keyboard. Channel rows select the corresponding plots.

The analysis measures average weekly channel contributions on the original outcome scale. It perturbs all free-variable priors jointly or the joint likelihood, keeping the other component fixed. It does not change the model configuration, replace a fit, or estimate sensitivity to every possible alternative prior family. In particular, power-scaling is not equivalent to multiplying the existing prior-scale control.

## Computation

`public/python/sensitivity.py` computes log priors and log likelihoods from the actual sampled PyMC model using the Numba backend. Log terms are summed within each chain/draw; channel contributions use exactly that ordering. The bundled ArviZ-stats 1.3.0 supplies PSIS smoothing and CJS sensitivity. There is no sampler or runtime package change.

For power a, the log importance ratio is `(a - 1) * log_density`. ArviZ-stats 1.3.0's `array_stats.psislw` uses the LOO convention and negates its argument, so the adapter deliberately passes the negative log ratio. The conjugate-Normal regression test verifies the direction and magnitude against analytic refits for both prior and likelihood perturbations.

The UI receives 21 logarithmically spaced power settings, fixed-bin weighted density estimates, and weighted 5th/50th/95th percentiles per channel. Power 1 has uniform weights and reproduces the original empirical quantiles exactly. These are marginal credible intervals for average contributions, not predictive intervals for future observations.

Local CJS diagnostics use ArviZ `psense` at powers 0.99 and 1.01. The 0.05 reference identifies potential prior–data conflict or strong-prior/weak-likelihood behavior for investigation. A lack of a flag does not establish robustness to arbitrary model changes or causality.

## Reliability and persistence

Each plotted power reports Pareto k and importance-weight ESS (distinct from MCMC ESS). We flag reweighting when k is unavailable or reaches `min(0.7, 1 - 1/log10(N))`, or weight ESS falls below `min(400, N/2)`. The source fit must also pass the existing convergence checks before the UI reports successful checks. Questionable weights remain visible for exploration, with warning text and amber trajectory points; use explicit alternative fits for substantive conclusions.

If the extra diagnostic computation fails, the fitted posterior and its normal diagnostics are preserved. Older project files remain readable and show a refit prompt. New project exports retain the compact sensitivity results; imports validate channel/draw alignment, grid order, finite and ordered plot values, and reliability claims before rendering.

## Validation

- `npm test`, `npm run typecheck`, `npm run build`.
- `python scripts/check-sensitivity.py` with the pinned ArviZ-stats 1.3.0: conjugate-Normal analytic comparisons, baseline identity, histogram normalization, opposing perturbation directions, constant priors, unreliable weights, and invalid inputs.
- `python scripts/check-model.py` in the matching native PyMC-Marketing environment: real MMM fitting, log-density computation with Numba, compact sensitivity output, and exact baseline agreement. Its intentionally short chains test integration; they are not evidence of convergence.

References: [ArviZ sensitivity workflow](https://arviz-devs.github.io/EABM/Chapters/Sensitivity_checks.html), [power-scaling method](https://doi.org/10.1007/s11222-023-10366-5).
