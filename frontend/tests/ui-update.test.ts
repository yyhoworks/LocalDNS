import { describe, expect, it, vi } from 'vitest';
import { UIUpdateClient, upgradeTarget, hashBackup } from '../src/features/version/ui-update-client';

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

  it('does not block releases whose tag carries no backend prefix', () => {
    expect(upgradeTarget(installed, { ...release, backend: '' }).tag).toBe(release.tag);
  });

  it('accepts a newer release of the same FJ core whatever its third letter', () => {
    const fjh21 = { uiVersion: '2026.10.28.2', backendVersion: 'FJH21' };
    const next = { ...release, tag: 'fjh21-ui-v2026.10.29.1', version: '2026.10.29.1', backend: 'FJH21' };
    expect(upgradeTarget(fjh21, next).tag).toBe(next.tag);
    expect(upgradeTarget(fjh21, { ...next, backend: 'FJGOE' }).tag).toBeUndefined();
    expect(upgradeTarget(fjh21, { ...next, tag: 'xjh21-ui-v2026.10.29.1' }).tag).toBeUndefined();
  });
});

describe('UI update requests', () => {
  it('uses independent versions and three operations with the unified service', async () => {
    const next = { ...release, backend: 'FJHAI', tag: 'fjhai-ui-v2026.10.19.9', packages: ['UI 升级包', '含核心完整包'] };
    expect(upgradeTarget(installed, next, { mode: 'ui', unified: true }).tag).toBe(next.tag);
    expect(upgradeTarget(installed, next, { mode: 'core', unified: true }).tag).toBe(next.tag);
    expect(upgradeTarget({ ...installed, backendVersion: 'FJHAI' }, next, { mode: 'core', unified: true }).tag).toBeUndefined();
    expect(upgradeTarget({ ...installed, uiVersion: next.version }, next, { mode: 'full', unified: true }).tag).toBe(next.tag);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ state: 'awaiting_backup', canRollback: false }));
    fetcher.mockResolvedValueOnce(json({ protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS', capabilities: { protocol: 'localdns-updater/v2', modes: ['ui', 'core', 'full'], installed } }));
    const client = new UIUpdateClient('http://dns.example:9100', 'http://dns.example:9099/ui/', fetcher);
    await client.discover(); expect(client.unified).toBe(true);
    await client.upgrade(next.tag, 'core'); await client.continue('a'.repeat(24), 'b'.repeat(64)); await client.cancel('a'.repeat(24));
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ releaseTag: next.tag, mode: 'core' }));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['http://dns.example:9100/upgrade/ui', 'http://dns.example:9100/upgrade', 'http://dns.example:9100/upgrade/continue', 'http://dns.example:9100/upgrade/cancel']);
  });
  it('hashes backup files in chunks on plain HTTP without WebCrypto', async () => {
    expect(await hashBackup(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const progress: number[] = [];
    const large = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]);
    const digest = await hashBackup(large, value => progress.push(value));
    expect(progress).toHaveLength(3); expect(progress.at(-1)).toBe(100);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(large));
    const client = new UIUpdateClient('http://dns.example:9100', 'http://dns.example:9099/ui/', fetcher);
    const task = { state: 'awaiting_backup' as const, canRollback: false, jobId: 'a'.repeat(24), backup: { name: 'backup.tar.gz', sha256: digest, bytes: large.size } };
    expect((await client.download(task)).size).toBe(large.size);
    await expect(client.download({ ...task, backup: { ...task.backup, sha256: '0'.repeat(64) } })).rejects.toThrow('摘要不一致');
  });
  it('submits fixed operations directly without credentials or a session', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ protocol: 'localdns-ui-updater/v1', repository: 'https://github.com/yyhoworks/LocalDNS' }))
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
