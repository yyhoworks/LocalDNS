// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let rules: typeof import('../src/features/rules/index.js');
let lifetime: typeof import('../src/core/router/route-lifetime');
let context: typeof import('../src/core/context.js');
let root: HTMLElement;
let delay: number;
let fail: boolean;
let writes: string[];
let completed: number;
let customSplitEnabled: boolean;
let customSplitMode: 'default' | 'custom';
let customSplitRules: Array<Record<string, unknown>>;
const features = { request_blocking: true, block_special_qtypes: true, adguard: true,
  block_aaaa: false, full_cache: true, route_cache: true, client_policy: 'normal' };

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn() }));
  document.body.innerHTML = '<main id="page-content"></main><div id="toast-stack"></div>';
  root = document.getElementById('page-content')!;
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
  [rules, lifetime, context] = await Promise.all([
    import('../src/features/rules/index.js'), import('../src/core/router/route-lifetime'), import('../src/core/context.js'),
  ]);
  const workspace = await import('../src/shared/workspace.js');
  workspace.initialize();
  workspace.workspaceService.setup({ state: context.state, fmtDate: String });
  (await import('../src/features/rules/conversion.js')).initialize();
  (await import('../src/features/rules/workbench.js')).initialize();
  (await import('../src/features/rules/toolbar.js')).initialize();
});

beforeEach(() => {
  vi.useFakeTimers();
  root.replaceChildren();
  document.getElementById('confirm-modal')?.remove();
  document.getElementById('toast-stack')!.replaceChildren();
  context.state.route = 'rules';context.state.ruleTag = 'whitelist';
  delay = 20000;fail = false;writes = [];completed = 0;
  customSplitEnabled = true;
  customSplitMode = 'custom';
  customSplitRules = [
    { type: 'block_list', enabled: true },
    { type: 'proxy_rule', name: 'Proxy source', url: 'https://example.com/proxy.srs', enabled: true, rule_count: 4 },
  ];
  vi.stubGlobal('fetch', async (input: string | URL | Request, options: RequestInit = {}) => {
    const path = new URL(String(input), location.origin).pathname;
    if (path === '/api/v1/custom-split' && (!options.method || options.method === 'GET')) {
      return customSplitEnabled ? Response.json({ mode: customSplitMode, rules: customSplitRules }) :
        Response.json({ error: 'unsupported' }, { status: 404 });
    }
    if (path === '/api/v1/status') return Response.json({ rules: { block: 12 } });
    if (path === '/api/v1/custom-split' && options.method === 'PUT') {
      writes.push(path);
      const value = JSON.parse(String(options.body));
      if (value.mode) customSplitMode = value.mode;
      if (value.rules) customSplitRules = value.rules.map((rule: Record<string, unknown>) => {
        const stored = customSplitRules.find(item => item.type === rule.type && item.name === rule.name);
        return { ...stored, ...rule };
      });
      return Response.json({ mode: customSplitMode, rules: customSplitRules });
    }
    if (options.method && options.method !== 'GET') {
      writes.push(path);
      return await new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          completed++;
          resolve(Response.json(fail ? { error: '测试来源不可用' } : { changed: true, rule_count: 7, updated_sources: 2 }, { status: fail ? 503 : 200 }));
        }, delay);
        options.signal?.addEventListener('abort', () => { clearTimeout(timer);reject(new DOMException('aborted', 'AbortError')); }, { once: true });
      });
    }
    if (path === '/api/v1/features') return Response.json(features);
    if (path.startsWith('/api/v1/lists/')) return new Response('domain:example.com');
    if (path === '/api/v1/adguard/rules') return Response.json(['one','two'].map(id => ({ id, name: id,
      url: 'https://example.com/' + id, enabled: true, rule_count: completed ? 7 : 1 })));
    if (path.startsWith('/api/v1/rule-groups/')) {
      const tag = path.split('/').pop()!;
      return Response.json(['custom_cn','geoip_non_cn'].includes(tag) ? [{ name: tag + ' source', type: tag,
        url: 'https://example.com/' + tag, enabled: true, detected_format: 'srs', rule_count: 1 }] : []);
    }
    throw new Error('Unexpected request: ' + path);
  });
});

afterEach(() => {
  lifetime.currentScope().dispose();
  vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();
});

const button = (selector: string) => root.querySelector<HTMLButtonElement>(selector)!;
const settle = () => vi.advanceTimersByTimeAsync(40);
async function enter(tab: string) {
  await rules.renderRules(root, { scope: lifetime.beginRoute() });
  await rules.renderRuleTab(tab);
  await settle();
}

describe('rule download interactions', () => {
  it('retains a single AdGuard update across tabs and blocks duplicate or conflicting writes', async () => {
    await enter('adguard');
    button('.ad-update').click();button('.ad-update').click();
    await settle();
    expect(button('.ad-update').textContent).toBe('更新中…');
    expect(button('#ad-update-all').disabled).toBe(true);
    expect(button('.ad-edit').disabled).toBe(true);
    await rules.renderRuleTab('diversion');
    await rules.renderRuleTab('adguard');await settle();
    expect(button('.ad-update').getAttribute('aria-busy')).toBe('true');
    expect(writes).toEqual(['/api/v1/adguard/rules/one/update']);
    await vi.advanceTimersByTimeAsync(20000);
    expect(button('.ad-update').textContent).toBe('更新');
    expect(button('#ad-update-all').disabled).toBe(false);
    expect(root.querySelector('.ad-count-cell')!.textContent).toBe('7');
  });

  it('marks all AdGuard update buttons while a batch download takes longer than ten seconds', async () => {
    await enter('adguard');button('#ad-update-all').click();await settle();
    expect([...root.querySelectorAll('.ad-update,#ad-update-all')].every(b => b.textContent === '更新中…')).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(button('#ad-update-all').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(button('#ad-update-all').textContent).toBe('更新全部');
    expect(writes).toEqual(['/api/v1/adguard/update']);
  });

  it('refreshes the new page after leaving and returning during a download', async () => {
    await enter('adguard');button('.ad-update').click();await settle();
    lifetime.beginRoute();root.replaceChildren();
    await enter('adguard');
    expect(button('.ad-update').textContent).toBe('更新中…');
    await vi.advanceTimersByTimeAsync(20000);
    expect(button('.ad-update').disabled).toBe(false);
    expect(button('.ad-update').textContent).toBe('更新');
    expect(root.querySelector('.ad-count-cell')!.textContent).toBe('7');
    expect(writes).toHaveLength(1);
  });

  it('updates only the requested diversion group and displays its pending state', async () => {
    await enter('diversion');
    button('[data-div-update-group="geoip_non_cn"]').click();await settle();
    expect(button('[data-div-update-group="geoip_non_cn"]').textContent).toBe('更新中…');
    expect(button('[data-div-update-group="custom_cn"]').textContent).toBe('全部更新');
    expect(button('[data-div-update-group="custom_cn"]').disabled).toBe(true);
    expect(writes).toEqual(['/api/v1/rule-groups/geoip_non_cn/geoip_non_cn%20source/update']);
    await vi.advanceTimersByTimeAsync(20000);
    expect(button('[data-div-update-group="geoip_non_cn"]').textContent).toBe('全部更新');
    expect(button('#div-update-all').disabled).toBe(false);
  });

  it('restores single diversion buttons after a server error', async () => {
    fail = true;await enter('diversion');
    button('.div-update').click();await settle();
    expect(button('.div-update').textContent).toBe('更新中…');
    await vi.advanceTimersByTimeAsync(20000);
    expect(button('.div-update').textContent).toBe('更新');
    expect(button('.div-edit').disabled).toBe(false);
    expect(document.querySelector('#toast-stack')!.textContent).toContain('测试来源不可用');
  });

  it('reports five-minute batch timeouts as unknown results without retrying', async () => {
    delay = 400000;await enter('diversion');
    button('#div-update-all').click();await settle();
    await vi.advanceTimersByTimeAsync(299000);
    expect(button('#div-update-all').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(button('#div-update-all').textContent).toBe('更新全部');
    expect(document.querySelector('#toast-stack')!.textContent).toContain('结果待确认');
    expect(writes).toHaveLength(2);
  });

  it('shows FJOP0 mode controls and saves mode changes through the capability endpoint', async () => {
    await enter('adguard');
    expect(root.querySelector('[data-rule-mode="custom"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-rule-mode="default"]')!.click();
    document.querySelector<HTMLButtonElement>('#confirm-ok')!.click();
    await settle();
    expect(customSplitMode).toBe('default');
    expect(writes).toEqual(['/api/v1/custom-split']);
    expect(root.querySelector('[data-rule-tab="custom-split"]')).toBeNull();
  });

  it('saves custom rule order and enabled state without touching legacy groups', async () => {
    await enter('custom-split');
    expect(root.querySelector('.custom-split-list')?.textContent).toContain('Proxy source');
    root.querySelector<HTMLButtonElement>('[data-split-move="1"][data-index="0"]')!.click();
    await settle();
    expect(customSplitRules.map(rule => rule.type)).toEqual(['proxy_rule', 'block_list']);
    const enabled = root.querySelector<HTMLInputElement>('[data-split-enabled="0"]')!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(customSplitRules[0].enabled).toBe(false);
    expect(writes).toEqual(['/api/v1/custom-split', '/api/v1/custom-split']);
  });

  it('keeps the custom mode hidden when an older core does not expose it', async () => {
    customSplitEnabled = false;
    await enter('adguard');
    expect(root.querySelector('#rule-mode-controls')?.textContent).toBe('');
    expect(root.querySelector('[data-rule-tab="custom-split"]')).toBeNull();
  });
});
