// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearGithubToken, githubAuthHeaders, maskToken, readGithubToken, readQuota, saveGithubToken, STORAGE_KEY, tokenProblem,
} from '../src/features/version/github-token';

const API = 'https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest';
// Synthetic values: the real shapes are not needed to exercise the helpers.
const CLASSIC = `tok_classic_${'a'.repeat(30)}`;
const FINE = `tok_fine_${'b'.repeat(60)}`;

describe('GitHub token header', () => {
  it('only attaches the token to GitHub API over HTTPS', () => {
    expect(githubAuthHeaders(API, 'abc')).toEqual({ Authorization: 'Bearer abc' });
    expect(githubAuthHeaders('https://github.com/yyhoworks/LocalDNS', 'abc')).toEqual({});
    expect(githubAuthHeaders('http://api.github.com/repos/x', 'abc')).toEqual({});
    expect(githubAuthHeaders('https://api.github.com.evil.example/repos/x', 'abc')).toEqual({});
    expect(githubAuthHeaders('/version.json', 'abc')).toEqual({});
    expect(githubAuthHeaders(API, '   ')).toEqual({});
  });

  it('keeps the token off the local console requests', () => {
    const local = new URL('version.json', 'http://192.168.8.2:9099/');
    expect(githubAuthHeaders(local, CLASSIC)).toEqual({});
  });
});

describe('token validation', () => {
  it('rejects blanks, page URLs, whitespace, short and oversized values', () => {
    expect(tokenProblem('')).toContain('粘贴');
    expect(tokenProblem('   ')).toContain('粘贴');
    expect(tokenProblem('https://github.com/settings/tokens')).toContain('令牌本身');
    expect(tokenProblem('tok_abc def')).toContain('空格');
    expect(tokenProblem('short')).toContain('长度');
    expect(tokenProblem('x'.repeat(300))).toContain('过长');
  });

  it('accepts classic and fine-grained shapes', () => {
    expect(tokenProblem(CLASSIC)).toBe('');
    expect(tokenProblem(FINE)).toBe('');
  });
});

describe('token masking', () => {
  it('keeps only the ends visible', () => {
    expect(maskToken('tok_1234567890abcdef4f2a')).toBe('tok_…4f2a');
    expect(maskToken('short')).toBe('sh…');
    expect(maskToken('')).toBe('');
  });
});

describe('quota headers', () => {
  it('reads limit, remaining and reset', () => {
    const headers = new Headers({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4987', 'x-ratelimit-reset': '1793545289' });
    expect(readQuota(headers)).toEqual({ limit: 5000, remaining: 4987, resetAt: 1793545289000 });
  });

  it('falls back to zero when the headers are missing or unreadable', () => {
    expect(readQuota(new Headers())).toEqual({ limit: 0, remaining: 0, resetAt: 0 });
    expect(readQuota(null)).toEqual({ limit: 0, remaining: 0, resetAt: 0 });
    expect(readQuota(new Headers({ 'x-ratelimit-limit': 'nope' }))).toEqual({ limit: 0, remaining: 0, resetAt: 0 });
  });
});

describe('browser storage', () => {
  // jsdom's storage is not guaranteed to win over the runtime's own localStorage
  // global, so the helpers are exercised against an explicit in-memory store.
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
  const install = (value: unknown) => {
    for (const target of [globalThis, window]) {
      Object.defineProperty(target, 'localStorage', { configurable: true, value });
    }
  };

  beforeEach(() => install(memory()));

  it('round-trips a trimmed token and clears it', () => {
    expect(readGithubToken()).toBe('');
    saveGithubToken(`  ${CLASSIC}  `);
    expect(readGithubToken()).toBe(CLASSIC);
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBe(CLASSIC);
    clearGithubToken();
    expect(readGithubToken()).toBe('');
  });

  it('does not throw when storage is unavailable', () => {
    install({ get getItem(): never { throw new Error('denied'); }, removeItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } });
    expect(readGithubToken()).toBe('');
    expect(() => clearGithubToken()).not.toThrow();
    expect(() => saveGithubToken(CLASSIC)).toThrow();
  });
});
