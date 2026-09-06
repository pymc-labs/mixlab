# nuts-rs-wasm

NUTS sampling in WebAssembly, using **nuts-rs** with a **PyMC/Numba integration**.
Model evaluation, parameter expansion and sampling execute locally in a browser
worker. No sampling server and no Nutpie Python extension are required.

Experimental: tested with the Xeus/Emscripten environment distributed in our
[v0.1.0 release](https://github.com/pymc-labs/nuts-rs-wasm/releases/tag/v0.1.0).
Download the small **adapter** archive and separate **runtime** archive, extract
both into one directory and serve it with `python -m http.server 8000`.
Open http://localhost:8000/ to sample the MMM or download its editable notebook.
No local PyMC installation is required. See [runtime-profile](runtime-profile/)
for exact versions, patches, dependency notices and the build recipe.

## Sample a PyMC model from JavaScript

```javascript
import {createSampler} from './browser-artifact/client.mjs';

const sampler = createSampler({
  runtimeUrl: '/runtime/',
  environment: 'pymc-marketing-wasm',
});
const controller = new AbortController();
const result = await sampler.sample(`
import pymc as pm
with pm.Model() as model:
    mu = pm.Normal("mu", initval=0.1)
    sigma = pm.HalfNormal("sigma", initval=1.0)
    pm.Normal("observed", mu, sigma, observed=[1.2, 0.8, 1.5])
`, {
  chains: 4, tune: 1000, draws: 1000, targetAccept: 0.9, seed: 42,
  signal: controller.signal,
  onPhase: console.log,
  onProgress: ({chain, index, tuning}) => console.log(chain, index, tuning),
  onSamples: ({chain, start, draws, values, layout}) => {
    // A batch of expanded (constrained) values, including selected deterministics.
    // values is a Float64Array of draws × sum(layout.map(v => v.size)).
    console.log(chain, start, draws, values, layout);
  },
});
// controller.abort() cancels a running call by terminating its worker.
for (const {chain, group, bytes} of result.traces) {
  // bytes is Arrow IPC stream data: one posterior + sample_stats file per chain.
  const url = URL.createObjectURL(new Blob([bytes]));
  // Attach to a download link, then revoke the URL when no longer needed.
}
sampler.close();
```

`model` must be defined by the Python code. The client loads the runtime, executes
the code, compiles both callbacks, samples and constructs `idata` as an xarray
DataTree in that Python runtime. Model operations on one sampler are sequential; concurrent
operations reject. Concurrent `initialize()` calls share the same setup promise.
Repeated source calls reuse the runtime but compile a fresh model. Cancellation rejects with
`AbortError`; the next call starts a fresh worker.

Options also include `varNames` (default: free RVs and deterministics), `files`
(a mapping of in-runtime paths to text contents), `onOutput` (Python stdout), and
`afterSample` (trusted Python code executed with `model`, `idata`, `_nuts_result`,
and `_nuts_compile_seconds` available). Use `afterSample` for ArviZ diagnostics
or PyMC posterior prediction, and emit application messages through `onOutput`.
To reuse compilation explicitly, prepare a handle and sample it repeatedly:

```javascript
const compiled = await sampler.prepare(pythonCode, {files, varNames});
const first = await sampler.sample(compiled, {seed: 42, draws: 500});
const second = await sampler.sample(compiled, {seed: 142, draws: 1000});
await sampler.release(compiled);
```

`compile()` is an alias for `prepare()`. A handle freezes the model's shared data
and selected outputs, retains both Numba callbacks, and retains an immutable base initial position. Fits use independently jittered
starts by default (see below). Recompile after changing the graph or outputs;
passing `files`, `varNames` or `mutableData` to a handle fit rejects. Handles belong to one
sampler and expire on release, cancellation or worker replacement. Release drops
the handle references; the runtime may retain JIT code until the worker closes.
Source-based fits automatically release their temporary compiled callbacks. Each handle
restores its associated `model` for `afterSample`; other Python globals remain
shared in the worker.

## Initialization, tree depth and data updates

Sampling accepts `maxDepth` (default 10, integer 1–20), `jitter` (default 1,
nonnegative finite amplitude in unconstrained coordinates), and `initRetries`
(default 10, integer 0–1000). Each chain samples a uniform displacement in
`[-jitter, jitter)` for each coordinate, using a separate seeded initialization
RNG. Invalid starting positions are retried up to `initRetries` additional times;
exhaustion reports the failing chain. `result.initial_positions` records the actual
accepted starts. Same seeds and options reproduce the same draws.

Use `jitter: 0` for the previous fixed-start behavior and seeded sampling sequence;
an invalid fixed start fails immediately because retrying it cannot help.
Browser and native adapter defaults both enable unit initial jitter, matching
[current nutpie's PyMC default](https://github.com/pymc-devs/nutpie/blob/main/python/nutpie/compile_pymc.py).
Native callers can disable it through `set_sampler_options`. These defaults change
seeded draws relative to the earlier fixed-start adapter. This matches the jitter
amplitude and enabled default, not nutpie's exact RNG sequence or initialization
machinery. Step-size jitter is separate: it remains the pinned nuts-rs default
(`Some(0.1)`), inherited through `DiagNutsSettings::default()`.

Opt into data updates when preparing a model:

```javascript
const compiled = await sampler.prepare(`
import numpy as np
import pymc as pm
with pm.Model() as model:
    observed = pm.Data("observed", np.array([1., 2., 3.]))
    mu = pm.Normal("mu")
    pm.Normal("y", mu, 1, observed=observed)
`, {mutableData: ['observed']}); // true selects all named shared data
await sampler.sample(compiled);
await sampler.updateData(compiled, {observed: [2., 3., 4.]});
const updated = await sampler.sample(compiled); // compile_seconds === 0
await sampler.release(compiled);
```

Selected data are supplied to both Numba callbacks through one stable float64
buffer, with graph-level casts to their original dtypes. Updates are validated
before committing: names, input shapes, original dtype representability, finite
numeric values, and output shapes must match. Integer data must be exactly
representable in float64. Shape/coordinate changes require recompilation.
Unselected shared data remain frozen. Each handle owns its data buffer and
restores its selected data into its associated PyMC model before sampling, so
`afterSample` prediction uses those values. Direct `pm.set_data` calls do not
update compiled callbacks; use `updateData`. Updates cannot overlap sampling,
and released or cancelled handles reject updates.

`sampler.execute(code)` can run Python after a completed sample while the runtime
is still alive. Do not call it concurrently with sampling.

See [examples/basic.html](examples/basic.html) for a minimal page with start,
stop, progress and Arrow downloads. Serve the repository and configure a local
compatible runtime under `/runtime/`. This is an integration example, not a
standalone runtime installer.

## Reuse of existing implementations

- **PyMC** provides the backward transformations and deterministic expressions
  through `model.unobserved_value_vars`. Like Nutpie's `_make_functions`, we
  compile these expressions into a separate expansion callback. There are no
  parameter-name heuristics or hand-written log/logit transforms.
- **nuts-rs** provides `draw` for discarded warmup, `expanded_draw` for retained draws, full sampler statistics and the actual
  `ArrowConfig` / `ArrowTraceStorage` implementation. Arrow serialization uses
  the standard Rust Arrow IPC writer. We do not implement a new trace format.
- **Xeus + Comlink** provide the Python worker and its message transport.
- **xarray/ArviZ** handle labeled results and downstream diagnostics.

The adapter temporarily pins the minimal public-storage-API change in
[nuts-rs #77](https://github.com/pymc-devs/nuts-rs/pull/77) at commit
`b6f058e995c4ce2daa128e4790afab8bd4a71356`. It only exposes existing storage
traits and StatsDims. Switch back to upstream once that API is released.

## Results and streaming

- `result.samples`: raw **unconstrained** coordinates, `[chain][draw][parameter]`.
- `result.expanded_samples`: constrained variables and selected deterministics,
  `[chain][draw][expanded parameter]`, described by `expanded_layout` and `coords`.
- `result.traces`: actual Arrow IPC streams for each chain's posterior and full
  sample statistics. Vector columns retain nuts-rs dimension/shape metadata.
- `result.stats`: a small numeric compatibility view of divergence, step size
  and leapfrog counts. The Arrow files contain the complete upstream statistics.
- `sampling_seconds`: Rust call including warmup, expansion, Arrow recording,
  live callbacks and serialization; excludes model compilation and later Python
  postprocessing. `compile_seconds` covers model construction and compilation
  performed by this call (zero for a reused handle); `model_compile_seconds`
  records the original preparation cost.

Live batches contain the same expanded values submitted to Arrow storage. They
are sent every 10 retained draws; warmup is reported as progress but not stored or expanded. Skipping warmup
expansion preserves seeded draws and adaptation. The first retained Arrow row
now records the current `transformation_update_id`, because discarded warmup
no longer advances the upstream statistics cursor; other statistics are preserved.
Rust exports flat numeric buffers without serializing sample values as JSON.
The worker stages binary bytes in its local filesystem for NumPy/xarray before
transferring results; only metadata and file paths are encoded as JSON. Live
callback buffers are independent of retained final values and may be transferred.

The default `resultFormat: 'compatibility'` preserves the nested JavaScript
arrays above. Use `resultFormat: 'binary'` to receive flat `Float64Array` values
for `expanded_samples`, `samples`, and `stats`. `shape` is
`[chains, draws, expandedWidth]`; `unconstrained_width` describes `samples`.
Statistics use three values per draw: divergence (0/1), step count, step size.
Use `retainUnconstrained: false` to omit `samples` and its Rust/Python storage;
it defaults to `true` for compatibility. Arrow output and `idata` are unchanged
by either option.

Inside `afterSample`, `_nuts_result` now contains NumPy sample arrays and a
structured statistics array rather than Python lists/dicts. Existing
`stats[chain][draw]['diverging']` indexing works; use `.tolist()` when plain lists
are needed. `idata` retains named dimensions, coordinates and sample statistics.
Compatibility and binary modes retain complete expanded traces and Arrow storage.
For fits that consume live batches without retaining a posterior, use stream mode:

```javascript
const summary = await sampler.sample(compiled, {
  resultFormat: 'stream',
  onSamples: ({chain, start, draws, values, layout}) => {
    // Consume the batch immediately, e.g. update online summaries or a plot.
  },
});
console.log(summary.divergences, summary.initial_positions);
```

Stream mode keeps only a ten-draw batch in sampler result storage, independently
of total draws; it skips full numeric buffers, Arrow recording, Python staging,
and xarray construction. It returns metadata and aggregate counters, with
`traces: []` and no `samples`, `expanded_samples`, or per-draw `stats`.
`afterSample` is rejected in this mode because no new `idata` is constructed.
Existing Python results from earlier fits are not cleared. Live draw values and
sampling statistics agree with retained mode for identical seeds and options.
There is no callback backpressure: browser message queues and application-retained
batches can still grow if consumers cannot keep up. Model/runtime memory and NUTS
tree storage are separate from this reduction in result storage.

## Build, tests and delivery

Rust 1.94.0, Node and a package-compatible Python environment are required:

```sh
rustup target add wasm32-unknown-unknown
npm ci --ignore-scripts
npm run build
npm test
mkdir -p /tmp/arrow-test
ARROW_TEST_DIR=/tmp/arrow-test node test_bridge.mjs
PYTENSOR_FLAGS=cxx=,blas__ldflags=,numba__cache=False OPENBLAS_NUM_THREADS=1 python test_compile.py
python test_results.py
```

For a real worker integration check (including mutable data, streaming-only output,
jitter and tree-depth controls), serve the repository with a configured
`runtime/` and open `test_browser.html`. It checks reusable handles, binary
results, xarray coordinates/deterministics, Arrow buffers and cancellation.

Python tests use PyMC 6.2.0, PyTensor 3.2.4, Numba 0.66.0, xarray and PyArrow.
Tests cover WASM Gaussian moments, live draw counts, Arrow IPC read-back,
memory growth, cancellation, logp/gradient agreement, HalfNormal/Beta/simplex
transforms, deterministics, dimensions and frozen data.

`browser-artifact/` contains the static WASM, JS and Python files. GitHub Actions
builds the same downloadable artifact. Serve the directory alongside your
runtime. Install its bootstrap next to the existing Xeus worker:

```sh
node configure-runtime.mjs /path/to/runtime pymc-marketing-wasm --export-memory
```

The optional `--export-memory` applies the specific tested Xeus loader patch;
omit it when the runtime already exports memory. Unknown loaders are rejected.
The bootstrap must live in the runtime directory because Xeus resolves its
unpacker WASM relative to the worker URL.

The versioned GitHub release distributes static archives and SHA-256 checksums.
There is no PyPI/npm release; package.json remains private.

The runtime must supply `comlink.worker.js` and
`xeus/<environment>/xpython/kernel.json`, with the package bundle in Xeus' usual
layout. It must expose its actual `Module.wasmMemory`, `Module.wasmTable`, and `Module.FS` filesystem.
The tested runtime uses Python 3.13, Numba 0.66, llvmlite 0.48, PyMC 6.2.0,
locally patched PyTensor 3.2.4 and PyMC-Marketing 1.1.0. The demo's generated Xeus
loader currently has a local memory-export patch; this is not a stock-runtime
guarantee. All runtime and artifact URLs must be fetchable by the application.

## Limits

Continuous, fully Numba-compilable graphs only. Shared data are frozen by default;
selected same-shape numeric data can be updated with `mutableData`/`updateData`. Expanded values currently use float64.
The Rust and Python modules have separate memories; the JS bridge copies inputs
and outputs. By default it resolves callbacks once per fit (`bridgeCache: 'callbacks'`).
View caching is experimental and opt-in with `bridgeCache: 'views'`: it reuses
a bounded set of views, refreshing them when pointers, lengths or either memory
buffer change. Current MMM measurements do not establish an end-to-end benefit
from view caching. Use `bridgeCache: 'none'` to disable both caches. No Python executes per logp or expansion evaluation.

Diagonal-mass NUTS, configurable max depth (default 10), sequential chains, base
initial positions from PyMC, seeds `seed + chain`. No Stan/JAX/flows, multi-worker chains or
cooperative cancellation. Terminating a worker cancels all of its Python state.
Private PyTensor `vm.jit_fn` usage requires compatibility tests. Model code is
trusted executable Python, not a sandbox for third-party submissions.

The original MMM feasibility run (179 weeks, 15 dimensions, 2 × 750 warmup +
500 retained draws) took 0.80 s native / 8.41 s browser before Arrow integration.
These are historical single-run timings, not benchmarks of this expanded API.
Max R-hat 1.018/1.023 and min bulk ESS 125/183 did not establish matched
convergence or a precision-adjusted speedup over PyMC NUTS.

Originally explored in [nutpie #345](https://github.com/pymc-devs/nutpie/pull/345),
then separated because the sampler dependency is nuts-rs directly.

A manual MMM check of the Arrow/high-level API also completed all 1,000 retained
draws, live plots, prediction and four Arrow downloads: 8.5 s sampling and 29.9 s
model preparation plus sampling, zero divergences, max R-hat 1.023, min ESS 183.
Browser cancellation during initialization was checked separately.

## One example, three entry points

`examples/mmm/model.py` and `diagnostics.py` are shared by the web app, browser
notebook and native/browser benchmarks. `scripts/sync_demo.py SITE_PATH` copies
those sources and the current adapter artifact into an existing demo checkout.
The notebook prepares editable Python source and displays `notebook.html`; its
Numba model compilation, Rust sampling, transformations and Arrow storage run in
the same browser worker as the app, with no Python-NUTS fallback.

The app offers yearly seasonality on/off and compares actual posterior carryover
estimates. The five-fit [benchmark](benchmarks/) includes both native expansion
and Arrow output: median 0.807 s native / 7.999 s WASM for warmup and sampling;
9.80 / 19.36 s including model preparation and compilation with imports preloaded.
Median minimum bulk ESS/s was 194.5 / 21.9. These short runs do not establish
matched posterior precision; raw records, diagnostics and plotting code are
included. `test_native.py` covers constrained expansion and Arrow read-back.


The [direct-WASM feasibility report](docs/direct-wasm-calls.md) and bounded
callback prototype investigate an Emscripten side module with coordinated memory.
A full Rust/Numba direct backend has not been validated; the current bridge
remains the sampling path. See [benchmarks](benchmarks/) for separate compilation,
warmup, result-transfer and callback-cache measurements.
