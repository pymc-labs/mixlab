import { makeLabNotebook } from './lab-notebook.mjs';
import { createSampler } from './nuts/client.mjs';
const $ = (id) => document.getElementById(id);
let sampler = null,
  payload = null,
  active = false,
  urls = [],
  controller = null;
const log = (text) => {
  if ($('log').textContent === 'Your Python output will appear here.')
    $('log').textContent = '';
  $('log').textContent += text;
  if ($('log').textContent.length > 250000)
    $('log').textContent = $('log').textContent.slice(-200000);
  $('log').scrollTop = $('log').scrollHeight;
};
const status = (text) => {
  $('status').textContent = text;
};
const setBusy = (value) => {
  active = value;
  $('run').disabled = value;
  $('stop').disabled = !value;
  $('source').disabled = value;
  $('settings').disabled = value;
  $('after').disabled = value;
  $('execute').disabled = value || !sampler?.worker;
};
const save = (name, body, type) => {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
try {
  const fragment = location.hash.slice(1);
  if (fragment.startsWith('local=')) {
    const key = decodeURIComponent(fragment.slice(6));
    const raw = sessionStorage.getItem(key);
    if (!raw)
      throw Error(
        'The local project is no longer available. Open the lab again from Mixlab.',
      );
    payload = JSON.parse(raw);
    sessionStorage.removeItem(key);
    history.replaceState(null, '', location.pathname);
  } else if (fragment) {
    payload = JSON.parse(decodeURIComponent(fragment));
    history.replaceState(null, '', location.pathname);
  } else {
    payload = await (await fetch('/lab-example.json')).json();
  }
  if (
    payload.version !== 1 ||
    typeof payload.source !== 'string' ||
    typeof payload.csv !== 'string' ||
    payload.csv.length > 5_000_000 ||
    payload.source.length > 200000 ||
    !Array.isArray(payload.varNames)
  )
    throw Error('This lab configuration is invalid.');
  $('source').value = payload.source;
  const { chains, tune, draws, targetAccept, seed } = payload.config;
  $('settings').value = JSON.stringify(
    { chains, tune, draws, targetAccept, seed, varNames: payload.varNames },
    null,
    2,
  );
  if (typeof payload.afterSample === 'string')
    $('after').value = payload.afterSample;
  if (typeof payload.followup === 'string')
    $('console').value = payload.followup;
  $('dataset').textContent =
    `${payload.csv.trim().split('\n').length - 1} observations · Exported model and data loaded locally.`;
  $('run').disabled = false;
} catch (e) {
  status(e.message);
  log(String(e) + '\n');
}
$('run').onclick = async () => {
  if (active || !payload) return;
  let options;
  try {
    options = JSON.parse($('settings').value);
    if (
      !Number.isInteger(options.chains) ||
      options.chains < 1 ||
      options.chains > 4 ||
      !Number.isInteger(options.draws) ||
      options.draws < 10 ||
      options.draws > 2000 ||
      !Number.isInteger(options.tune) ||
      options.tune < 0 ||
      options.tune > 3000 ||
      !Number.isFinite(options.targetAccept) ||
      options.targetAccept <= 0 ||
      options.targetAccept >= 1 ||
      !Array.isArray(options.varNames) ||
      options.varNames.some((n) => typeof n !== 'string')
    )
      throw Error(
        'Use 1–4 chains, 10–2000 draws, 0–3000 warmup, 0 < targetAccept < 1, and a string list of variable names.',
      );
  } catch (e) {
    status(e.message);
    return;
  }
  sampler?.close();
  sampler = createSampler({
    runtimeUrl: '/runtime/',
    environment: 'pymc-marketing-wasm',
  });
  controller = new AbortController();
  setBusy(true);
  $('downloads').replaceChildren();
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  $('log').textContent = '';
  $('progress').classList.remove('hidden');
  $('progress').removeAttribute('value');
  try {
    const result = await sampler.sample($('source').value, {
      ...options,
      files: { '/mixlab-data.csv': payload.csv },
      signal: controller.signal,
      afterSample: $('after').value,
      onOutput: log,
      onPhase: status,
      onProgress: (p) => {
        status(
          `${p.tuning ? 'Warmup' : 'Sampling'} · chain ${p.chain + 1}/${options.chains}`,
        );
        $('progress').value =
          (100 * (p.chain * (options.tune + options.draws) + p.index + 1)) /
          (options.chains * (options.tune + options.draws));
      },
    });
    for (const trace of result.traces) {
      const url = URL.createObjectURL(
        new Blob([trace.bytes], {
          type: 'application/vnd.apache.arrow.stream',
        }),
      );
      urls.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chain-${trace.chain + 1}-${trace.group}.arrows`;
      a.textContent = `Download chain ${trace.chain + 1} · ${trace.group}`;
      $('downloads').append(a);
    }
    status(
      `Complete · ${result.sampling_seconds.toFixed(1)}s sampling. Continue in the Python cell below.`,
    );
    $('progress').value = 100;
  } catch (e) {
    status(
      controller.signal.aborted ? 'Run stopped.' : `Python error: ${e.message}`,
    );
    log(String(e) + '\n');
  } finally {
    setBusy(false);
  }
};
$('stop').onclick = () => {
  controller?.abort();
  sampler?.close();
  status('Stopped. The Python session was closed.');
};
$('execute').onclick = async () => {
  if (active || !sampler?.worker) return;
  setBusy(true);
  controller = new AbortController();
  const abort = () => sampler?.close();
  controller.signal.addEventListener('abort', abort, { once: true });
  sampler.handlers = { onOutput: log };
  try {
    log('\n>>> Follow-up cell\n');
    await sampler.execute($('console').value);
    status('Python cell complete.');
  } catch (e) {
    status(e.message);
    log(String(e) + '\n');
  } finally {
    sampler.handlers = null;
    controller.signal.removeEventListener('abort', abort);
    setBusy(false);
  }
};
$('save').onclick = () => save('model.py', $('source').value, 'text/x-python');
$('clear').onclick = () => {
  $('log').textContent = '';
};
window.addEventListener('pagehide', () => {
  sampler?.close();
  urls.forEach(URL.revokeObjectURL);
});

$('notebook').onclick = () => {
  try {
    if (!payload) throw Error('Load a model first.');
    const { varNames, ...config } = JSON.parse($('settings').value);
    const result = makeLabNotebook(
      {
        source: $('source').value,
        csv: payload.csv,
        config,
        varNames,
        afterSample: $('after').value,
        followup: $('console').value,
      },
      location.origin,
    );
    save(
      'mixlab-edited-lab.ipynb',
      JSON.stringify(result, null, 2),
      'application/x-ipynb+json',
    );
    status(
      'Browser notebook prepared with your edited model and analysis cells.',
    );
  } catch (e) {
    status(e.message);
  }
};
