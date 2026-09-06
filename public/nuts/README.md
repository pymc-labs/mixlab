# nuts-rs-wasm

NUTS sampling in WebAssembly, using **nuts-rs** with a **PyMC/Numba integration**.
Model evaluation, parameter expansion and sampling execute locally in a browser
worker. No sampling server and no Nutpie Python extension are required.

Experimental: currently tested with a compatible Xeus/Emscripten runtime, not
stock Pyodide. You must supply that runtime; it is not bundled in this project.

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
DataTree in that Python runtime. Calls on one sampler are sequential; concurrent
calls reject. Repeated calls can reuse the runtime. Cancellation rejects with
`AbortError`; the next call starts a fresh worker.

Options also include `varNames` (default: free RVs and deterministics), `files`
(a mapping of in-runtime paths to text contents), `onOutput` (Python stdout), and
`afterSample` (trusted Python code executed with `model`, `idata`, `_nuts_result`,
and `_nuts_compile_seconds` available). Use `afterSample` for ArviZ diagnostics
or PyMC posterior prediction, and emit application messages through `onOutput`.
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
- **nuts-rs** provides `expanded_draw`, full sampler statistics and the actual
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
  postprocessing. `compile_seconds` covers model construction and compilation.

Live batches contain the same expanded values submitted to Arrow storage. They
are sent every 10 retained draws; warmup is reported as progress but not stored.
The current implementation also retains numeric arrays for xarray compatibility,
so memory use includes both Arrow and numeric views. Large models/traces need
memory budgeting; Arrow streaming does not yet imply bounded-memory storage.

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

No PyPI/npm release is published automatically; package.json is private.

The runtime must supply `comlink.worker.js` and
`xeus/<environment>/xpython/kernel.json`, with the package bundle in Xeus' usual
layout. It must expose its actual `Module.wasmMemory` and `Module.wasmTable`.
The tested runtime uses Python 3.13, Numba 0.66, llvmlite 0.48, PyMC 6.2.0,
locally patched PyTensor 3.2.4 and PyMC-Marketing 1.1.0. The demo's generated Xeus
loader currently has a local memory-export patch; this is not a stock-runtime
guarantee. All runtime and artifact URLs must be fetchable by the application.

## Limits

Continuous, fully Numba-compilable graphs only. Shared data are frozen when
compiled; changes require recompilation. Expanded values currently use float64.
The Rust and Python modules have separate memories; the JS bridge copies inputs
and outputs. No Python executes per logp or expansion evaluation.

Diagonal-mass NUTS, max depth 10, sequential chains, initial positions from PyMC,
seeds `seed + chain`. No jitter retries, Stan/JAX/flows, multi-worker chains or
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
