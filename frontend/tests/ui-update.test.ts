import { describe, expect, it, vi } from 'vitest';
import { UIUpdateClient, upgradeTarget } from '../src/features/version/ui-update-client';

const installed = { uiVersion: '2026.10.19.8', backendVersion: 'FJGAC' };
const release = { tag: 'fjgac-ui-v2026.10.19.9', version: '2026.10.19.9', backend: 'FJGAC', packages: ['UI 升级包'] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('UI upgrade eligibility', () => {
  it('requires a newer UI of the same core and a real update package', () => {
    expect(upgradeTarget(installed, release).tag).toBe(release.tag);
    expect(upgradeTarget({ ...installed, uiVersion: '2026.10.19.10-local' }, release).tag).toBeUndefined();
    expect(upgradeTarget(installed, { ...release, backend: 'FJGAD' }).tag).toBeUndefined();
    expect(upgradeTarget(installed, { ...release, packages: [] }).tag).toBeUndefined();
    expect(upgradeTarget(installed, { ...release, tag: 'https://evil.example' }).tag).toBeUndefined();
  });
});

describe('UI update requests', () => {
  it('submits fixed operations directly without credentials or a session', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS', requiresAuth: false }))
      .mockResolvedValueOnce(json({ state: 'idle', canRollback: false }))
      .mockResolvedValueOnce(json({ state: 'queued', jobId: 'test-job', canRollback: false }, 202))
      .mockResolvedValueOnce(json({ state: 'queued', canRollback: true }, 202));
    const client = new UIUpdateClient('http://dns.example:9100', 'http://dns.example:9099/ui/', fetcher);
    await client.discover();
    expect((await client.status()).state).toBe('idle');
    expect((await client.upgrade(release.tag)).state).toBe('queued');
    expect((await client.rollback()).state).toBe('queued');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://dns.example:9100/upgrade/ui', 'http://dns.example:9100/upgrade/ui/status',
      'http://dns.example:9100/upgrade/ui', 'http://dns.example:9100/upgrade/ui/rollback',
    ]);
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'POST', credentials: 'omit', body: JSON.stringify({ releaseTag: release.tag }) });
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: 'POST', body: '{}' });
    for (const [, request] of fetcher.mock.calls) expect(request?.headers).not.toHaveProperty('Authorization');
  });
  it('supports a same-origin reverse proxy and refuses insecure or executable addresses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS' }));
    await new UIUpdateClient('/_updater', 'https://dns.example/ui/', fetcher).discover();
    expect(fetcher.mock.calls[0][0]).toBe('https://dns.example/_updater/upgrade/ui');
    for (const address of ['javascript:alert(1)', 'https://password@dns.example', 'http://dns.example:9100']) {
      expect(() => new UIUpdateClient(address, 'https://dns.example/ui/')).toThrow();
    }
  });
  it('rejects HTML fallbacks and malformed success responses', async () => {
    const wrong = vi.fn<typeof fetch>().mockImplementation(async () => json({ ok: true }));
    const client = new UIUpdateClient('', 'http://dns.example/ui/', wrong);
    await expect(client.discover()).rejects.toThrow('兼容');
    await expect(client.status()).rejects.toThrow('状态无效');
  });
});
