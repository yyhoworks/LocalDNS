// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/core/api/api-error';
import { UIUpdateClient } from '../src/features/version/ui-update-client';
import { createUIUpdatePanel } from '../src/features/version/ui-update-panel';
vi.mock('../src/shared/components/dialog.js', () => ({ confirmDialog: vi.fn() }));

const installed = { uiVersion: '2026.11.01.6', backendVersion: 'FJMOS' };
const release = { tag: 'fjmos-ui-v2026.11.1.6', version: '2026.11.1.6', backend: 'FJMOS', packages: ['UI 升级包', '含核心完整包'] };
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function panel() {
  const container = document.createElement('section'); document.body.append(container);
  const instance = createUIUpdatePanel(container); instance.setRelease(installed, release);
  return { container, ...instance };
}
describe('upgrade panel recovery', () => {
  it('explains a missing endpoint and hides an already current UI even without a service', async () => {
    vi.spyOn(UIUpdateClient.prototype, 'discover').mockRejectedValue(new ApiError('HTTP 404', 404, null));
    const { container, connect } = panel(); await connect();
    expect(container.querySelector<HTMLElement>('[data-mode="ui"]')!.hidden).toBe(true);
    expect(container.querySelector('[data-connection]')!.textContent).toContain('uiUpdaterBase');
    expect(container.querySelector('[data-mode="core"] [data-reason]')!.textContent).toContain('仅替换 UI');
    for (const button of container.querySelectorAll<HTMLButtonElement>('[data-start]')) expect(button.disabled).toBe(true);
    expect(container.querySelector('[data-start="full"]')!.classList.contains('primary')).toBe(false);
  });
  it('rediscovers capabilities after the server service is upgraded', async () => {
    let upgraded = false;
    const discover = vi.spyOn(UIUpdateClient.prototype, 'discover').mockImplementation(async function(this: UIUpdateClient) {
      this.capabilities = { protocol: 'localdns-updater/v2', modes: ['ui', 'core', 'full'], installed,
        ...(upgraded ? { coreUpload: { format: 'upstream-zip' as const, maxBytes: 256 * 1048576, architecture: 'amd64-v3' } } : {}) };
    });
    vi.spyOn(UIUpdateClient.prototype, 'status').mockResolvedValue({ state: 'idle', canRollback: false });
    const { container, connect } = panel(); await connect();
    const input = container.querySelector<HTMLInputElement>('[data-core-file]')!;
    expect(input.disabled).toBe(true);
    upgraded = true; await connect();
    expect(discover).toHaveBeenCalledTimes(2); expect(input.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-start="core"]')!.disabled).toBe(true);
    expect(container.querySelector('[data-mode="core"] [data-reason]')!.textContent).toContain('先选择');
  });
});

describe('upgrade panel primary action', () => {
  const next = { tag: 'fjmos-ui-v2026.11.01.8', version: '2026.11.01.8', backend: 'FJMOS', packages: ['UI 升级包'] };
  const full = { ...next, packages: ['UI 升级包', '含核心完整包'] };
  const ready = {
    protocol: 'localdns-updater/v2' as const, modes: ['ui', 'core', 'full'] as const, installed,
    coreUpload: { format: 'upstream-zip' as const, maxBytes: 256 * 1048576, architecture: 'amd64-v3' },
  };

  async function mount(releaseValue: typeof next) {
    vi.spyOn(UIUpdateClient.prototype, 'discover').mockImplementation(async function(this: UIUpdateClient) {
      this.capabilities = { ...ready, modes: [...ready.modes] };
    });
    vi.spyOn(UIUpdateClient.prototype, 'status').mockResolvedValue({ state: 'idle', canRollback: false });
    const container = document.createElement('section'); document.body.append(container);
    const instance = createUIUpdatePanel(container); instance.setRelease(installed, releaseValue);
    await instance.connect();
    const start = (mode: string) => container.querySelector<HTMLButtonElement>(`[data-start="${mode}"]`)!;
    return { container, start, picker: container.querySelector<HTMLElement>('[data-core-picker]')! };
  }

  it('keeps the release version label zero-padded', async () => {
    const { container } = await mount(next);
    expect(container.querySelector('[data-mode="ui"] [data-target]')!.textContent).toBe('2026.11.01.6 → 2026.11.01.8');
  });

  it('highlights the UI upgrade when only the UI has a newer release', async () => {
    const { start, picker } = await mount(next);
    expect(start('ui').classList.contains('primary')).toBe(true);
    expect(start('full').classList.contains('primary')).toBe(false);
    expect(picker.classList.contains('primary')).toBe(false);
    expect(start('ui').disabled).toBe(false);
  });

  it('highlights the combined upgrade when the release ships a full package', async () => {
    const { start } = await mount(full);
    expect(start('full').classList.contains('primary')).toBe(true);
    expect(start('ui').classList.contains('primary')).toBe(false);
    expect(start('full').disabled).toBe(false);
  });

  it('moves the highlight to the file picker once a kernel ZIP is selected', async () => {
    const { container, start, picker } = await mount(full);
    const input = container.querySelector<HTMLInputElement>('[data-core-file]')!;
    Object.defineProperty(input, 'files', { value: [new File(['zip'], 'LocalDNS_FJMOS.zip', { type: 'application/zip' })], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(picker.classList.contains('primary')).toBe(true);
    expect(picker.textContent).toContain('更换内核 ZIP');
    expect(start('core').disabled).toBe(false);
    expect(start('core').classList.contains('primary')).toBe(false);
    expect(start('ui').classList.contains('primary')).toBe(false);
    expect(start('full').classList.contains('primary')).toBe(false);
    expect(container.querySelector('[data-mode="core"] [data-pill]')!.textContent).toBe('已选择 ZIP');
  });
});
