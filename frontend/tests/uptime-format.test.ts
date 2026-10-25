import { describe, expect, it } from 'vitest';
import { overviewUptimeMarkup } from '../src/shared/format/number.js';

// Read the rendered text back without depending on the markup shape: the
// number and its unit are separate spans, so strip tags and collapse the gaps.
const text = (seconds: number) =>
  overviewUptimeMarkup(seconds).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('overview uptime rolls hours into days', () => {
  it('switches to days at 24 hours instead of growing the hour count', () => {
    expect(text(23 * 3600 + 59 * 60)).toBe('23 小时 59 分钟');
    expect(text(24 * 3600)).toBe('1 天 0 小时');
    expect(text(46 * 3600 + 49 * 60)).toBe('1 天 22 小时');
  });

  it('keeps only the two most significant units', () => {
    expect(text(90 * 3600)).toBe('3 天 18 小时');
    expect(text(12 * 3600 + 21 * 60)).toBe('12 小时 21 分钟');
    expect(text(90)).toBe('1 分钟');
    expect(text(0)).toBe('0 秒');
  });

  it('never prints an hour count of 24 or more', () => {
    for (const seconds of [86400, 172799, 168540, 259200, 864000]) {
      const hours = Number(/(\d+) 小时/.exec(text(seconds))?.[1] ?? 0);
      expect(hours).toBeLessThan(24);
    }
  });

  it('treats missing or negative input as zero', () => {
    expect(text(Number.NaN)).toBe('0 秒');
    expect(text(-120)).toBe('0 秒');
  });
});
