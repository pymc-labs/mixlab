import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(root, 'runtime-manifest.json'), 'utf8'),
);
try {
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(root, 'public/runtime', file.path));
    const expected =
      file.path === 'nuts-worker-loader.js'
        ? createHash('sha256')
            .update(
              await readFile(path.join(root, 'public/nuts/worker-loader.js')),
            )
            .digest('hex')
        : file.sha256;
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw Error(`Checksum mismatch: ${file.path}`);
  }
  console.log(
    `Verified ${manifest.files.length} runtime files against the pinned manifest.`,
  );
} catch (e) {
  console.error(
    `Runtime check failed: ${e.message}\nRun npm run runtime:setup first, or provide the tested runtime with --from /path/to/runtime.`,
  );
  process.exitCode = 1;
}
