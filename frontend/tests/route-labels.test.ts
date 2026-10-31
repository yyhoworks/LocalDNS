import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/core/context.js', () => ({ $: vi.fn() }));
import { overviewInsightsService } from '../src/features/overview/insights.js';
import { upstreamErrorReasonName } from '../src/features/upstreams/errors.js';

describe('FJHAI display translations', () => {
  it.each([
    ['geosite_cn_unverified_noreply', '国内规则待验证·国外无回应'],
    ['unknown_fakeip_upstream_error', '未知域名 FakeIP·上游出错'],
    ['zone_check', '同站复核（后台）'], ['blocked_aaaa', 'IPv6 屏蔽'],
    ['foreign_domestic_fallback', '国外解析·国内兜底'],
  ])('translates %s without changing the stored code', (code, label) => {
    expect(overviewInsightsService.label(code)).toBe(label);
    expect(overviewInsightsService.distribution([{ key: code, count: 1 }]).all[0]).toMatchObject({ key: code, label });
  });
  it('preserves unknown codes and suffixes for diagnosis', () => {
    expect(overviewInsightsService.label('future_branch')).toBe('future_branch');
    expect(overviewInsightsService.label('geosite_cn_new_suffix')).toBe('国内规则命中·new_suffix');
  });
  it.each([['timeout','超时'], ['eof_reset','连接中断'], ['dial_connect','连接失败'], ['protocol','回答格式错误']])(
    'translates the upstream error %s', (code, label) => expect(upstreamErrorReasonName(code)).toBe(label));
});
