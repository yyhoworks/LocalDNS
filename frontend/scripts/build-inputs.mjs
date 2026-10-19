import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function files(directory) {
  /** @type {Record<string, string>} */
  const result = {};
  async function walk(current) {
    for (const item of (await readdir(current, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const target = path.join(current, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink is not a build input: ${target}`);
      if (item.isDirectory()) await walk(target);
      else result[path.relative(directory, target).split(path.sep).join('/')] = digest(await readFile(target));
    }
  }
  await walk(directory);
  return result;
}

export async function sourceInputs() {
  /** @type {Record<string, string>} */
  const result = {};
  for (const directory of ['frontend/src', '_src/ui']) for (const [file, hash] of Object.entries(await files(path.join(projectRoot, directory)))) result[`${directory}/${file}`] = hash;
  for (const file of ['frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.ts', 'frontend/tsconfig.json', 'frontend/scripts/build-integrity.ts', 'frontend/scripts/build-inputs.mjs', 'VERSION.json']) result[file] = digest(await readFile(path.join(projectRoot, file)));
  return result;
}

export async function sourceDigest() { return digest(JSON.stringify(await sourceInputs())); }
