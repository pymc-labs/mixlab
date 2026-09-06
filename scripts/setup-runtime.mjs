import { readFile, writeFile, mkdir, cp, rm, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(path.join(root, 'runtime-manifest.json'), 'utf8'),
);
const fromIndex = process.argv.indexOf('--from');
const temporary = await mkdtemp(path.join(tmpdir(), 'mixlab-runtime-'));
try {
  if (fromIndex !== -1) {
    if (!process.argv[fromIndex + 1])
      throw Error('Supply the existing runtime directory after --from.');
    await cp(
      path.resolve(process.argv[fromIndex + 1]),
      path.join(temporary, 'runtime'),
      { recursive: true },
    );
  } else {
    console.log('Downloading the pinned Mixlab runtime (~120 MB)…');
    const response = await fetch(manifest.archive.url);
    if (!response.ok)
      throw Error(
        `Runtime download failed: HTTP ${response.status}. You can also use --from /path/to/runtime.`,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      manifest.archive.sha256
    )
      throw Error('The downloaded archive failed its checksum.');
    const archive = path.join(temporary, 'runtime.tar.gz');
    await writeFile(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  }
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(temporary, 'runtime', entry.path));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const matchingBootstrap =
      fromIndex !== -1 &&
      entry.path === 'nuts-worker-loader.js' &&
      digest ===
        createHash('sha256')
          .update(
            await readFile(path.join(root, 'public/nuts/worker-loader.js')),
          )
          .digest('hex');
    if (digest !== entry.sha256 && !matchingBootstrap)
      throw Error(`Runtime file mismatch: ${entry.path}`);
  }
  await mkdir(path.join(root, 'public'), { recursive: true });
  await rm(path.join(root, 'public/runtime'), { recursive: true, force: true });
  // Copy only verified files, ignoring unrelated assets in a supplied source directory.
  for (const entry of manifest.files) {
    const target = path.join(root, 'public/runtime', entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(temporary, 'runtime', entry.path), target);
  }
  await cp(
    path.join(root, 'public/nuts/worker-loader.js'),
    path.join(root, 'public/runtime/nuts-worker-loader.js'),
  );
  console.log(`Installed and verified ${manifest.files.length} runtime files.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
