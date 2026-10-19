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
const metadata = JSON.parse(await readFile(path.join(output, 'build-meta.json'), 'utf8'));
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
