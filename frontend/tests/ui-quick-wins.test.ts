import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(path.join(frontend, file), 'utf8');
function sources(directory: string, extensions: string[]): string[] {
  return readdirSync(directory).flatMap(name => {
    const target = path.join(directory, name);
    if (statSync(target).isDirectory()) return sources(target, extensions);
    return extensions.some(ext => name.endsWith(ext)) ? [target] : [];
  });
}

describe('Chart.js removal', () => {
  it('loads no blocking Chart.js script and no source touches window.Chart', () => {
    expect(read('index.html')).not.toMatch(/chart\.umd/i);
    for (const file of sources(path.join(frontend, 'src'), ['.js', '.ts'])) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/window\.Chart\b|chart-adapter/);
    }
  });
});
