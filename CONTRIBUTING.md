# Contributing to Mixlab

Use Node 22.13+ and the pinned runtime:

```sh
npm ci
npm run runtime:setup
npm run dev
```

Before proposing changes, run `npm test`, `npm run typecheck`, and `npm run build`. Changes to model semantics should additionally exercise `scripts/check-model.py` using the matching native PyMC stack. Keep the guided model and exported model aligned.

Do not replace posterior computation with generated demo results. Label synthetic input data, approximation, in-sample fit, and counterfactual assumptions explicitly. Diagnostics are part of the product, not hidden developer output.

Preserve portability: ordinary PyMC-Marketing code, open trace formats, self-contained notebooks, and static hosting should remain supported. Additive server features must be optional.

Runtime changes require refreshed checksums, dependency notices, compatibility tests, and a new release asset. Never commit the 120 MB runtime directory or credentials to the repository.

For adapter upgrades, rebuild the complete upstream artifact with its pinned Rust toolchain, preserve the documented Mixlab warning filter, synchronize both client copies, and refresh `adapter-manifest.json`. Keep the scientific runtime archive pinned when its contents have not changed; runtime setup overlays the matching adapter bootstrap.

After starting the development server, open a fresh page and run this in its browser console:

```js
await (await import('/tests/browser-sampler.mjs')).checkBrowserSampler(console.log)
```

This runs the actual example MMM through the guided engine, checks diagnostics and Arrow output, repeats the same seed using the compiled model, cancels an active fit, and verifies a fresh fit after cancellation. Its short chains check integration and reproducibility, not convergence quality.
