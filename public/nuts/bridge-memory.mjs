/** Per-fit bridge between independent sampler and model WASM memories. */
export function createModelBridge(runtime, model, samplerMemory, cache = 'callbacks') {
  if (!['none', 'callbacks', 'views'].includes(cache)) throw Error('Invalid bridge cache mode');
  // Each fit owns its callbacks. Never retain a function from a previous model.
  const logp = cache === 'none' ? null : runtime.wasmTable.get(model.callback_pointer);
  const expand = cache === 'none' || !model.expand_pointer ? null : runtime.wasmTable.get(model.expand_pointer);
  // Keep the reference modes equivalent to the original direct-view bridge;
  // benchmark comparisons must not charge them for cache bookkeeping.
  if (cache !== 'views') return {
    model_logp(x, g, n) {
      new Float64Array(runtime.wasmMemory.buffer, model.x_pointer, n)
        .set(new Float64Array(samplerMemory().buffer, x, n));
      const lp = (logp ?? runtime.wasmTable.get(model.callback_pointer))(model.x_pointer, model.g_pointer, model.data_pointer ?? 0);
      new Float64Array(samplerMemory().buffer, g, n)
        .set(new Float64Array(runtime.wasmMemory.buffer, model.g_pointer, n));
      return lp;
    },
    model_expand(x, out, n) {
      if (!model.expand_pointer) {
        new Float64Array(samplerMemory().buffer, out, n)
          .set(new Float64Array(samplerMemory().buffer, x, n));
        return 0;
      }
      new Float64Array(runtime.wasmMemory.buffer, model.x_pointer, model.initial.length)
        .set(new Float64Array(samplerMemory().buffer, x, model.initial.length));
      const status = (expand ?? runtime.wasmTable.get(model.expand_pointer))(model.x_pointer, model.expanded_pointer, model.data_pointer ?? 0);
      if (status) return status;
      new Float64Array(samplerMemory().buffer, out, n)
        .set(new Float64Array(runtime.wasmMemory.buffer, model.expanded_pointer, n));
      return 0;
    },
  };
  // One entry per role, rather than a growing map of transient Rust pointers.
  const views = Array(8);
  const view = (slot, memory, pointer, length) => {
    const buffer = memory.buffer;
    let entry = views[slot];
    if (!entry || entry.buffer !== buffer || entry.byteOffset !== pointer || entry.length !== length) {
      entry = views[slot] = new Float64Array(buffer, pointer, length);
    }
    return entry;
  };
  return {
    model_logp(x, g, n) {
      view(0, runtime.wasmMemory, model.x_pointer, n)
        .set(view(1, samplerMemory(), x, n));
      const lp = (logp ?? runtime.wasmTable.get(model.callback_pointer))(model.x_pointer, model.g_pointer, model.data_pointer ?? 0);
      // Recheck both buffers after callbacks: growth detaches old views.
      view(2, samplerMemory(), g, n)
        .set(view(3, runtime.wasmMemory, model.g_pointer, n));
      return lp;
    },
    model_expand(x, out, n) {
      if (!model.expand_pointer) {
        view(4, samplerMemory(), out, n).set(view(5, samplerMemory(), x, n));
        return 0;
      }
      view(6, runtime.wasmMemory, model.x_pointer, model.initial.length)
        .set(view(5, samplerMemory(), x, model.initial.length));
      const status = (expand ?? runtime.wasmTable.get(model.expand_pointer))(model.x_pointer, model.expanded_pointer, model.data_pointer ?? 0);
      if (status) return status;
      view(4, samplerMemory(), out, n)
        .set(view(7, runtime.wasmMemory, model.expanded_pointer, n));
      return 0;
    },
  };
}
