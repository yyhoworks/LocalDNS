import { describe, expect, it, vi } from 'vitest';
import { parseProm } from '../src/shared/metrics/prometheus';
import { readUpstreams } from '../src/features/upstreams/api.js';
import { upstreamMetrics } from '../src/features/upstreams/errors.js';

const { request, metrics } = vi.hoisted(() => ({ request: vi.fn(), metrics: vi.fn() }));
vi.mock('../src/core/api/api.js', () => ({ api: { request, metrics } }));
vi.mock('../src/core/context.js', () => ({ $: vi.fn() }));

const labels = 'metrics_tag="domestic",tag="fixture"';
const lifetime = `localdns_upstream_error_total{${labels}} 12
localdns_upstream_success_total{${labels}} 28
localdns_upstream_upstream_error_reason_total{${labels},reason="timeout"} 12
localdns_upstream_upstream_last_error_unixtime_seconds{${labels}} 1000`;
const current = `localdns_upstream_round_errors{${labels}} 2
localdns_upstream_round_successes{${labels}} 8
localdns_upstream_round_error_reason{${labels},reason="timeout"} 2
localdns_upstream_round_error_reason{metrics_tag="foreign",tag="fixture",reason="tls"} 9
localdns_upstream_error_round_quiet_seconds 100`;

describe('FJO02 upstream support', () => {
  it.each([['FJO02', true], ['FJN8C', true], ['FJN01', false]] as const)(
    'identifies provider support on %s even without configured nodes', async (version, providers) => {
      request.mockImplementation(async path => ({
        '/api/v1/upstream/config': { domestic: [], foreign: [], foreign_ecs: [], proxy: [] },
        '/api/v1/upstream/tags': ['domestic', 'foreign', 'foreign_ecs', 'proxy'],
        '/api/v1/upstream/ecs': {},
        '/api/v1/status': { version },
      })[String(path)]);
      metrics.mockResolvedValue('');
      const result = await readUpstreams({ guard: <Value>(value: Promise<Value>) => value });
      expect(result.providers).toBe(providers);
    },
  );

  it('keeps the current round separate from process totals and from other groups', () => {
    const result = upstreamMetrics(parseProm(`${lifetime}\n${current}\nlocaldns_unixtime_seconds 1099`), 'domestic', 'fixture');
    expect(result.err).toBe(12);
    expect(result.success).toBe(70);
    expect(result.round).toMatchObject({ err: 2, success: 80, reasons: [{ reason: 'timeout', value: 2 }] });
  });

  it('uses the core clock to expire old rounds without reporting a success rate with no samples', () => {
    const result = upstreamMetrics(parseProm(`${lifetime}\n${current}\nlocaldns_unixtime_seconds 1100`), 'domestic', 'fixture');
    expect(result.round).toMatchObject({ err: 0, success: null, reasons: [] });
    expect(result.err).toBe(12);
  });

  it('does not treat a missing per-node sample as zero', () => {
    const incomplete = `localdns_upstream_round_successes{metrics_tag="domestic",tag="other"} 8`;
    const result = upstreamMetrics(parseProm(`${lifetime}\nlocaldns_upstream_round_errors{${labels}} 0\n${incomplete}`),
      'domestic', 'fixture');
    expect(result.round).toBeNull();
    expect(result.reasons).toEqual([{ reason: 'timeout', label: '超时', value: 12 }]);
  });
});
