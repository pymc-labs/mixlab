# Third-party components

- `public/nuts/` is a snapshot of the high-level browser artifact from https://github.com/pymc-labs/nuts-rs-wasm, copied with its original `LICENSE` and `COMLINK-LICENSE`. Its Python/Rust/WASM adapter sources and build process live upstream.
- `public/runtime/` is intentionally excluded from source control and distributed as a checksummed release asset. It includes the tested Xeus/Emscripten runtime, Python 3.13, Numba 0.66.0, llvmlite 0.48.0, PyMC 6.2.0, patched PyTensor 3.2.4, and patched PyMC-Marketing 1.1.0, plus their dependencies.
- The runtime retains individual Python package metadata and includes `third-party-licenses/manifest.json` with collected original conda-package license notices, `resolved-environment.json`, and PyTensor/Marketing backport manifests.
- `runtime-manifest.json` records every runtime file checksum and the archive checksum. `scripts/check-runtime.mjs` verifies installed bytes before production builds.
- UI primitives under `components/ui/` come from the generated Sites/Shadcn starter. JavaScript dependencies retain their upstream licenses in their npm packages.
- The synthetic example in `public/example.csv` derives from the nuts-rs-wasm MMM example. Outcome and spend columns have been rescaled and renamed for a more legible working surface. It is not real client data.

- `vendor/nuts-rs-wasm/` contains the same unmodified client and Comlink modules for bundler-native imports in the guided app. Their original license notices are retained. The standalone Python lab uses the identical modules from `public/nuts/`.

## Modist prior widgets

`vendor/modist/` contains unmodified Beta and Gamma ESM bundles and CSS from [Will Dean’s Modist](https://github.com/williambdean/modist), pinned to commit `53ed3d23e269a5c2daff70d49620453f58b838a5` (0.5.0). Modist and its bundled jStat mathematics are MIT licensed; both notices are included. Mixlab supplies a local anywidget-compatible state adapter, without requiring a notebook widget manager.

`public/nuts/compile_model.py` has one Mixlab-specific patch: suppress only tqdm’s missing-IProgress warning before Python library imports. The standalone worker has no Jupyter widget manager and uses Mixlab’s progress display. Other warnings remain visible.

The nuts-rs-wasm adapter is pinned to [v0.1.0](https://github.com/pymc-labs/nuts-rs-wasm/releases/tag/v0.1.0), upstream commit `5baf1dec57aa6d0d8a7cebe06147bec42abb5759`. The published adapter archive and every upstream file-manifest entry were checksum-verified. Its WASM and JavaScript modules are byte-identical to our preceding build from `6f95e5d87c632b9d1517ca4442c8abe7c5c09d2c` with Rust 1.94.0 and locked dependencies; the bundled README is updated to the release version. `bridge-memory.mjs` is included with the other adapter modules. The runtime bootstrap is overlaid from this same adapter during runtime setup; the scientific runtime archive is unchanged.

`adapter-manifest.json` records the release version, commit, archive URL/checksum and SHA-256 checksums for the bundled adapter, including the Mixlab warning patch and its upstream file checksum. The test suite verifies these bytes and the matching bundled/standalone clients.
