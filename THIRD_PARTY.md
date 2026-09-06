# Third-party components

- `public/nuts/` is a snapshot of the high-level browser artifact from https://github.com/pymc-labs/nuts-rs-wasm, copied with its original `LICENSE` and `COMLINK-LICENSE`. Its Python/Rust/WASM adapter sources and build process live upstream.
- `public/runtime/` is intentionally excluded from source control and distributed as a checksummed release asset. It includes the tested Xeus/Emscripten runtime, Python 3.13, Numba 0.66.0, llvmlite 0.48.0, PyMC 6.2.0, patched PyTensor 3.2.4, and patched PyMC-Marketing 1.1.0, plus their dependencies.
- The runtime retains individual Python package metadata and includes `third-party-licenses/manifest.json` with collected original conda-package license notices, `resolved-environment.json`, and PyTensor/Marketing backport manifests.
- `runtime-manifest.json` records every runtime file checksum and the archive checksum. `scripts/check-runtime.mjs` verifies installed bytes before production builds.
- UI primitives under `components/ui/` come from the generated Sites/Shadcn starter. JavaScript dependencies retain their upstream licenses in their npm packages.
- The synthetic example in `public/example.csv` derives from the nuts-rs-wasm MMM example. Outcome and spend columns have been rescaled and renamed for a more legible working surface. It is not real client data.

- `vendor/nuts-rs-wasm/` contains the same unmodified client and Comlink modules for bundler-native imports in the guided app. Their original license notices are retained. The standalone Python lab uses the identical modules from `public/nuts/`.
