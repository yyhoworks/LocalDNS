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
      const manifest = await files(output);
      delete manifest['build-meta.json'];
      const version = JSON.parse(await readFile(path.join(projectRoot, 'VERSION.json'), 'utf8')) as unknown;
      await writeFile(path.join(output, 'build-meta.json'), JSON.stringify({ schema: 1, sourceDigest: await sourceDigest(), inputs: await sourceInputs(), version, files: manifest }, null, 2) + '\n');
    },
  };
}
