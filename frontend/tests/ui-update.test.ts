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
  it('pins a target tag, keeps credentials in memory and clears expired authorization', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS' }))
      .mockResolvedValueOnce(json({ token: 'test-session' }))
      .mockResolvedValueOnce(json({ state: 'queued', jobId: 'test-job', canRollback: false }, 202))
      .mockResolvedValueOnce(json({ error: 'expired' }, 401));
    const client = new UIUpdateClient('http://dns.example:9100', 'http://dns.example:9099/ui/', fetcher);
    await client.discover(); await client.login('test-password');
    expect((await client.upgrade(release.tag)).state).toBe('queued');
    const [url, request] = fetcher.mock.calls[2];
    expect(url).toBe('http://dns.example:9100/upgrade/ui');
    expect(request).toMatchObject({ method: 'POST', credentials: 'omit', body: JSON.stringify({ releaseTag: release.tag }), headers: { Authorization: 'Bearer test-session' } });
    await expect(client.status()).rejects.toMatchObject({ status: 401 });
    expect(client.authorized).toBe(false);
    expect(new UIUpdateClient('', 'http://dns.example:9099/ui/', fetcher).authorized).toBe(false);
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
