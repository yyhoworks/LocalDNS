import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { projectRoot, files, sourceInputs, sourceDigest } from './build-inputs.mjs';

export function buildIntegrity(): Plugin {
  let output = '';
  return {
    name: 'localdns-build-integrity',
    apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      // VERSION.json is authoritative; never ship the public directory's old copy.
      const version = JSON.parse(await readFile(path.join(projectRoot, 'VERSION.json'), 'utf8')) as unknown;
      await writeFile(path.join(output, 'version.json'), JSON.stringify(version, null, 2) + '\n');
      const manifest = await files(output);
      delete manifest['build-meta.json'];
      await writeFile(path.join(output, 'build-meta.json'), JSON.stringify({ schema: 1, sourceDigest: await sourceDigest(), inputs: await sourceInputs(), version, files: manifest }, null, 2) + '\n');
    },
  };
}
