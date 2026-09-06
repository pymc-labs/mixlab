/** One compiled guided model; discard the worker on model changes or inactivity. */
export function createSamplerSession(
  createSampler,
  { idleMs = 5 * 60_000 } = {},
) {
  let entry = null,
    timer = null,
    busy = false;
  function close() {
    clearTimeout(timer);
    timer = null;
    const previous = entry;
    entry = null;
    previous?.sampler.close();
  }
  async function run(source, { files, varNames, ...options }) {
    if (busy) throw Error('A sampling run is already active');
    if (options.signal?.aborted)
      throw new DOMException('Sampling cancelled', 'AbortError');
    busy = true;
    clearTimeout(timer);
    // Caller supplies only model-defining settings in files. Sampling settings
    // and analysis code can change without invalidating the compiled graph.
    const key = JSON.stringify([source, files, varNames]);
    let current;
    try {
      if (entry?.key !== key) {
        close();
        entry = { key, sampler: createSampler(), handle: null };
      }
      current = entry;
      const reused = !!current.handle;
      if (!current.handle)
        current.handle = await current.sampler.prepare(source, {
          files,
          varNames,
          signal: options.signal,
          onPhase: options.onPhase,
          onOutput: options.onOutput,
        });
      if (entry !== current)
        throw new DOMException('Sampling cancelled', 'AbortError');
      const result = await current.sampler.sample(current.handle, options);
      if (entry !== current)
        throw new DOMException('Sampling cancelled', 'AbortError');
      return {
        ...result,
        compile_seconds: reused ? 0 : current.handle.compile_seconds,
      };
    } catch (error) {
      close();
      throw error;
    } finally {
      busy = false;
      if (entry && entry === current) timer = setTimeout(close, idleMs);
    }
  }
  return { run, close };
}
