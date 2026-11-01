import { describe, expect, it } from 'vitest';
import { releaseRetryAt } from '../src/features/version/release-backoff';

describe('GitHub release cooldown', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('honors the longer retry-after and rate-limit reset', () => {
    expect(releaseRetryAt(new Headers({ 'Retry-After': '120', 'X-RateLimit-Reset': String(now / 1000 + 3600) }), now)).toBe(now + 3600000);
    expect(releaseRetryAt(new Headers({ 'Retry-After': '7200', 'X-RateLimit-Reset': String(now / 1000 + 3600) }), now)).toBe(now + 7200000);
  });
  it('accepts an HTTP date and waits at least a minute for missing or bad headers', () => {
    expect(releaseRetryAt(new Headers({ 'Retry-After': 'Sun, 01 Nov 2026 12:05:00 GMT' }), now)).toBe(now + 300000);
    const examples: Record<string, string>[] = [{}, { 'Retry-After': 'bad', 'X-RateLimit-Reset': 'NaN' }, { 'Retry-After': '0', 'X-RateLimit-Reset': '1' }];
    for (const headers of examples) {
      expect(releaseRetryAt(new Headers(headers), now)).toBe(now + 60000);
    }
  });
});
