# Architecture and extension points

## A static app, a real model

The React/Vinext app exports to static assets. `lib/core.ts` owns CSV validation, canonical model inputs, diagnostic gates, and the mathematically exact historical counterfactual calculation. It is independent of React.

`lib/engine.ts` starts the vendored nuts-rs-wasm client in a dedicated Xeus worker. The trusted `public/python/model.py` receives canonical CSV and JSON settings, constructs a real `pymc_marketing.mmm.MMM`, and provides its sampling model. The Rust WASM sampler evaluates Numba-compiled log density and gradients without running Python per leapfrog. It streams expanded posterior draws and returns real Arrow traces.

`public/python/analyze.py` uses xarray/ArviZ and PyMC-Marketing for actual posterior diagnostics, channel contributions, and predictions. Structured output crosses the worker boundary using `MIXLAB_EVENT` records. The guided workbench closes the Python worker after extracting its results to release runtime memory; the Python lab deliberately keeps its separate session alive.

## Open paths

`lib/exports.ts` produces readable Python, nbformat-4 notebooks, lab payloads, and validated project restoration. The model shown in the Code tab matches the guided model specification; the only transport difference is inline settings/portable file names instead of worker-internal paths.

`public/notebook.html` and `public/lab.mjs` are a standalone Python lab. They accept a model/data/settings payload from same-origin session storage or an explicit URL fragment, show it for editing, and wait for a user click before executing. A separate follow-up cell uses the same Python kernel with `mmm` and `idata`. It allows custom model source and custom variable selection without trying to force arbitrary models through the guided UI's MMM-specific result contract.

The native notebook runs ordinary PyMC, with data embedded in a code cell and a fully explicit model constructor. The browser notebook needs only IPython in its outer notebook kernel; it launches the same local browser lab. notebook.link's public-repository launch uses `.nblink/environment.yml`, avoiding a second Python/Numba compatibility stack inside its default notebook kernel.

## State and data movement

- Uploaded files are read with the browser File API. There is no application upload request.
- The guided workspace uses React memory plus a validated, debounced same-origin session-storage snapshot of data, settings, posterior summaries/draws, and scenarios. Reload restores it; closing the tab can remove it. Quota/storage errors appear in the footer. A lab launch separately stores a temporary same-origin payload and consumes it on opening the lab. Live Python kernels and Arrow binaries are not cached.
- A project export contains dataset, mapping, config, posterior parameter draws/summaries, and scenario state. It can be restored without rerunning sampling; Arrow binaries and live Python state are excluded.
- Data/config changes invalidate prior results. A cancellation signal terminates the worker.
- Downloaded notebooks include the user's data. Opening notebook.link launches the public example environment; importing a personal notebook is a separate user action on that platform.
- Browser-notebook payloads use fragments rather than query parameters. Fragments are not sent in HTTP requests, but links still contain the payload and should not be shared inadvertently.

## Counterfactual semantics

For each joint posterior draw and channel, the frontend normalizes finite weights `alpha ** lag`, convolves the original spend history, applies `beta * tanh(lam * x / 2)`, and converts back with the model's target scale. It repeats this for a channel-specific spend multiplier. Deltas use paired draws; totals are formed per draw before calculating intervals.

The interpretation is average weekly channel contribution over the observed period. It does not add observation noise or claim to forecast future revenue. The native integration test compares this equation to `idata.posterior.channel_contribution`.

## Adding capabilities

- New guided model options should be added to both `public/python/model.py` and the portable constructor in `lib/exports.ts`, with a model-equivalence check.
- New transformations also need their exact scenario computation, or the scenario feature must be disabled for those models. Do not silently reuse geometric/logistic assumptions for arbitrary models.
- A custom notebook/lab model can depart from the guided specification without any new UI feature, provided its selected variables exist and its graph compiles in the runtime.
- Holdouts, lift-test calibration, posterior sensitivity, hierarchical models, and optimization are plausible next features; they are not implemented by the first version.

## Hosting

The build is static. Runtime assets are deliberately outside Git so the repository stays within notebook.link's size constraints. Releases contain the checked runtime archive. `npm run runtime:setup` installs it and verifies bytes. `npm run build` verifies the runtime, regenerates examples, and exports the app. No runtime API secrets are required.
