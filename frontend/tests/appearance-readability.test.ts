import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALPHA_FLOOR, DIMMER_FLOOR, LAYERS, STATUS, TEXT, WALLPAPERS,
  alphaFloor, contrast, glassSurfaces, hexRgb, worstContrast,
} from '../src/features/appearance/readability.js';
import { MATERIAL_DEFAULTS, MATERIAL_FLOORS } from '../src/features/appearance/material.js';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(path.join(frontend, file), 'utf8');
const tokens = read('src/styles/tokens.css');
const html = read('index.html');
type Mode = 'cosmos' | 'light';

/** 取出某个选择器第一个块里的变量声明。 */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector + ' {');
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}
const css: Record<Mode, Record<string, string>> = { cosmos: block(':root'), light: { ...block(':root'), ...block('html[data-theme="light-glass"]') } };
const worstWall: Record<Mode, number[]> = { cosmos: WALLPAPERS.white, light: WALLPAPERS.black };
const floor = (n: number) => Math.floor(n * 100) / 100;

describe('glass material floors', () => {
  it('uses alpha ≥ 62% and dimmer ≥ 20%, raising alpha as blur drops', () => {
    expect(MATERIAL_FLOORS).toEqual({ alpha: ALPHA_FLOOR, dimmer: DIMMER_FLOOR });
    expect(ALPHA_FLOOR).toBeGreaterThanOrEqual(62);
    expect(DIMMER_FLOOR).toBeGreaterThanOrEqual(20);
    expect([4, 5, 6, 9, 10, 14, 48].map(alphaFloor)).toEqual([80, 80, 70, 70, 62, 62, 62]);
    expect(MATERIAL_DEFAULTS.alpha).toBe(ALPHA_FLOOR);
    expect(tokens).toMatch(/--glass-alpha: \.62;/);
    expect(html).toMatch(/id="slider-alpha" min="62"/);
    expect(html).toMatch(/id="slider-dimmer" min="20"/);
  });

  it('mirrors the CSS layer colours the model composites', () => {
    expect(tokens).toMatch(/--glass-bg: rgba\(21,22,26,var\(--glass-alpha\)\);/);
    expect(tokens).toMatch(/--glass-bg: rgba\(255,255,255,calc\(var\(--glass-alpha\) \* \.68 \+ \.28\)\);/);
    expect(tokens).toMatch(/--glass-pill: rgba\(54,57,64,\.28\);/);
    expect(tokens).toMatch(/--glass-pill: rgba\(224,231,241,\.34\);/);
    expect(read('src/styles/base.css')).toMatch(/background: rgba\(6, 7, 9, var\(--bg-dimmer\)\);/);
    expect(read('src/styles/components/themes.css')).toMatch(/background: rgba\(240, 244, 250, calc\(var\(--bg-dimmer\) \* 0\.55\)\);/);
    expect(LAYERS.cosmos.fill).toEqual([21, 22, 26]);
    expect(LAYERS.light.fillScale).toBe(.68);
    expect(LAYERS.light.fillOffset).toBe(.28);
  });
});

describe('text tokens match the readability model', () => {
  it.each(['cosmos', 'light'] as Mode[])('%s glass tokens equal TEXT / STATUS', mode => {
    const t = css[mode];
    expect(t['--text-1']).toBe(TEXT[mode].text1);
    expect(t['--text-2']).toBe(TEXT[mode].text2);
    expect(t['--text-3']).toBe(TEXT[mode].text3);
    expect(t['--primary-light']).toBe(TEXT[mode].primaryLight);
    expect(t['--console-success']).toBe(STATUS[mode].success);
    expect(t['--console-danger']).toBe(STATUS[mode].danger);
    expect(t['--console-info']).toBe(STATUS[mode].info);
  });

  it('keeps the text hierarchy distinct (text-1 > text-2 > text-3)', () => {
    for (const mode of ['cosmos', 'light'] as Mode[]) {
      const bg = glassSurfaces(mode, worstWall[mode], ALPHA_FLOOR, DIMMER_FLOOR).fill;
      const [c1, c2, c3] = [TEXT[mode].text1, TEXT[mode].text2, TEXT[mode].text3].map(c => contrast(hexRgb(c), bg));
      expect(c1).toBeGreaterThan(c2 * 1.1);
      expect(c2).toBeGreaterThan(c3 * 1.1);
    }
  });
});

describe('Claude light skin status colours', () => {
  // Claude 浅色皮肤是不透明纸面；状态色作 11px 徽章文字使用，需 ≥ 4.5:1。
  const skin = block('html[data-skin="claude"][data-theme="light-glass"]');
  const over = (rgba: [number, number, number, number], base: number[]) => base.map((c, i) => Math.round(rgba[i] * rgba[3] + c * (1 - rgba[3])));
  const surfaces = {
    panel: hexRgb(skin['--glass-bg']), pill: hexRgb(skin['--glass-pill']), page: hexRgb(skin['--bg-base']),
    badge: over([201, 100, 66, 0.09], hexRgb(skin['--glass-bg'])),
  };
  it.each(['--console-info', '--console-success', '--console-danger', '--text-2'])('%s ≥ 4.5:1 on every surface', name => {
    for (const [surface, bg] of Object.entries(surfaces)) {
      expect(floor(contrast(hexRgb(skin[name]), bg)), surface).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('tints primary badges with the skin accent, not the glass blue', () => {
    expect(read('src/styles/components/themes.css')).toMatch(/html\[data-skin=claude\]\[data-theme=light-glass\] \.badge\.primary\{background:rgba\(201,100,66,\.09\)/);
  });
});

describe('contrast at the floors on the worst wallpaper', () => {
  // 深色玻璃最怕纯白壁纸，浅色玻璃最怕纯黑壁纸；同时覆盖卡片填充、卡片内 pill、弹层强实底。
  const cases: [Mode, string, string, number][] = [];
  for (const mode of ['cosmos', 'light'] as Mode[]) {
    cases.push([mode, 'text-1', TEXT[mode].text1, 4.5]);
    cases.push([mode, 'text-2', TEXT[mode].text2, 4.5]);
    cases.push([mode, 'text-3', TEXT[mode].text3, mode === 'cosmos' ? 4 : 4.5]);
    cases.push([mode, 'primary-light', TEXT[mode].primaryLight, 4.5]);
    cases.push([mode, 'success', STATUS[mode].success, 4.5]);
    cases.push([mode, 'danger', STATUS[mode].danger, 4.5]);
    cases.push([mode, 'info', STATUS[mode].info, 4.5]);
  }
  it.each(cases)('%s %s %s ≥ %s:1', (mode, _name, color, min) => {
    for (const wall of Object.values(WALLPAPERS)) {
      expect(floor(worstContrast(mode, color, wall, ALPHA_FLOOR, DIMMER_FLOOR))).toBeGreaterThanOrEqual(min);
    }
  });

  it('stays readable at every blur once the dynamic alpha floor applies', () => {
    for (let blur = 4; blur <= 48; blur++) {
      for (const mode of ['cosmos', 'light'] as Mode[]) {
        const c = worstContrast(mode, TEXT[mode].text2, worstWall[mode], alphaFloor(blur), DIMMER_FLOOR);
        expect(c).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('documents the old floors as failing (regression guard for the model itself)', () => {
    const old = worstContrast('cosmos', '#B0B9C9', WALLPAPERS.white, 55, 15);
    expect(old).toBeLessThan(3);
    expect(worstContrast('cosmos', '#60A5FA', WALLPAPERS.white, 55, 15)).toBeLessThan(2.1);
  });
});
