import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clampMaterial, MATERIAL_FLOORS } from '../src/features/appearance/material.js';

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

describe('appearance contrast floors', () => {
  it('raises slider minimums and the default glass alpha to the floors', () => {
    const html = read('index.html');
    expect(html).toMatch(/id="slider-alpha" min="62"[^>]*value="62"/);
    expect(html).toMatch(/id="slider-dimmer" min="20"/);
    expect(read('src/styles/tokens.css')).toMatch(/--glass-alpha: \.62;/);
    expect(MATERIAL_FLOORS).toEqual({ alpha: 62, dimmer: 20 });
  });
  it('clamps legacy stored values up to the floors and keeps valid ones', () => {
    expect(clampMaterial('alpha', 25, 25, 92)).toBe(62);
    expect(clampMaterial('alpha', 55, 55, 92)).toBe(62);
    expect(clampMaterial('alpha', 70, 55, 92)).toBe(70);
    expect(clampMaterial('alpha', 120, 55, 92)).toBe(92);
    expect(clampMaterial('dimmer', 0, 15, 88)).toBe(20);
    expect(clampMaterial('dimmer', 15, 15, 88)).toBe(20);
    expect(clampMaterial('dimmer', undefined, 15, 88)).toBe(22);
    expect(clampMaterial('alpha', 'bad', 55, 92)).toBe(62);
    expect(clampMaterial('blur', 2, 4, 48)).toBe(4);
  });
  it('raises the alpha floor when the blur radius is small', () => {
    expect(clampMaterial('alpha', 62, 62, 92, 4)).toBe(80);
    expect(clampMaterial('alpha', 62, 62, 92, 8)).toBe(70);
    expect(clampMaterial('alpha', 75, 62, 92, 8)).toBe(75);
    expect(clampMaterial('alpha', 62, 62, 92, 14)).toBe(62);
  });
});

describe('focus ring', () => {
  it('defines the visible focus outline once; others only adjust offset or hide it', () => {
    const rules = sources(path.join(frontend, 'src/styles'), ['.css']).flatMap(file =>
      [...readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({ selector: selector.trim(), body })));
    const rings = rules.filter(({ selector, body }) =>
      selector.includes(':focus-visible') && !selector.includes(':has(') && /(^|[;\s])outline\s*:\s*(?!none)/.test(body));
    expect(rings).toHaveLength(1);
    expect(rings[0].selector).toBe(':focus-visible');
    expect(rings[0].body.replace(/\s/g, '')).toBe('outline:2pxsolidvar(--focus-ring);outline-offset:2px');
  });
});
