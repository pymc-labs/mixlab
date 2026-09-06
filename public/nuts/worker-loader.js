// Classic worker: the supplied Xeus worker exposes Comlink and globalThis.Module.
const options = new URL(self.location.href).searchParams;
importScripts(options.get('runtimeWorker'));
self.nutsBrowser = {async sample(config, options) {
  try {
    const assets = new URL(new URL(self.location.href).searchParams.get('adapterUrl'));
    const {sample} = await import(new URL('bridge.mjs', assets).href);
    const response = await fetch(new URL('nuts_browser_adapter.wasm', assets));
    if (!response.ok) throw Error('Could not load the Rust sampler');
    const result = await sample({bytes: await response.arrayBuffer(), runtime: Module,
      model: config, ...options,
      onProgress: progress => self.postMessage({nuts: 'progress', progress}),
      onSamples: samples => self.postMessage({nuts: 'samples', samples}, [samples.values.buffer]),
    });
    self.postMessage({nuts: 'result', result}, result.traces.map(t => t.bytes.buffer));
  } catch(error) {self.postMessage({nuts: 'error', message: String(error.stack || error)});}
}};
