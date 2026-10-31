// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let rules: typeof import('../src/features/rules/index.js');
let shell: typeof import('../src/features/shell/interface.js');
let toolbar: typeof import('../src/features/rules/toolbar.js');
let workbench: typeof import('../src/features/rules/workbench.js');
let context: typeof import('../src/core/context.js');
let lifetime: typeof import('../src/core/router/route-lifetime');
let root: HTMLElement;
let firstControlDelay = 0;

const features = {
  request_blocking: true, block_special_qtypes: true, adguard: true,
  block_aaaa: true, full_cache: true, route_cache: true, client_policy: 'normal',
};

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn() }));
  document.body.innerHTML = '<main id="page-content"></main>';
  root = document.getElementById('page-content')!;
  [rules, shell, toolbar, workbench, context, lifetime] = await Promise.all([
    import('../src/features/rules/index.js'),
    import('../src/features/shell/interface.js'),
    import('../src/features/rules/toolbar.js'),
    import('../src/features/rules/workbench.js'),
    import('../src/core/context.js'),
    import('../src/core/router/route-lifetime'),
  ]);
});

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, '', '#/rules');
  root.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  context.state.ruleTag = 'whitelist';
  context.state.route = 'rules';
  firstControlDelay = 0;
  shell.initialize();
  toolbar.initialize();
  workbench.initialize();
  vi.stubGlobal('fetch', (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === '/api/v1/features') return Promise.resolve(Response.json(features));
    if (!url.pathname.startsWith('/api/v1/lists/')) throw new Error('Unexpected request: ' + url.pathname);
    const list = url.pathname.split('/').pop()!;
    const delay = list === 'proxy_realip' ? firstControlDelay : 0;
    if (list === 'proxy_realip') firstControlDelay = 0;
    return new Promise<Response>((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) { reject(signal.reason); return; }
      const abort = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve(new Response('domain:' + list + '.example.com', { headers: { 'Content-Type': 'text/plain' } }));
      }, delay);
      signal?.addEventListener('abort', abort, { once: true });
    });
  });
});

afterEach(() => {
  lifetime.currentScope().dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

afterAll(() => vi.unstubAllGlobals());

async function enterRules() {
  const mounted = rules.renderRules(root, { scope: lifetime.beginRoute() });
  await vi.advanceTimersByTimeAsync(1);
  await mounted;
  shell.shellInterfaceService.apply();
  await vi.advanceTimersByTimeAsync(20);
}

function selectList(tag: string) {
  const select = root.querySelector<HTMLSelectElement>('#console-list-select')!;
  select.value = tag;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectGroup(index: number) {
  root.querySelectorAll<HTMLButtonElement>('[data-rule-group]')[index].click();
}

function activeList() {
  return root.querySelector<HTMLElement>('.rule-menu [data-rule-tag].active')?.dataset.ruleTag;
}

describe('rule selection', () => {
  it('opens the requested list in another group', async () => {
    await enterRules();
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('direct_ip');
  });

  it('keeps the latest dropdown selection when a previous group is still loading', async () => {
    await enterRules();
    firstControlDelay = 1000;
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(20);
    selectList('pcdn_regex_v6');
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('pcdn_regex_v6');
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(activeList()).toBe('force_realip');
  });

  it('opens the requested list after a slow successful group load', async () => {
    await enterRules();
    firstControlDelay = 8500;
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(8600);
    expect(activeList()).toBe('direct_ip');
  });

  it('keeps the manually selected group after an earlier dropdown request is cancelled', async () => {
    await enterRules();
    firstControlDelay = 1000;
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(20);
    selectGroup(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(activeList()).toBe('pcdn_domains');
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(activeList()).toBe('force_realip');
  });

  it('does not revive a dropdown selection after leaving and returning to the rules page', async () => {
    await enterRules();
    firstControlDelay = 1000;
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(20);
    lifetime.beginRoute();
    history.replaceState(null, '', '#/logs');
    root.innerHTML = '<p>Queries</p>';
    await vi.advanceTimersByTimeAsync(20);
    history.replaceState(null, '', '#/rules');
    await enterRules();
    expect(activeList()).toBe('force_realip');
  });
});
