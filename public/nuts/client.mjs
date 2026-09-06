/** High-level browser client. Model code is trusted Python executed locally. */
export function createSampler(options) {return new BrowserSampler(options);}
export class BrowserSampler {
  constructor({runtimeUrl, environment, assetsUrl = new URL('./', import.meta.url),
    wrap, comlinkUrl = new URL('./comlink.mjs', import.meta.url), loadTimeout = 300000}) {
    if (!runtimeUrl || !environment) throw Error('runtimeUrl and environment are required');
    this.base = new URL(runtimeUrl, globalThis.location?.href).href.replace(/\/?$/, '/');
    this.environment = environment; this.assets = new URL(assetsUrl, import.meta.url);
    this.wrap = wrap; this.comlinkUrl = comlinkUrl; this.loadTimeout = loadTimeout; this.busy = false;
    this.epoch = 0; this.worker = null; this.pending = new Map(); this.buffer = ''; this.config = null;
  }
  async initialize() {
    if (this.worker) return;
    const epoch = this.epoch;
    const wrap = this.wrap ?? (await import(this.comlinkUrl)).wrap;
    if (epoch !== this.epoch) throw new DOMException("Sampling cancelled", "AbortError");
    const workerUrl = new URL('nuts-worker-loader.js', this.base);
    workerUrl.searchParams.set('adapterUrl', this.assets.href);
    workerUrl.searchParams.set('runtimeWorker', new URL('comlink.worker.js', this.base));
    const worker = new Worker(workerUrl); this.worker = worker;
    this.remote = wrap(worker);
    worker.onerror = e => this.cancel(new Error(e.message || 'Browser runtime failed'));
    worker.onmessage = ({data: m}) => {
      if (m.nuts === 'progress') this.handlers?.onProgress?.(m.progress);
      if (m.nuts === 'samples') this.handlers?.onSamples?.(m.samples);
      if (m.nuts === 'result') {this.runPending?.resolve(m.result); this.runPending = null;}
      if (m.nuts === 'error') {this.runPending?.reject(Error(m.message)); this.runPending = null;}
      if (m.header?.msg_type === 'stream') {
        this.handlers?.onOutput?.(m.content.text);
        this.buffer += m.content.text;
        const lines = this.buffer.split('\n'); this.buffer = lines.pop();
        for (const line of lines) if (line.startsWith('NUTS_CONFIG ')) this.config = JSON.parse(line.slice(12));
      }
      if (m.header?.msg_type === 'execute_reply') {
        const id = m.parent_header?.msg_id, p = this.pending.get(id);
        this.pending.delete(id);
        if (m.content.status === 'error') p?.reject(Error(m.content.evalue || m.content.ename));
        else p?.resolve();
      }
    };
    let timeout;
    try {
      await Promise.race([(async () => {
        const spec = await this.fetch(new URL(`xeus/${this.environment}/xpython/kernel.json`, this.base), 'json');
        await this.remote.initialize({baseUrl: this.base, kernelId: crypto.randomUUID(),
          browsingContextId: crypto.randomUUID(), mountDrive: false,
          kernelSpec: {...spec, name: 'xpython', dir: 'xpython', envName: this.environment},
          empackEnvMetaLink: new URL(`xeus/${this.environment}`, this.base).href});
      })(), new Promise((_, reject) => {
        this.initReject = reject;
        timeout = setTimeout(() => reject(Error('Runtime loading timed out')), this.loadTimeout);
      })]);
    } catch(e) {this.cancel(e); throw e;}
    finally {clearTimeout(timeout); this.initReject = null;}
  }
  async fetch(url, mode = 'text') {
    const r = await fetch(url); if (!r.ok) throw Error(`Could not load ${url}: ${r.status}`);
    return r[mode]();
  }
  execute(code) {
    if (!this.worker) return Promise.reject(Error('Runtime is not initialized'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(); this.pending.set(id, {resolve, reject});
      const msg = {header: {msg_id: id, username: 'browser', session: 'nuts-rs-wasm',
        msg_type: 'execute_request', version: '5.3', date: new Date().toISOString()},
        parent_header: {}, metadata: {}, content: {code, silent: false, store_history: false,
          user_expressions: {}, allow_stdin: false, stop_on_error: true}, channel: 'shell', buffers: []};
      this.remote.processMessage({msg}).catch(e => {this.pending.delete(id); reject(e);});
    });
  }
  async sample(pythonCode, {chains = 2, tune = 750, draws = 500, seed = 42, targetAccept = .9,
    varNames = null, files = {}, signal, onProgress, onSamples, onOutput, onPhase,
    afterSample = ''} = {}) {
    if (this.busy) throw Error('A sampling run is already active');
    if (signal?.aborted) throw new DOMException('Sampling cancelled', 'AbortError');
    const epoch = this.epoch;
    const check = () => {if (epoch !== this.epoch || signal?.aborted) throw new DOMException("Sampling cancelled", "AbortError");};
    this.busy = true; this.handlers = {onProgress, onSamples, onOutput};
    const abort = () => this.cancel(); signal?.addEventListener('abort', abort, {once: true});
    try {
      onPhase?.('Loading browser runtime'); await this.initialize();
      if (signal?.aborted) throw new DOMException('Sampling cancelled', 'AbortError');
      const compiler = await this.fetch(new URL('compile_model.py', this.assets));
      const unpacker = await this.fetch(new URL('results.py', this.assets));
      check();
      let code = "import os\nos.environ['PYTENSOR_FLAGS']='cxx=,blas__ldflags=,numba__cache=False'\nimport json,time\nfrom pathlib import Path\n";
      for (const [path, contents] of Object.entries(files)) code += `Path(${JSON.stringify(path)}).write_text(${JSON.stringify(contents)})\n`;
      code += compiler + '\n_nuts_started=time.perf_counter()\n' + pythonCode;
      code += `\n_nuts_compiled=compile_browser_model(model, var_names=json.loads(${JSON.stringify(JSON.stringify(varNames))}))\n`;
      code += "_nuts_compile_seconds=time.perf_counter()-_nuts_started\nprint('NUTS_CONFIG '+json.dumps(dict(_nuts_compiled.config(), compile_seconds=_nuts_compile_seconds)),flush=True)\n";
      this.config = null; onPhase?.('Compiling model and transformations'); await this.execute(code);
      if (!this.config) throw Error('Model compiler did not return a configuration');
      onPhase?.('Sampling with Rust NUTS');
      const result = await new Promise((resolve, reject) => {
        this.runPending = {resolve, reject};
        this.remote.callGlobalReceiver('nutsBrowser', 'sample', this.config,
          {chains, tune, draws, seed, targetAccept}).catch(reject);
      });
      onPhase?.('Preparing posterior results');
      // Arrow IPC stays in JS; Python receives the numeric compatibility view.
      const {traces, ...numeric} = result;
      await this.execute(`_nuts_result=json.loads(${JSON.stringify(JSON.stringify(numeric))})\n${unpacker}\n` +
        "idata=to_inference_data(_nuts_result)\n" + afterSample);
      result.compile_seconds = this.config.compile_seconds;
      return result;
    } finally {signal?.removeEventListener('abort', abort); this.busy = false; this.handlers = null;}
  }
  cancel(error = new DOMException('Sampling cancelled', 'AbortError')) {
    this.epoch++; this.worker?.terminate(); this.worker = null;
    this.initReject?.(error); this.runPending?.reject(error); this.runPending = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear(); this.buffer = ''; this.config = null;
  }
  close() {this.cancel();}
}
