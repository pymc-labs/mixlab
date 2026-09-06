// Copy the bootstrap next to Xeus' worker so its relative WASM assets resolve.
import {copyFile, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [runtimeDirectory, environment, flag] = process.argv.slice(2);
if (!runtimeDirectory || !environment) throw Error('Usage: node configure-runtime.mjs RUNTIME_DIRECTORY ENVIRONMENT [--export-memory]');
await copyFile(new URL('./worker-loader.js', import.meta.url), join(runtimeDirectory, 'nuts-worker-loader.js'));
if (flag === '--export-memory') {
  const loader = join(runtimeDirectory, 'xeus', environment, 'bin/xpython.js');
  const source = await readFile(loader, 'utf8');
  const marker = 'function updateMemoryViews(){';
  const replacement = marker + 'Module["wasmMemory"]=wasmMemory;';
  if (!source.includes(replacement)) {
    if (source.split(marker).length !== 2) throw Error('Unrecognized Xeus loader; export memory in the runtime build instead');
    await writeFile(loader, source.replace(marker, replacement));
  }
}
