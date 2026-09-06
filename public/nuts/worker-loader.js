// Classic worker: the supplied Xeus worker exposes Comlink and globalThis.Module.
const options = new URL(self.location.href).searchParams;
importScripts(options.get('runtimeWorker'));
self.nutsBrowser = {async sample(config, options) {
  let stagedPath, discard;
  try {
    const assets = new URL(new URL(self.location.href).searchParams.get('adapterUrl'));
    const {sample, compatibilityResult, stageWorkerResult, discardWorkerResult} = await import(new URL('bridge.mjs', assets).href);
    discard = discardWorkerResult;
    const response = await fetch(new URL('nuts_browser_adapter.wasm', assets));
    if (!response.ok) throw Error('Could not load the Rust sampler');
    const result = await sample({bytes: await response.arrayBuffer(), runtime: Module,
      model: config, ...options, resultFormat: 'binary',
      onProgress: progress => self.postMessage({nuts: 'progress', progress}),
      onSamples: samples => self.postMessage({nuts: 'samples', samples}, [samples.values.buffer]),
    });
    const python_result_path = stagedPath = stageWorkerResult(result, Module.FS, `/tmp/nuts-result-${crypto.randomUUID()}`);
    const output = options.resultFormat === 'binary' ? result : compatibilityResult(result);
    output.python_result_path = python_result_path;
    const transfer = result.traces.map(t => t.bytes.buffer);
    if (options.resultFormat === 'binary') {
      for (const name of ['samples', 'expanded_samples', 'stats']) if (output[name]) transfer.push(output[name].buffer);
    }
    self.postMessage({nuts: 'result', result: output}, transfer);
  } catch(error) {if (stagedPath) discard(Module.FS, stagedPath); self.postMessage({nuts: 'error', message: String(error.stack || error)});}
}};
