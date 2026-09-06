# Architecture and extension points

The fitting tab renders interactive diagnostics with Recharts. `arviz_plots` runs with its `none` data backend in the existing Python worker to produce rank ΔECDF curves, 95% reference envelopes and quantile ESS; unthinned chains and divergent draw indices support trace inspection. These optional payloads travel with the posterior and are validated on project import. Older projects remain supported and show a refit prompt for interactive plots. `scripts/check-diagnostic-plots.py` validates the bridge against the native runtime.

## A static app, a real model

The React/Vinext app exports to static assets. `lib/core.ts` owns CSV validation, canonical model inputs, diagnostic gates, and the mathematically exact historical counterfactual calculation. It is independent of React.

`lib/engine.ts` starts the vendored nuts-rs-wasm client in a dedicated Xeus worker. The trusted `public/python/model.py` receives canonical CSV and JSON settings, constructs a real `pymc_marketing.mmm.MMM`, and provides its sampling model. The Rust WASM sampler evaluates Numba-compiled log density and gradients without running Python per leapfrog. It streams expanded posterior draws and returns real Arrow traces.

`public/python/analyze.py` uses xarray/ArviZ and PyMC-Marketing for actual posterior diagnostics, channel contributions, and predictions. Structured output crosses the worker boundary using `MIXLAB_EVENT` records. The guided workbench retains one prepared model and its Python worker for repeated fits. The cache key includes model source, canonical data, model-defining settings and output selection; sampling budgets and seeds do not invalidate it. Every fit refreshes Python settings before analysis. Changing the key, cancellation, errors, leaving the page or five minutes of inactivity closes the worker and reclaims its JIT memory. The Python lab keeps its separate editable session alive after a fit and constructs a fresh model on each run. Guided results use binary transport and omit unconstrained draws; labeled posterior results and Arrow downloads are preserved.

## Open paths

`lib/exports.ts` produces readable Python, nbformat-4 notebooks, lab payloads, and validated project restoration. The model shown in the Code tab matches the guided model specification; the only transport difference is inline settings/portable file names instead of worker-internal paths.

`public/notebook.html` and `public/lab.mjs` are a standalone Python lab. They accept a model/data/settings payload from same-origin session storage or an explicit URL fragment, show it for editing, and wait for a user click before executing. A separate follow-up cell uses the same Python kernel with `mmm` and `idata`. It allows custom model source and custom variable selection without trying to force arbitrary models through the guided UI's MMM-specific result contract.

The native notebook runs ordinary PyMC, with data embedded in a code cell and a fully explicit model constructor. The browser notebook needs only IPython in its outer notebook kernel; it launches the same local browser lab. notebook.link's public-repository launch uses `.nblink/environment.yml`, avoiding a second Python/Numba compatibility stack inside its default notebook kernel.

## State and data movement

- Uploaded files are read with the browser File API. There is no application upload request.
- `lib/workspace.ts` owns the guided workspace transitions used by controls and assistant actions. Edited data/mapping/configuration are separate from immutable completed-fit snapshots. Each fit stores its own settings, original model/analysis source, pinned runtime archive identity, posterior and scenario selection. `hooks/use-workspace.ts` bridges this state to React and IndexedDB. Writes are serialized and revision-checked inside a transaction so competing tabs cannot silently overwrite newer work. Settings edits debounce for 250 ms; completed fits save immediately. Failed/blocked saves are visible and leave the last committed copy intact. The old session-storage backup migrates when no IndexedDB save exists. Lab launches still use temporary session storage; kernels and Arrow binaries are not persisted.
- Version 2 project exports preserve the edited workspace, full fit history, selected fit and per-fit scenarios. Every imported fit is validated against its own dataset and sampling configuration; incomplete edited mappings may be restored without a fit. Version 1 imports become a single saved fit with unknown original source/date explicitly represented. Restoring does not execute source or require sampling.
- Settings changes retain results, with a visible mismatch notice. All result-side scenario calculations use the selected fit’s saved lag. Data/mapping changes hide incompatible results without deleting history. Viewing a historical fit changes the viewed data/results but preserves edited settings; reusing saved settings is a separate action. Cancelled or failed runs never replace completed evidence. A cancellation signal terminates the worker.
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

## Prior editing

`components/prior-editor.tsx` adapts pinned Modist ESM widgets to a minimal local anywidget model (`get`, `set`, `on`, `save_changes`). Draft parameters are separate from the fitted model. Apply preserves completed results and writes `adstockPrior` / `saturationPrior` to the configuration. Beta parameters select the geometric adstock prior; Gamma shape/rate select logistic saturation speed. The amplitude prior remains HalfNormal. Legacy projects omit these fields and use Beta(1, 3) and Gamma(3, 1). Project imports validate finite positive parameters within the UI's supported range. Both Python model constructors receive the same explicit priors; native log-density equivalence checks cover defaults and customized priors.

## Collaborative investigation (experimental)

The workbench and assistant operate on the same React project state. `lib/agent.ts` defines a provider interface, a Claude Messages API adapter and a bounded, validated action vocabulary. `components/investigation.tsx` runs at most eight request/tool rounds per user turn. Each workspace action is reviewed before execution; a changed project revision invalidates a pending proposal. Inspecting summaries is read-only. Errors, rejected actions and completed actions return actual tool results. The API key lives only in component memory, never project exports or browser storage. No Claude Agent SDK or native agent process is required by the static build.

Guided actions update the existing controls, run the existing sampler and calculate existing historical scenarios. Completed guided fits are retained in the local workspace and version 2 project exports, without the previous four-fit eviction. Comparisons only combine fits on identical data and mappings. Agent context distinguishes edited `config` from selected `resultSettings` and explicitly reports a mismatch. History selection and reusing saved settings currently remain manual controls.

For flexible models, `hooks/use-python-workspace.ts` maintains a separate editable source, variable selection, analysis cell and persistent browser kernel. Both user and agent can draft and run the code. The original imported CSV is available as `/mixlab-raw.csv`, preserving grouping columns; validated guided inputs are also available as `/mixlab-data.csv`. Source must define a PyMC `model`. The existing sampler creates `idata`, then runs the analysis cell. Follow-up execution requires a kernel matching the current source and dataset. Custom results never enter guided charts or counterfactuals, whose mathematical contract is narrower.

Python source is included in assistant context; Python output is excluded unless the user approves the dedicated output-sharing action. Executable Python has dataset and browser-network access, so the run proposal and manual controls disclose this explicitly. This is not a security sandbox for untrusted code. No package installation, shell, MCP service or remote compute is introduced. Arbitrary hierarchical/time-varying model compatibility has not been validated; runtime compilation failures are shown as failures. Custom source, conversation and kernel are page-session state. Download code before leaving.

The next architecture step for production flexibility is a versioned model artifact (source, data schema, dependencies, inference settings and named outputs), a generic result renderer, and a replaceable execution backend. A local/native backend could run the same artifacts for models the browser cannot compile, without replacing the shared action API or manual controls.

The assistant now supports Anthropic Messages and OpenAI Responses through the same action loop. OpenAI requests disable response storage and retain encrypted reasoning items in local conversation history for tool-call continuation. Switching providers clears the previous key and conversation. Provider access has protocol-level mocked tests; live OpenAI requests still require a user-supplied API key.

Investigation steps and agent actions can focus the active workbench area, scroll it into view, and display a contextual highlight. The layout keeps the assistant alongside the workbench on laptop widths and stacks on small screens. A single expandable privacy explanation separates local fitting from outbound AI requests: keys authenticate directly with the chosen provider; messages, source and summaries are transmitted; raw rows/draws are not automatically included. Custom Python remains capable of network requests.

The browser adapter is pinned to the published nuts-rs-wasm v0.1.0 release in `adapter-manifest.json`, with its release commit and verified archive checksum. The WASM and JavaScript bytes match the preceding pinned build; only the upstream README and release provenance change. Mixlab retains its documented optional-IProgress warning filter. The runtime archive remains pinned by `runtime-manifest.json`. Setup verifies that archive, then overlays `public/nuts/worker-loader.js` as the runtime bootstrap. Runtime checks verify this bootstrap against the vendored adapter rather than the older archive entry. Refreshing the adapter requires refreshing its JS, Python, WASM and bootstrap together.

The adapter now uses independent seeded initial jitter (amplitude 1) and up to 10 additional attempts for invalid starts, with the default maximum tree depth of 10. This changes seeded draws relative to the previous fixed-start adapter; `jitter: 0` on a direct sampler call restores that behavior. Guided and Python-lab fits use the upstream defaults. Retained binary results, Arrow traces and `afterSample` remain enabled for guided diagnostics. Mutable-data updates and stream-only sampling are available upstream but are not enabled by the guided session.

## Fit-history verification

`tests/workspace.test.ts` covers two fits with different sampling budgets followed by export/restore, independent edited settings, saved-lag scenario behavior, dataset compatibility, per-fit scenarios, history beyond four fits, legacy migration and malformed histories. The TypeScript suite and static production build pass. This change has not been validated with a fresh browser sampling run or an interactive IndexedDB reload test. Custom Python/lab execution and generic result rendering remain separate extension work.
