// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { icon, strokeIcon } from '../src/shared/components/icons.js';

type VersionService = typeof import('../src/features/version/index.js')['versionService'];
let versionService: VersionService;
beforeAll(async () => {
  // context.js 在模块导入期读取 matchMedia，先补全局再动态导入版本模块。
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }));
  ({ versionService } = await import('../src/features/version/index.js'));
});

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(frontend, 'index.html'), 'utf8');
const toolbarCss = readFileSync(path.join(frontend, 'src/styles/features/toolbar.css'), 'utf8');
const dock = html.slice(html.indexOf('<div class="top-actions-dock">'), html.indexOf('<!-- 背景与双皮肤自定义弹出面板 -->'));

describe('version badge label', () => {
  it('drops the year and keeps leading zeros', () => {
    expect(versionService.shortVersion('2026.11.03.1')).toBe('11.03.1');
    expect(versionService.shortVersion('2026.11.03.1-local.20261103')).toBe('11.03.1');
    expect(versionService.shortVersion('fjmos-ui-v2026.01.02.10')).toBe('01.02.10');
    expect(versionService.shortVersion('')).toBe('');
    expect(versionService.shortVersion(undefined)).toBe('');
  });

  it('shows the current version, and the target only when an update is available', () => {
    expect(versionService.badgeLabel('2026.11.03.1', '2026.11.03.1', false)).toBe('v11.03.1');
    expect(versionService.badgeLabel('2026.11.03.1', '2026.11.04.1', true)).toBe('v11.03.1 → 11.04.1');
    expect(versionService.badgeLabel('2026.11.03.1', '2026.11.04.1', false)).toBe('v11.03.1');
    // Same version but a new core: still flagged, but no misleading "→ same" arrow.
    expect(versionService.badgeLabel('2026.11.03.1', '2026.11.03.1', true)).toBe('v11.03.1');
    expect(versionService.badgeLabel('', '2026.11.04.1', true)).toBe('版本');
    expect(versionService.badgeParts('2026.11.03.1', '2026.11.04.1', true)).toEqual({ current: 'v11.03.1', next: '11.04.1' });
  });
});

describe('top toolbar markup', () => {
  it('orders the groups version │ proxy │ view tools │ refresh/theme with dividers', () => {
    const order = ['id="version-button"', 'dock-divider', 'id="proxy-launcher"', 'dock-divider', 'glass-action-capsule',
      'id="btn-open-bg-customizer"', 'id="btn-toggle-particles"', 'dock-divider', 'id="refresh-button"', 'id="theme-toggle"'];
    let cursor = 0;
    for (const token of order) {
      const at = dock.indexOf(token, cursor);
      expect(at, token).toBeGreaterThanOrEqual(cursor);
      cursor = at + token.length;
    }
  });

  it('renders a single-line badge whose full version lives in title / aria-label', () => {
    expect(dock).toMatch(/data-version-label>/);
    expect(dock).toMatch(/data-version-next hidden>/);
    expect(dock).not.toMatch(/data-version-status|version-button-copy/);
  });

  it('does not ship the appearance button pre-highlighted; it highlights only while expanded', () => {
    expect(dock).toMatch(/<button type="button" class="icon-action-btn" id="btn-open-bg-customizer"[^>]*aria-expanded="false"/);
    expect(dock).not.toMatch(/class="[^"]*\bactive\b[^"]*" id="btn-open-bg-customizer"/);
    expect(toolbarCss).toMatch(/#btn-open-bg-customizer\[aria-expanded=true\]/);
  });

  it('marks particles with a dot keyed on aria-pressed instead of a solid fill', () => {
    expect(dock).toMatch(/id="btn-toggle-particles" aria-pressed="true"/);
    expect(toolbarCss).toMatch(/\.particle-inline-btn\[aria-pressed=true\]::after/);
  });

  it('uses 1.8 strokes for every inline toolbar icon', () => {
    const widths = [...dock.matchAll(/stroke-width="([\d.]+)"/g)].map(match => match[1]);
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths)).toEqual(new Set(['1.8']));
  });

  it('keeps narrow-screen entries for the items the toolbar hides', () => {
    for (const target of ['#btn-toggle-particles', '[data-ovb-trigger]', '#version-button'])
      expect(html).toContain(`data-toolbar-proxy="${target}"`);
  });
});

describe('toolbar stroke icons', () => {
  it('draws outline icons without touching the filled set used elsewhere', () => {
    for (const name of ['overview', 'refresh', 'theme', 'power']) {
      const svg = strokeIcon(name);
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-width="1.8"');
    }
    expect(icon('overview')).toContain('fill="currentColor"');
    expect(icon('refresh')).toContain('fill="currentColor"');
  });
});
