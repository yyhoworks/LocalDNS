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
let listBodies: Record<string, string>;

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
  listBodies = {};
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
        resolve(new Response(listBodies[list] ?? 'domain:' + list + '.example.com', { headers: { 'Content-Type': 'text/plain' } }));
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
  root.querySelector<HTMLButtonElement>('[data-rule-tag="' + tag + '"]')!.click();
}

function selectGroup(index: number) {
  root.querySelectorAll<HTMLButtonElement>('[data-rule-group]')[index].click();
}

function activeList() {
  return root.querySelector<HTMLElement>('.rule-menu [data-rule-tag].active')?.dataset.ruleTag;
}

describe('rule selection', () => {
  it('selects the group and its list from the same navigation rail', async () => {
    await enterRules();
    selectGroup(2);
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('pcdn_domains');
    root.querySelector<HTMLButtonElement>('[data-rule-tag="pcdn_regex_v4"]')!.click();
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('pcdn_regex_v4');
    expect(root.querySelector<HTMLButtonElement>('.rule-selector-bar [data-rule-group].active')!.dataset.ruleGroup).toBe('PCDN 抑制');
    expect(root.querySelector('.rule-selector-bar [data-rule-tag="pcdn_regex_v4"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('#console-list-select')).toBeNull();
  });

  it('opens the requested list in another group', async () => {
    await enterRules();
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(40);
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('direct_ip');
  });

  it('keeps the latest group selection when a previous group is still loading', async () => {
    await enterRules();
    firstControlDelay = 1000;
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(20);
    selectGroup(2);
    await vi.advanceTimersByTimeAsync(40);
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
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(8600);
    selectList('direct_ip');
    await vi.advanceTimersByTimeAsync(40);
    expect(activeList()).toBe('direct_ip');
  });

  it('restores a draft after switching to another group and back', async () => {
    await enterRules();
    const text = root.querySelector<HTMLTextAreaElement>('#rule-text')!;
    const draft = text.value + '\ndomain:draft.example.net';
    text.value = draft;
    text.dispatchEvent(new Event('input', { bubbles: true }));
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(40);
    selectGroup(0);
    await vi.advanceTimersByTimeAsync(40);
    shell.shellInterfaceService.apply();
    await vi.advanceTimersByTimeAsync(20);
    expect(root.querySelector<HTMLTextAreaElement>('#rule-text')!.value).toBe(draft);
  });

  it('does not revive a cancelled request after leaving and returning to the rules page', async () => {
    await enterRules();
    firstControlDelay = 1000;
    selectGroup(1);
    await vi.advanceTimersByTimeAsync(20);
    lifetime.beginRoute();
    history.replaceState(null, '', '#/logs');
    root.innerHTML = '<p>Queries</p>';
    await vi.advanceTimersByTimeAsync(20);
    history.replaceState(null, '', '#/rules');
    await enterRules();
    expect(activeList()).toBe('force_realip');
  });

  it('counts saved enabled entries rather than comments, blank lines or a local draft', async () => {
    listBodies.direct = '# group\ndomain:a.example.com\n\n# domain:disabled.example.com\nfull:b.example.com';
    await enterRules();
    expect(root.querySelector('[data-rule-count="whitelist"]')!.textContent).toBe('2');
    expect(root.querySelector('[data-rule-count="greylist"]')!.textContent).toBe('1');
    const text = root.querySelector<HTMLTextAreaElement>('#rule-text')!;
    text.value += '\ndomain:draft.example.net';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector('[data-rule-count="whitelist"]')!.textContent).toBe('2');
  });
});
