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
