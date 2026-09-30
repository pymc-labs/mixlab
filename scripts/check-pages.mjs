import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist/client');
const headers = await readFile(path.join(root, '_headers'), 'utf8');
if (!/^\/\*\s*\n\s*X-Robots-Tag:\s*noindex/m.test(headers)) {
  throw new Error('Missing wildcard noindex header in the Pages output.');
}
await stat(path.join(root, 'index.html'));
let count = 0;
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${file}`);
    if (entry.isDirectory()) await check(file);
    else {
      count++;
      if ((await stat(file)).size > 25 * 1024 * 1024) {
        throw new Error(`Cloudflare Pages asset exceeds 25 MiB: ${file}`);
      }
    }
  }
}
await check(root);
if (count > 20000) throw new Error(`Cloudflare Pages asset count exceeds 20,000: ${count}`);
console.log(`Checked ${count} Pages assets and the noindex header.`);
