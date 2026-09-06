import {createModelBridge} from './bridge-memory.mjs';

/** Experimental adapter between independent Rust and Emscripten WASM memories.
 * Run in a worker: sampling is synchronous and blocks that worker until done.
 * Keep the Python BrowserModel alive. Do not run concurrent fits in this runtime.
 */
export async function sample({bytes, runtime, model, chains = 2, tune = 750,
    draws = 500, seed = 42, targetAccept = 0.9, onProgress = () => {},
    onSamples = () => {}, onTrace, resultFormat = 'compatibility',
    retainUnconstrained = true, bridgeCache = 'callbacks'}) {
  if (!['compatibility', 'binary'].includes(resultFormat)) throw Error('Invalid resultFormat');
  if (typeof retainUnconstrained !== 'boolean') throw Error('Invalid retainUnconstrained');
  for (const [name, value] of Object.entries({chains, tune, draws, seed})) {
    if (!Number.isInteger(value) || value < (name === 'seed' ? 0 : 1)
        || value > 0xffffffff) throw Error(`Invalid ${name}`);
  }
  if (tune + draws > 0xffffffff) throw Error('Too many iterations');
  if (!model.initial.length || !model.initial.every(Number.isFinite)) {
    throw Error('A finite, nonempty initial position is required');
  }
  if (!(targetAccept > 0 && targetAccept < 1)) throw Error("Invalid targetAccept");
  const traces = [];
  const layout = model.expanded_layout ?? [{name: "unconstrained", size: model.initial.length, shape: [model.initial.length], dims: ["parameter"]}];
  const unexpected = () => {throw Error('Unexpected wasm-bindgen runtime call');};
  let ex;
  const {instance} = await WebAssembly.instantiate(bytes, {
    env: {
      ...createModelBridge(runtime, model, () => ex.memory, bridgeCache),
      report_samples(chain, start, p, draws, n) {
        const values = new Float64Array(ex.memory.buffer, p, draws*n).slice();
        onSamples({chain, start, draws, values, layout});
      },
      report_trace(chain, kind, p, n) {
        const bytes = new Uint8Array(ex.memory.buffer, p, n).slice();
        const trace = {chain, group: kind ? "sample_stats" : "posterior", bytes};
        traces.push(trace); if (onTrace) onTrace({...trace, bytes: bytes.slice()});
      },
      report_progress(chain, index, tuning) {onProgress({chain, index, tuning: !!tuning});},
    },
    // These are retained by the pinned dependency build, but are not used by
    // the explicitly seeded sequential sampler. Fail if that assumption changes.
    __wbindgen_placeholder__: {__wbindgen_describe: unexpected},
    __wbindgen_externref_xform__: {
      __wbindgen_externref_table_set_null: unexpected,
      __wbindgen_externref_table_grow: unexpected,
    },
  });
  ex = instance.exports;
  ex.set_result_options(1, Number(retainUnconstrained));
  const metadata = new TextEncoder().encode(JSON.stringify(layout));
  const units = Math.ceil(metadata.length/8), mp = ex.alloc_f64(units);
  try {
    new Uint8Array(ex.memory.buffer, mp, metadata.length).set(metadata);
    if (ex.set_variables(mp, metadata.length)) throw Error("Invalid variable metadata");
  } finally {ex.free_f64(mp, units);}
  const n = model.initial.length, p = ex.alloc_f64(n);
  try {
    new Float64Array(ex.memory.buffer, p, n).set(model.initial);
    const started = performance.now();
    const status = ex.run(n, chains, tune, draws, seed, p, targetAccept);
    const samplingSeconds = (performance.now() - started) / 1000;
    const result = JSON.parse(new TextDecoder().decode(
      new Uint8Array(ex.memory.buffer, ex.result_ptr(), ex.result_len())));
    if (status) throw Error(result.error);
    const copy = name => new Float64Array(ex.memory.buffer, ex[`${name}_ptr`](), ex[`${name}_len`]()).slice();
    result.expanded_samples = copy('expanded');
    result.stats = copy('stats');
    if (retainUnconstrained) result.samples = copy('samples');
    result.result_format = 'binary';
    const output = resultFormat === 'binary' ? result : compatibilityResult(result);
    return {...output, sampling_seconds: samplingSeconds, layout: model.layout, expanded_layout: layout, coords: model.coords ?? {}, traces};
  } finally {
    ex.free_f64(p, n);
  }
}

/** Materialize the historical nested-array API only at its public boundary. */
export function compatibilityResult(result) {
  if (result.result_format !== 'binary') return result;
  const [chains, draws, width] = result.shape;
  const nested = (values, size) => Array.from({length: chains}, (_, c) =>
    Array.from({length: draws}, (_, d) => Array.from(values.subarray((c*draws+d)*size, (c*draws+d+1)*size))));
  const output = {...result, result_format: 'compatibility', expanded_samples: nested(result.expanded_samples, width),
    stats: Array.from({length: chains}, (_, c) => Array.from({length: draws}, (_, d) => {
      const i = (c*draws+d)*3;
      return {diverging: !!result.stats[i], n_steps: result.stats[i+1], step_size: result.stats[i+2]};
    }))};
  if (result.samples) output.samples = nested(result.samples, result.unconstrained_width);
  return output;
}

/** Stage owned bytes locally before transferring the final buffers to the client. */
export function stageWorkerResult(result, fs, directory) {
  if (!fs?.writeFile) throw Error('The runtime must export Module.FS for local result construction');
  fs.mkdir(directory);
  const {traces, expanded_samples, samples, stats, ...metadata} = result;
  const files = [];
  try {
    for (const [name, values] of Object.entries({expanded_samples, samples, stats})) {
      if (!values) continue;
      const path = `${directory}/${name}.bin`;
      files.push(path);
      fs.writeFile(path, new Uint8Array(values.buffer, values.byteOffset, values.byteLength), {canOwn: false});
      metadata[`${name}_file`] = path;
    }
    const path = `${directory}/metadata.json`;
    files.push(path);
    fs.writeFile(path, new TextEncoder().encode(JSON.stringify(metadata)));
    return path;
  } catch (error) {
    for (const path of files) {try {fs.unlink(path);} catch { /* Preserve the write error. */ }}
    try {fs.rmdir(directory);} catch { /* Preserve the write error. */ }
    throw error;
  }
}

/** Clean a staged result when delivery fails before Python takes ownership. */
export function discardWorkerResult(fs, metadataPath) {
  const directory = metadataPath.slice(0, metadataPath.lastIndexOf('/'));
  for (const name of ['expanded_samples.bin', 'samples.bin', 'stats.bin', 'metadata.json']) {
    try {fs.unlink(`${directory}/${name}`);} catch { /* A failed write may not create a file. */ }
  }
  try {fs.rmdir(directory);} catch { /* Cleanup must not mask the delivery error. */ }
}
