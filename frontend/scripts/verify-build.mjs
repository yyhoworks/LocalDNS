import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'vite';
import { files, sourceDigest } from './build-inputs.mjs';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(root, 'dist/ui');
// On a fresh clone dist/ui does not exist yet; say what is missing and which
// command creates it instead of surfacing a bare ENOENT stack.
async function readBuiltFile(name) {
  try {
    return await readFile(path.join(output, name), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(
        `Missing built UI file dist/ui/${name}. The frontend has not been built yet — ` +
          'run `npm run build` first (or `npm run check`, which builds before verifying).',
        { cause: error },
      );
    }
    throw error;
  }
}
const metadata = JSON.parse(await readBuiltFile('build-meta.json'));
const version = JSON.parse(await readFile(path.join(root, 'VERSION.json'), 'utf8'));
const html = await readBuiltFile('index.html');
assert(html.includes(`data-backend-version="${version.backendVersion}">${version.backendVersion}</span>`), 'The initial core label must match VERSION.json on direct page entry.');
assert.equal(metadata.sourceDigest, await sourceDigest(), 'Source changed; run npm run --prefix frontend build.');
const current = await files(output);
delete current['build-meta.json'];
assert.deepEqual(current, metadata.files, 'Build is incomplete or modified.');
const temporaryRoot = path.resolve(tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'localdns-frontend-'));
try {
  await build({ configFile: path.join(root, 'frontend/vite.config.ts'), logLevel: 'error', build: { outDir: temporary } });
  assert.deepEqual(await files(temporary), await files(output), 'Clean build differs from dist/ui.');
  console.log('Complete UI matches a clean build, source fingerprint and SHA-256 file manifest.');
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), temporaryRoot);
  assert(path.basename(temporary).startsWith('localdns-frontend-'));
  await rm(temporary, { recursive: true, force: true });
}
