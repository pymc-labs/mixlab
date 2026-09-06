/** High-level browser client. Model code is trusted Python executed locally. */
const cancelled = () => new DOMException('Sampling cancelled', 'AbortError');
export function createSampler(options) {return new BrowserSampler(options);}
export class BrowserSampler {
  constructor({runtimeUrl, environment, assetsUrl = new URL('./', import.meta.url),
    wrap, comlinkUrl = new URL('./comlink.mjs', import.meta.url), loadTimeout = 300000}) {
    if (!runtimeUrl || !environment) throw Error('runtimeUrl and environment are required');
    this.base = new URL(runtimeUrl, globalThis.location?.href).href.replace(/\/?$/, '/');
    this.environment = environment; this.assets = new URL(assetsUrl, import.meta.url);
    this.wrap = wrap; this.comlinkUrl = comlinkUrl; this.loadTimeout = loadTimeout; this.busy = false;
    this.epoch = 0; this.worker = null; this.pending = new Map(); this.buffer = ''; this.config = null;
    this.models = new WeakMap(); this.initialization = null; this.operation = null;
  }
  initialize() {
    if (this.initialization) return this.initialization.promise;
    const state = {epoch: this.epoch, controller: new AbortController()};
    this.initialization = state;
    const check = () => {if (this.initialization !== state || state.epoch !== this.epoch) throw cancelled();};
    const interruption = new Promise((_, reject) => {state.reject = reject;});
    const timeout = setTimeout(() => state.reject(Error('Runtime loading timed out')), this.loadTimeout);
    const setup = Promise.resolve().then(async () => {
      const wrap = this.wrap ?? (await import(this.comlinkUrl)).wrap;
      check();
      const workerUrl = new URL('nuts-worker-loader.js', this.base);
      workerUrl.searchParams.set('adapterUrl', this.assets.href);
      workerUrl.searchParams.set('runtimeWorker', new URL('comlink.worker.js', this.base));
      const worker = new Worker(workerUrl); this.worker = worker;
      const remote = wrap(worker); this.remote = remote;
      worker.onerror = e => {if (this.initialization === state) this.cancel(new Error(e.message || 'Browser runtime failed'));};
      worker.onmessage = ({data: m}) => {
        if (this.initialization !== state) return;
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
      const spec = await this.fetch(new URL(`xeus/${this.environment}/xpython/kernel.json`, this.base), 'json', {signal: state.controller.signal});
      check();
      await remote.initialize({baseUrl: this.base, kernelId: crypto.randomUUID(),
        browsingContextId: crypto.randomUUID(), mountDrive: false,
        kernelSpec: {...spec, name: 'xpython', dir: 'xpython', envName: this.environment},
        empackEnvMetaLink: new URL(`xeus/${this.environment}`, this.base).href});
      check();
    });
    state.promise = Promise.race([setup, interruption]).catch(error => {
      if (this.initialization === state) this.cancel(error);
      throw error;
    }).finally(() => {clearTimeout(timeout); state.reject = null;});
    return state.promise;
  }
  async fetch(url, mode = 'text', options) {
    const r = await fetch(url, options); if (!r.ok) throw Error(`Could not load ${url}: ${r.status}`);
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
  async withOperation(options, action) {
    if (this.busy) throw Error('A sampling run is already active');
    const {signal, onProgress, onSamples, onOutput} = options;
    if (signal?.aborted) throw cancelled();
    const operation = {epoch: this.epoch};
    this.operation = operation; this.busy = true; this.handlers = {onProgress, onSamples, onOutput};
    const check = () => {if (operation.epoch !== this.epoch || signal?.aborted) throw cancelled();};
    const abort = () => {if (this.operation === operation) this.cancel();}; signal?.addEventListener('abort', abort, {once: true});
    try {return await action(check);}
    finally {
      signal?.removeEventListener('abort', abort);
      if (this.operation === operation) {this.operation = null; this.busy = false; this.handlers = null;}
    }
  }
  /** Explicitly freeze model/data/output selection and retain callbacks in this worker. */
  compile(pythonCode, options = {}) {
    return this.withOperation(options, check => this.prepareModel(pythonCode, options, check));
  }
  prepare(pythonCode, options = {}) {return this.compile(pythonCode, options);}
  release(handle) {
    return this.withOperation({}, async check => {
      const model = this.models.get(handle);
      if (!model || model.epoch !== this.epoch || !this.worker) throw Error('Compiled model handle is invalid or expired');
      await this.execute(`_nuts_models.pop(${JSON.stringify(handle.id)}, None)\n_nuts_compiled=None`);
      check(); this.models.delete(handle);
    });
  }
  async prepareModel(pythonCode, {varNames = null, files = {}, onPhase, mutableData = null} = {}, check) {
    if (typeof pythonCode !== 'string') throw TypeError('Model source must be a Python string');
    onPhase?.('Loading browser runtime'); await this.initialize(); check();
    const compiler = await this.fetch(new URL('compile_model.py', this.assets)); check();
    const id = crypto.randomUUID();
    let code = "import os\nos.environ['PYTENSOR_FLAGS']='cxx=,blas__ldflags=,numba__cache=False'\nimport json,time\nfrom pathlib import Path\n";
    for (const [path, contents] of Object.entries(files)) code += `Path(${JSON.stringify(path)}).write_text(${JSON.stringify(contents)})\n`;
    code += compiler + '\n_nuts_started=time.perf_counter()\n' + pythonCode;
    code += `\n_nuts_compiled=compile_browser_model(model, var_names=json.loads(${JSON.stringify(JSON.stringify(varNames))}), mutable_data=json.loads(${JSON.stringify(JSON.stringify(mutableData))}))\n`;
    code += `\nif '_nuts_models' not in globals(): _nuts_models={}\n_nuts_models[${JSON.stringify(id)}]=(_nuts_compiled, model)\n`;
    code += "_nuts_compile_seconds=time.perf_counter()-_nuts_started\nprint('NUTS_CONFIG '+json.dumps(dict(_nuts_compiled.config(), compile_seconds=_nuts_compile_seconds)),flush=True)\n";
    this.config = null; onPhase?.('Compiling model and transformations'); await this.execute(code); check();
    if (!this.config) throw Error('Model compiler did not return a configuration');
    const handle = Object.freeze({id, compile_seconds: this.config.compile_seconds});
    this.models.set(handle, {epoch: this.epoch, config: this.config});
    return handle;
  }
  updateData(handle, values) {
    return this.withOperation({}, async check => {
      const state = this.models.get(handle);
      if (!state || state.epoch !== this.epoch || !this.worker) throw Error('Compiled model handle is invalid or expired');
      await this.execute(`_nuts_models[${JSON.stringify(handle.id)}][0].update_data(json.loads(${JSON.stringify(JSON.stringify(values))}))`);
      check();
    });
  }
  sample(sourceOrHandle, options = {}) {
    return this.withOperation(options, async check => {
      const {chains = 2, tune = 750, draws = 500, seed = 42, targetAccept = .9,
        onPhase, afterSample = '', resultFormat = 'compatibility', retainUnconstrained = true, bridgeCache = 'callbacks', maxDepth = 10, jitter = 1, initRetries = 10} = options;
      if (!['compatibility', 'binary', 'stream'].includes(resultFormat)) throw Error('resultFormat must be compatibility, binary or stream');
      if (resultFormat === 'stream' && afterSample) throw Error('afterSample requires retained results; stream mode does not construct idata');
      const reused = typeof sourceOrHandle !== 'string';
      if (reused && ('files' in options || 'varNames' in options || 'mutableData' in options))
        throw Error('Please compile a new model to change files, varNames or mutableData; use updateData for selected values');
      const handle = reused ? sourceOrHandle : await this.prepareModel(sourceOrHandle, options, check);
      const model = this.models.get(handle);
      if (!model) throw Error('Compiled model handle belongs to another sampler or is invalid');
      if (model.epoch !== this.epoch || !this.worker) throw Error('Compiled model handle expired after worker termination; compile the model again');
      try {
        if (model.config.data_layout?.length) {
          await this.execute(`_nuts_models[${JSON.stringify(handle.id)}][0].activate_data()`); check();
        }
        const unpacker = resultFormat === 'stream' ? '' : await this.fetch(new URL('results.py', this.assets)); check();
        onPhase?.('Sampling with Rust NUTS');
        const result = await new Promise((resolve, reject) => {
          this.runPending = {resolve, reject};
          this.remote.callGlobalReceiver('nutsBrowser', 'sample', model.config,
            {chains, tune, draws, seed, targetAccept, resultFormat, retainUnconstrained, bridgeCache, maxDepth, jitter, initRetries}).catch(error => {
              if (this.runPending?.reject === reject) this.runPending = null;
              reject(error);
            });
        });
        check(); if (resultFormat !== 'stream') onPhase?.('Preparing posterior results');
        if (resultFormat !== 'stream') await this.execute(`_nuts_compiled,model=_nuts_models[${JSON.stringify(handle.id)}]\n_nuts_compile_seconds=${reused ? 0 : model.config.compile_seconds}\n${unpacker}\n_nuts_result=load_worker_result(${JSON.stringify(result.python_result_path)})\n` +
          "idata=to_inference_data(_nuts_result)\n" + afterSample);
        delete result.python_result_path;
        check(); result.compile_seconds = reused ? 0 : model.config.compile_seconds;
        result.model_compile_seconds = model.config.compile_seconds;
        return result;
      } finally {
        if (!reused) {
          this.models.delete(handle);
          if (model.epoch === this.epoch && this.worker) {
            await this.execute(`_nuts_models.pop(${JSON.stringify(handle.id)}, None)\n_nuts_compiled=None`);
          }
        }
      }
    });
  }
  cancel(error = cancelled()) {
    this.epoch++;
    const state = this.initialization; this.initialization = null;
    state?.controller.abort(); state?.reject?.(error);
    this.worker?.terminate(); this.worker = null; this.remote = null;
    this.initReject?.(error); this.initReject = null;
    this.runPending?.reject(error); this.runPending = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear(); this.buffer = ''; this.config = null;
    this.operation = null; this.busy = false; this.handlers = null;
  }
  close() {this.cancel();}
}
