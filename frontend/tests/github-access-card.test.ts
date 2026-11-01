// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/api/api.js', () => ({ api: { request: vi.fn(), json: vi.fn(), metrics: vi.fn() } }));
vi.mock('../src/core/context.js', () => ({ $: (selector: string) => document.querySelector(selector), $$: () => [], state: {}, page: null }));
vi.mock('../src/core/router/router.js', () => ({ renderRoute: vi.fn() }));

import { githubAccessHtml } from '../src/features/management/index.js';
import { clearGithubToken, saveGithubToken } from '../src/features/version/github-token';

const memory = () => {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
  } as unknown as Storage;
};

const install = () => {
  const storage = memory();
  for (const target of [globalThis, window]) Object.defineProperty(target, 'localStorage', { configurable: true, value: storage });
};

describe('GitHub access card', () => {
  beforeEach(() => { install(); clearGithubToken(); });

  it('renders an empty state with the token input and no clear button', () => {
    const html = githubAccessHtml();
    expect(html).toContain('GitHub 访问');
    expect(html).toContain('id="github-token-input"');
    expect(html).toContain('id="github-token-save"');
    expect(html).not.toContain('id="github-token-clear"');
    expect(html).toContain('未设置令牌');
  });

  it('shows the saved token masked and offers clearing it', () => {
    saveGithubToken('tok_1234567890abcdef4f2a');
    const html = githubAccessHtml();
    expect(html).toContain('tok_…4f2a');
    expect(html).not.toContain('1234567890abcdef');
    expect(html).toContain('id="github-token-clear"');
    expect(html).toContain('已设置');
  });

  it('escapes user-controlled text instead of injecting markup', () => {
    saveGithubToken('<img src=x onerror=alert(1)>tok_1234567890');
    const html = githubAccessHtml();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});
