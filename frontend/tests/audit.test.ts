// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/core/api/api-error';
import { auditDirectory, auditStorage, readAuditStorage } from '../src/features/logs/audit-settings';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), json: vi.fn(), status: vi.fn(), capacity: vi.fn(),
  render: vi.fn(), signal: new AbortController().signal,
}));
vi.mock('../src/core/context.js', () => ({
  $: (selector: string, root = document) => root.querySelector(selector),
  $$: (selector: string, root = document) => [...root.querySelectorAll(selector)],
}));
vi.mock('../src/core/router/route-lifetime', () => ({ currentScope: () => ({ signal: mocks.signal }) }));
vi.mock('../src/core/api/api.js', () => ({ api: mocks }));
vi.mock('../src/core/router/router.js', () => ({ renderRoute: mocks.render }));
vi.mock('../src/shared/components/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/shared/components/dialog.js', () => ({
  modalOpen: (_title: string, _subtitle: string, html: string) => {
    document.querySelector('#modal-content')!.innerHTML = html;
    document.querySelector('#modal')!.setAttribute('open', '');
  },
  modalClose: () => {
    const dialog = document.querySelector('#modal')!;
    dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close'));
  },
}));
vi.mock('../src/core/security/safe-dom.ts', () => ({ setHTML: (element: Element, html: string) => { element.innerHTML = html; } }));
import { openAuditModal } from '../src/features/logs/audit.js';

const initial = { capacity: 100000, dir: 'logs', path: '/opt/localdns/logs', memory_fs: false, entries: 2200, memory_bytes: 256000, disk_bytes: 2018 };
const field = () => document.querySelector<HTMLInputElement>('#audit-dir')!;
const save = () => document.querySelector<HTMLButtonElement>('#audit-dir-save')!;
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<dialog id="modal"><div id="modal-content"></div></dialog>';
  mocks.status.mockResolvedValue({ capturing: true });
  mocks.capacity.mockResolvedValue({ capacity: 100000 });
  mocks.request.mockResolvedValue(initial);
  mocks.json.mockResolvedValue({ ...initial, dir: '/var/log/localdns', path: '/var/log/localdns', entries: 0 });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('audit storage compatibility', () => {
  it('identifies an unsupported core without swallowing network, permission, or malformed-response failures', async () => {
    expect(await readAuditStorage(async () => { throw new ApiError('missing', 404); })).toBeNull();
    for (const error of [new ApiError('offline', 0), new ApiError('denied', 403)]) {
      await expect(readAuditStorage(async () => { throw error; })).rejects.toBe(error);
    }
    await expect(readAuditStorage(async () => ({ ...initial, path: null }))).rejects.toMatchObject({ code: 'contract' });
  });
  it('accepts Linux relative and absolute directories and rejects accidentally pasted Windows paths and control characters', () => {
    expect(auditDirectory(' /var/log/localdns ')).toBe('/var/log/localdns');
    expect(auditDirectory('logs')).toBe('logs');
    for (const value of ['', 'C:\\logs', 'https://example.com/logs', '/var/log/\nlocaldns']) expect(() => auditDirectory(value)).toThrow();
  });
});

describe('audit directory dialog', () => {
  it('requires confirmation for clearing current records and preserves the draft when cancelled or rejected', async () => {
    await openAuditModal();
    field().value = '/var/log/localdns';
    vi.mocked(confirm).mockReturnValueOnce(false);
    save().click(); await settle();
    expect(mocks.json).not.toHaveBeenCalled();
    expect(field().value).toBe('/var/log/localdns');
    mocks.json.mockRejectedValueOnce(new ApiError('目录不可写', 400));
    save().click(); await settle();
    expect(field().value).toBe('/var/log/localdns');
    expect(save().disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('目录不可写');
    expect(document.querySelector('#audit-storage-details')!.textContent).toContain('/opt/localdns/logs');
  });
  it('prevents duplicate submissions, shows the server path and permits another save in the same dialog', async () => {
    await openAuditModal();
    let resolve!: (value: unknown) => void;
    mocks.json.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    field().value = '/var/log/localdns';
    save().click(); save().click();
    expect(mocks.json).toHaveBeenCalledTimes(1);
    expect(save().disabled).toBe(true);
    resolve({ ...initial, dir: '/var/log/localdns', path: '/var/log/localdns', entries: 0 });
    await settle();
    expect(document.querySelector('#audit-storage-details')!.textContent).toContain('/var/log/localdns');
    expect(document.querySelector('#modal')!.hasAttribute('open')).toBe(true);
    expect(mocks.render).not.toHaveBeenCalled();
    field().value = 'logs';
    mocks.json.mockResolvedValueOnce(initial);
    save().click(); await settle();
    expect(mocks.json).toHaveBeenLastCalledWith('/api/v1/audit/settings', 'POST', { dir: 'logs' });
    expect(field().value).toBe('logs');
  });
  it('accepts an optional persist flag and rejects a malformed one', () => {
    expect(auditStorage({ ...initial, persist: false }).persist).toBe(false);
    expect(auditStorage({ ...initial }).persist).toBeUndefined();
    expect(() => auditStorage({ ...initial, persist: 'yes' })).toThrow(/存盘/);
  });
  it('keeps capacity and audit controls available when storage reads fail', async () => {
    mocks.request.mockRejectedValueOnce(new ApiError('timeout', 0));
    await openAuditModal();
    expect(document.querySelector('#audit-storage-retry')).not.toBeNull();
    expect(document.querySelector('#audit-cap-save')).not.toBeNull();
    expect(document.querySelector('#modal-audit-toggle')).not.toBeNull();
    expect(document.querySelector('#audit-dir-save')).toBeNull();
  });
});

describe('audit persist switch', () => {
  const toggle = () => document.querySelector<HTMLInputElement>('#audit-persist')!;
  const flip = (checked: boolean) => { toggle().checked = checked; toggle().dispatchEvent(new Event('change')); };

  it('hides the switch on cores that do not report persist', async () => {
    await openAuditModal();
    expect(document.querySelector('#audit-persist')).toBeNull();
    expect(document.querySelector('#audit-persist-help')).toBeNull();
  });

  it('mirrors the kernel value and posts the new one', async () => {
    mocks.request.mockResolvedValue({ ...initial, persist: true });
    await openAuditModal();
    expect(toggle().checked).toBe(true);
    mocks.json.mockResolvedValueOnce({ ...initial, persist: false });
    flip(false);
    await settle();
    expect(mocks.json).toHaveBeenLastCalledWith('/api/v1/audit/settings', 'POST', { persist: false });
    expect(toggle().checked).toBe(false);
    expect(document.querySelector('#audit-settings-feedback')!.textContent).toContain('已关闭记录存盘');
    expect(document.querySelector('#modal')!.hasAttribute('open')).toBe(true);
  });

  it('reverts the checkbox and keeps the dialog open when the kernel rejects the change', async () => {
    mocks.request.mockResolvedValue({ ...initial, persist: false });
    await openAuditModal();
    expect(toggle().checked).toBe(false);
    mocks.json.mockRejectedValueOnce(new ApiError('存盘不可用', 400));
    flip(true);
    await settle();
    expect(toggle().checked).toBe(false);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('存盘不可用');
    expect(document.querySelector('#modal')!.hasAttribute('open')).toBe(true);
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
