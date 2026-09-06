import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  parseCSV,
  inferMapping,
  validate,
  defaultConfig,
} from '../lib/core.ts';
import { labPayload, notebook } from '../lib/exports.ts';
const raw = parseCSV(
  readFileSync(new URL('../public/example.csv', import.meta.url), 'utf8'),
);
const data = validate(raw, inferMapping(raw)).data!;
const origin = 'https://mixlab-marketing-studio.thomas-wiecki.chatgpt.site';
mkdirSync(new URL('../notebooks/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../public/lab-example.json', import.meta.url),
  JSON.stringify(labPayload(data, defaultConfig)),
);
for (const mode of ['browser', 'native'] as const) {
  const body =
    JSON.stringify(notebook(data, defaultConfig, mode, origin), null, 2) + '\n';
  writeFileSync(
    new URL(`../notebooks/mixlab-${mode}.ipynb`, import.meta.url),
    body,
  );
  writeFileSync(
    new URL(`../public/mixlab-${mode}.ipynb`, import.meta.url),
    body,
  );
}
console.log(
  'Generated native and browser notebooks from the actual model and example data.',
);
