// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/core/api/api-error';
import { parseFeatures } from '../src/core/api/backend-client';
import { readFeatureSwitches } from '../src/features/management/features';
import { groupedFeatures } from '../src/features/management/layout.js';
import { withProvider, providerOptions } from '../src/features/upstreams/providers';

const features = { request_blocking: true, block_special_qtypes: true, adguard: false,
  block_aaaa: false, full_cache: true, route_cache: true, client_policy: 'normal' };

describe('FJN8C capabilities', () => {
  it('shows prefetch only when the core returns its boolean capability', async () => {
    const old = await readFeatureSwitches(async () => features);
    expect(old.profiles).toHaveLength(8);
    const current = await readFeatureSwitches(async () => ({ ...features, prefetch: false }));
    expect(current.profiles).toHaveLength(9);
    expect(current.status.prefetch).toBe('B');
    const root = document.createElement('div');
    root.innerHTML = groupedFeatures(current.profiles, current.status);
    const prefetch = root.querySelector('[data-switch="prefetch"]');
    expect(prefetch?.closest('section')?.textContent).toContain('缓存策略');
    expect(root.querySelector('[data-switch="switch2"]')?.closest('section')?.textContent).toContain('客户端分流');
  });

  it('keeps failed capability reads unknown and rejects malformed known values', async () => {
    expect(() => parseFeatures({ ...features, prefetch: 'false' })).toThrow('缓存预取');
    const failed = await readFeatureSwitches(async () => { throw new Error('offline'); });
    expect(failed.status.prefetch).toBeUndefined();
    const root = document.createElement('div');
    root.innerHTML = groupedFeatures(failed.profiles, failed.status);
    expect(root.querySelector<HTMLInputElement>('[data-switch="prefetch"]')?.disabled).toBe(true);
    expect(root.textContent).toContain('读取失败');
  });

  it('reads legacy switches without requesting an unsupported prefetch plugin', async () => {
    const paths: string[] = [];
    const state = await readFeatureSwitches(async path => {
      paths.push(path);
      if (path === '/api/v1/features') throw new ApiError('missing', 404);
      return 'A';
    });
    expect(state.profiles).toHaveLength(8);
    expect(paths.some(path => path.includes('prefetch'))).toBe(false);
  });

  it('retains custom provider and unknown fields without mutating the source node', () => {
    const node = { tag: 'node', provider: '旧名称', future: { keep: true }, dial_addr: '192.0.2.1' };
    const saved = withProvider(node, 'foreign', '  自定义服务商  ', true);
    expect(saved).toEqual({ ...node, provider: '自定义服务商' });
    expect(node.provider).toBe('旧名称');
    expect(() => withProvider(node, 'foreign', '  ', true)).toThrow('服务商');
    expect(withProvider(node, 'proxy', '', true)).toBe(node);
    const old = { tag: 'old', addr: '192.0.2.53' };
    expect(withProvider(old, 'domestic', '电信', false)).toEqual(old);
    expect(providerOptions('proxy')).toHaveLength(0);
  });
});
