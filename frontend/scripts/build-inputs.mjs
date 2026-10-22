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
  // Environment files can change what Vite inlines into the bundle, but they
  // must never become part of the committed build inputs (they may carry
  // machine-local values or secrets). Fail loudly instead of fingerprinting
  // them; .env.example is documentation and stays allowed.
  const frontendRoot = path.join(projectRoot, 'frontend');
  for (const entry of await readdir(frontendRoot, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      (entry.name === '.env' || (entry.name.startsWith('.env.') && entry.name !== '.env.example'))
    ) {
      throw new Error(
        `Refusing to fingerprint environment file frontend/${entry.name}: ` +
          'remove or rename it before building so the build stays reproducible.',
      );
    }
  }
  /** @type {Record<string, string>} */
  const result = {};
  for (const directory of ['frontend/src', '_src/ui']) for (const [file, hash] of Object.entries(await files(path.join(projectRoot, directory)))) result[`${directory}/${file}`] = hash;
  for (const file of ['frontend/index.html', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.ts', 'frontend/tsconfig.json', 'frontend/scripts/build-integrity.ts', 'frontend/scripts/build-inputs.mjs', 'frontend/scripts/verify-build.mjs', 'VERSION.json']) result[file] = digest(await readFile(path.join(projectRoot, file)));
  return result;
}

export async function sourceDigest() { return digest(JSON.stringify(await sourceInputs())); }
