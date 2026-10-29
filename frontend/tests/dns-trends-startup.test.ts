// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginRoute, currentScope } from '../src/core/router/route-lifetime';
import { initialize as initializeModel } from '../src/features/overview/traffic/model.js';
import { initialize as initializeClient, trafficClientService } from '../src/features/overview/traffic/client.js';

const fake = vi.hoisted(() => ({ load:vi.fn(), save:vi.fn(), fetch:vi.fn() }));
vi.mock('../src/features/overview/traffic/repository', () => ({ trafficRepository: { load:fake.load, save:fake.save } }));
vi.mock('../src/core/api/network.ts', () => ({ assetHttp: { fetch:fake.fetch } }));

describe('DNS trend sampling is independent of browser storage', () => {
  let count = 0;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1792459200000); beginRoute(); initializeModel(); count = 0;
    fake.load.mockReset().mockResolvedValue([]); fake.save.mockReset().mockResolvedValue(undefined);
    fake.fetch.mockReset().mockImplementation(async () => {
      // The latency view plots real upstream deltas, so the fixture has to
      // expose the upstream sum/count pair the core exports.
      const n = count++;
      return new Response(
        'process_start_time_seconds 1\n' +
        `localdns_queries_total ${100 + n * 10}\n` +
        `localdns_upstream_response_latency_millisecond_sum{tag="a"} ${n * 50}\n` +
        `localdns_upstream_response_latency_millisecond_count{tag="a"} ${n * 5}\n`,
      );
    });
    document.body.innerHTML = '<div class="traffic-chart-body"></div>';
  });
  afterEach(() => { currentScope().dispose(); vi.useRealTimers(); document.body.innerHTML = ''; });

  it('collects a usable interval while history loading is still pending', async () => {
    let release!: (value: unknown[]) => void;
    fake.load.mockReturnValue(new Promise(resolve => { release = resolve; }));
    initializeClient(); trafficClientService.mount(document.querySelector('.traffic-chart-body'), 60);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.fetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(2100);
      expect(document.querySelector('.traffic-chart')).not.toBeNull();
    } finally { release([]); await trafficClientService.ready; }
    expect(document.querySelector('.traffic-chart')).not.toBeNull();
  });

  it('suppresses interval latency for pre-p50 history rows but keeps request totals', async () => {
    // Rows persisted before the p50 schema carry upstreams but no latencyNow
    // key at all; FJH21-era rows saved today still look like this.
    fake.fetch.mockRejectedValue(new Error('offline'));
    fake.load.mockResolvedValue([
      {time: 1792459190000, total: 80, start: 1, cacheQueries: null, cacheHits: null, upstreams: [['{"tag":"a"}', 100, 10]]},
      {time: 1792459195000, total: 90, start: 1, cacheQueries: null, cacheHits: null, upstreams: [['{"tag":"a"}', 150, 15]]},
    ]);
    initializeClient(); trafficClientService.mount(document.querySelector('.traffic-chart-body'), 60);
    await vi.advanceTimersByTimeAsync(2100);
    expect(document.querySelector('.console-chart-empty')).not.toBeNull();
    expect(document.querySelector('.traffic-chart')).toBeNull();
    document.querySelector<HTMLElement>('[data-traffic-metric="qps"]')!.click();
    expect(document.querySelector('.traffic-chart')).not.toBeNull();
    expect(document.querySelector('.traffic-bar')).not.toBeNull();
  });

  it('keeps the five-second poll running while a previous write is pending', async () => {
    let release!: () => void;
    fake.save.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    initializeClient(); trafficClientService.mount(document.querySelector('.traffic-chart-body'), 60);
    try {
      await vi.advanceTimersByTimeAsync(5100);
      expect(fake.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(document.querySelector('.traffic-chart')).not.toBeNull();
    } finally { release(); }
  });

  it('starts before the overview finishes rendering and paints collected data on mount', async () => {
    document.body.innerHTML = '';
    initializeClient(); trafficClientService.start();
    await vi.advanceTimersByTimeAsync(2100);
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    document.body.innerHTML = '<div class="traffic-chart-body"></div>';
    trafficClientService.mount(document.querySelector('.traffic-chart-body'),60);
    expect(document.querySelector('.traffic-chart')).not.toBeNull();
    expect(fake.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not skip the regular poll after the startup sample', async () => {
    initializeClient(); trafficClientService.start();
    await vi.advanceTimersByTimeAsync(2100);
    expect(fake.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.fetch).toHaveBeenCalledTimes(4);
    currentScope().dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fake.fetch).toHaveBeenCalledTimes(4);
  });
});
