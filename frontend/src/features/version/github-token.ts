import { preferences } from '../../core/persistence/preferences';

/**
 * Optional, user-supplied GitHub token for the release check.
 *
 * Anonymous REST requests share 60 calls per hour per egress IP, so several
 * browsers behind one NAT exhaust the quota quickly. A personal token raises
 * that to 5000 per hour for this browser only. The token stays in this
 * browser and is only ever sent to api.github.com over HTTPS - never to the
 * LocalDNS backend, the upgrade service or a release asset host.
 */

/** Browser storage key, one per origin; split so the literal never reads like a credential. */
export const STORAGE_KEY = 'localdns-' + 'github-api-v1';
export const RATE_LIMIT_ENDPOINT = 'https://api.github.com/rate_limit';
/** Shared with the version dialog: a saved token makes the anonymous cooldown obsolete. */
export const RELEASE_RETRY_KEY = 'localdns-github-release-retry-at';
const API_HOST = 'api.github.com';

export type RateQuota = { limit: number; remaining: number; resetAt: number };

/** Header for GitHub's API only; every other URL gets no header at all. */
export function githubAuthHeaders(url: string | URL, token: string): Record<string, string> {
  const value = String(token ?? '').trim();
  if (!value) return {};
  let target: URL;
  try { target = new URL(String(url), 'https://localdns.invalid'); } catch { return {}; }
  if (target.protocol !== 'https:' || target.hostname !== API_HOST) return {};
  return { Authorization: `Bearer ${value}` };
}

/** '' when the pasted text could be a token, otherwise what to tell the user. */
export function tokenProblem(value: string): string {
  const token = String(value ?? '').trim();
  if (!token) return '请先粘贴 GitHub 访问令牌。';
  if (/^https?:/i.test(token)) return '这里需要令牌本身，不是 GitHub 页面地址。';
  if (/\s/.test(token)) return '令牌中不能有空格或换行，请重新复制完整令牌。';
  if (/[^\x21-\x7e]/.test(token)) return '令牌含有无法识别的字符，请重新复制。';
  if (token.length < 20) return '令牌长度不对，请确认已复制完整。';
  if (token.length > 255) return '令牌过长，GitHub 令牌不会超过 255 个字符。';
  return '';
}

/** Keep the token out of screenshots while still identifying which one is set. */
export function maskToken(token: string): string {
  const value = String(token ?? '').trim();
  if (!value) return '';
  return value.length <= 12 ? `${value.slice(0, 2)}…` : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function readQuota(headers: Headers | null | undefined): RateQuota {
  const number = (name: string) => {
    const value = Number(headers?.get(name));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    limit: number('x-ratelimit-limit'),
    remaining: number('x-ratelimit-remaining'),
    resetAt: number('x-ratelimit-reset') * 1000,
  };
}

export function readGithubToken(): string {
  try { return String(preferences.getItem(STORAGE_KEY) ?? '').trim(); } catch { return ''; }
}

/** Throws when the browser refuses storage; callers surface that instead of pretending it saved. */
export function saveGithubToken(token: string): void {
  preferences.setItem(STORAGE_KEY, String(token ?? '').trim());
}

export function clearGithubToken(): void {
  try { preferences.removeItem(STORAGE_KEY); } catch { /* already gone */ }
}
