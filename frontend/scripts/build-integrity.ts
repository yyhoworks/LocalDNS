import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { projectRoot, files, sourceInputs, sourceDigest } from './build-inputs.mjs';

async function releaseVersion() {
  const version = JSON.parse(await readFile(path.join(projectRoot, 'VERSION.json'), 'utf8')) as { backendVersion?: unknown };
  if (typeof version.backendVersion !== 'string' || !/^FJ[A-Z][A-Z0-9]+$/.test(version.backendVersion)) {
    throw new Error('Invalid LocalDNS backend version');
  }
  return { ...version, backendVersion: version.backendVersion };
}

export function buildIntegrity(): Plugin {
  let output = '';
  return {
    name: 'localdns-build-integrity',
    apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    async transformIndexHtml(html) {
      const { backendVersion } = await releaseVersion();
      return html.replace('data-backend-version="">—</span>', `data-backend-version="${backendVersion}">${backendVersion}</span>`);
    },
    async closeBundle() {
      const version = await releaseVersion();
      await writeFile(path.join(output, 'version.json'), JSON.stringify(version, null, 2) + '\n');
      const manifest = await files(output);
      delete manifest['build-meta.json'];
      await writeFile(path.join(output, 'build-meta.json'), JSON.stringify({ schema: 1, sourceDigest: await sourceDigest(), inputs: await sourceInputs(), version, files: manifest }, null, 2) + '\n');
    },
  };
}
