# Mixlab

**An open marketing science studio. Your data, your device, your model.**

Mixlab turns a CSV into an editable PyMC-Marketing model, runs real NUTS inference in the browser, and makes posterior uncertainty part of the working surface. The interface is a starting point: open the Python lab, export a notebook, inspect every assumption, or fork the entire app.

[Open the notebook workspace](https://notebook.link/github.com/twiecki/mixlab) · [Browser notebook](notebooks/mixlab-browser.ipynb) · [Native notebook](notebooks/mixlab-native.ipynb) · [Architecture](docs/architecture.md)

## What works

- **Local CSV import:** column roles, missing/nonnumeric values, valid weekly dates, gaps, duplicates, nonnegative spend, variation, and high channel correlation checks.
- **Real PyMC-Marketing models:** normalized geometric adstock, logistic saturation, editable effect priors, controls, and optional annual seasonality.
- **Repeated fits:** reuse the prepared model when only sampling settings change; its worker is released after five idle minutes, cancellation, errors, page exit or model/data changes.
- **Browser NUTS:** four-chain default, configurable sampling budget, live progress and carryover posterior, cancellation, Arrow posterior and sampler-statistic downloads.
- **Honest results:** observed series, in-sample posterior predictive intervals, channel contributions, R-hat, bulk/tail ESS, and divergences. No simulated fit or fabricated posterior.
- **Counterfactual lab:** rescale the historical channel spend, recompute the model's exact carryover and saturation, and compare paired posterior contributions and credible intervals.
- **Modist prior studio:** drag Will Dean’s actual Beta and Gamma distribution widgets to choose carryover and saturation priors. Numeric inputs support precise and keyboard-based editing. Apply explicitly; the next fit, Python source, and notebook exports use the selected parameters. Earlier fits retain their own settings. Existing projects retain PyMC-Marketing’s defaults.
- **Open Python lab:** edit model code, sample in a separate browser session, and execute follow-up Python with `mmm` and `idata` still available. Export the edited model and follow-up cells together as a browser notebook.
- **Automatic fit history:** start directly with the example or a CSV. Changing assumptions preserves completed fits; compare contributions and diagnostics, view earlier results, or explicitly reuse their settings. No project name or setup step.
- **Portable projects:** download and restore edited settings, every saved fit with its data, model source, posterior summaries/parameter draws, and per-fit scenarios. Version 1 projects migrate on import. Arrow traces are separate files.
- **Notebook escape routes:** self-contained native PyMC notebooks and browser notebooks using the same WASM runtime. Both include the selected data and editable code.

## Run locally

Node 22.13+ is required. The standalone runtime is distributed as a pinned release asset so this repository stays small enough for notebook.link (which currently limits repositories to 50 MB).

```sh
npm ci
npm run runtime:setup
npm run dev
```

The first command installs the app. `runtime:setup` downloads the ~120 MB runtime and verifies both the archive SHA-256 and every installed file. A previously obtained copy can be used instead:

```sh
npm run runtime:setup -- --from /path/to/the/tested/runtime
```

The browser adapter is pinned to [nuts-rs-wasm 0.1.0](https://github.com/pymc-labs/nuts-rs-wasm/releases/tag/v0.1.0); `adapter-manifest.json` records its verified release archive and the local warning filter. The scientific runtime remains the separately pinned Mixlab archive.

The configured runtime must match `runtime-manifest.json`; it is the tested Xeus/Python/Numba distribution from [nuts-rs-wasm](https://github.com/pymc-labs/nuts-rs-wasm). Stock Pyodide is not a substitute.

To build a static website:

```sh
npm test
npm run typecheck
npm run build
```

Serve `dist/client` at the root of any static origin supporting WebAssembly MIME types. Runtime assets and the application are served from the same origin. There is no application backend, no database, no inference API, and no app-owned authentication. Sites hosting can put a separate private access layer around the static site.

### Deploy to Fly.io

The public deployment is [pymc-mixlab.fly.dev](https://pymc-mixlab.fly.dev), in the PyMC-Labs organization and Frankfurt region. To deploy the current checkout with an authenticated Fly CLI:

```sh
npm test
npm run typecheck
flyctl deploy --remote-only --ha=false
```

Pushes to `main` automatically deploy to Fly.io after tests, type checking, and the production build pass. Pull requests and other branches only run validation. You can also run **Validate and deploy Mixlab** manually from GitHub Actions on `main`. Deployments are serialized so an active release is never cancelled by a newer push.

The workflow uses the repository Actions secret `FLY_API_TOKEN`, an app-scoped deploy token for `pymc-mixlab`. Rotate it before its one-year expiry. To replace it without printing or storing the token locally:

```sh
set -o pipefail
flyctl tokens create deploy --app pymc-mixlab --name github-actions --expiry 8760h | gh secret set FLY_API_TOKEN --repo twiecki/mixlab
```

The Docker build installs locked dependencies, downloads and verifies the pinned runtime, and builds the static website. Nginx serves the app and runtime on port 8080. Fly provides HTTPS and a health check; a single 256 MB machine stops when idle and starts on demand. CSV data and inference stay in the visitor's browser.

## Notebook.link

The repository includes a minimal `.nblink/environment.yml` using Python, xeus-python, and IPython. Open **`notebooks/mixlab-browser.ipynb`** in [the notebook workspace](https://notebook.link/github.com/twiecki/mixlab).

The browser notebook intentionally delegates computation to Mixlab's tested browser lab instead of assuming that the notebook.link default kernel contains the patched Numba/PyTensor stack. Edit `app_url` to a reachable Mixlab deployment or a local server. A private Sites deployment requires access to that deployment; use the separate-tab link if the browser blocks an authenticated iframe. The launch link is documented; end-to-end notebook.link UI execution is not claimed as validated here.

For your own project, use **Code → Browser notebook**, open notebook.link, and import the downloaded file. Mixlab does not automatically upload private data to an external service. The data/model payload is passed to the lab in a URL fragment, which is not part of HTTP requests; it is still contained in the link, so treat that link and the notebook as data-bearing artifacts.

The **native** notebook is ordinary PyMC code for local Jupyter. Its environment cell documents the dependencies. PyMC's native sampler and nuts-rs target the same configured model but will not generate identical draws.

## Model and interpretation

The guided workbench fits one continuous MMM to 52–520 regularly spaced weekly rows and 1–8 channels. Channel effects have `HalfNormal` priors; adstock uses `Beta(1, 3)` and saturation uses `Gamma(3, 1)`. The UI exposes the effect-prior scale and sampler controls. Model source is visible and exportable.

The scenario view is a **historical counterfactual**, not a future forecast or a budget optimizer. It scales each channel's complete observed spend history, preserves dates/controls/seasonality, and recomputes the finite normalized geometric adstock and logistic response. Intervals use 400 evenly selected joint posterior draws for responsiveness; baseline and changed draws remain paired. The full posterior is used for channel summaries and predictions. Higher spend can extrapolate beyond observed support.

Convergence gates use max R-hat ≤ 1.01, minimum bulk and tail ESS ≥ 400, and zero divergences. Passing them does not prove causal identification, sufficient prior information, or out-of-sample predictive quality. Failed gates are visible and carried into scenario interpretation.

## Validation

`npm test` checks real CSV fixtures, parsing edge cases, invalid data, exact carryover mathematics, paired counterfactual behavior, notebook generation, and project import validation. `npm run typecheck` checks the full app.

`scripts/check-model.py`, run with the matching native Python stack, exercises the actual model and postprocessing source through native PyMC sampling. It verifies posterior dimensions, predictive quantiles, and agreement of the frontend response equation with PyMC deterministic channel contributions to tight numerical tolerance. Its deliberately short chains are an integration test, not evidence of model convergence.

`scripts/check-exports.py` additionally compares exported notebook models with the guided browser specification under different carryover, prior, and seasonality settings.

Browser interaction checks cover complete four-chain fits in both the guided workspace and standalone Python lab, follow-up Python against the live posterior, scenario changes, project restoration, and recovery after reload. The exported notebook.link launch has not been validated end to end in its UI. The new persistent fit-history flow is covered by state/serialization tests and the production build; a fresh interactive browser fit and IndexedDB reload check have not yet been run for this change.

## Limits

- The first runtime download is about 120 MB. Chains run sequentially; larger fits can consume substantial memory and compilation time.
- The runtime currently uses compatibility patches to PyTensor and PyMC-Marketing. Pinning and tests matter.
- No holdout forecasting, lift-test calibration, hierarchical MMMs, automated budget optimization, authentication, scheduled refresh, or team sync yet.
- The guided workspace and completed fit history save automatically in IndexedDB on this device and origin, including incomplete data mappings. Reloading or reopening restores the last successful save. Rapid edits save after 250 ms; completed fits save immediately. Wait for the footer to say saved before closing. Browser storage can be cleared or reach its quota; export a project for a portable backup. A second tab cannot overwrite a newer save silently: conflicting saves pause with an export/reload message. Imports restore summaries and parameter draws, but not live Python kernels or Arrow binaries. Whole-project imports support up to 100 MB; individual fits can also be exported. Use Copy project JSON and Data → Paste project JSON if browser downloads are blocked.
- The Python lab runs executable code with browser network access. It never autoruns code supplied in a link.
- Results and diagnostics depend on the selected data, priors, and sampling budget.

## Open source

Mixlab application code is MIT licensed. The bundled nuts-rs-wasm adapter retains its own MIT notice and the Comlink Apache-2.0 notice. Runtime dependencies retain their upstream licenses, included in the runtime archive under `third-party-licenses` and package metadata. See [THIRD_PARTY.md](THIRD_PARTY.md).

Contributions that make the model more inspectable, reproducible, extensible, or portable are particularly welcome. Off-platform workflows are a feature.
