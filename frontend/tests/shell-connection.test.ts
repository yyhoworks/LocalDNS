// @vitest-environment jsdom
// 回归：概览去重删掉「已连接」徽章后，connection() 不能再直接写它的 textContent。
// 原实现 `$('.service-connection',health).textContent = …` 在元素缺失时抛
// "Cannot set properties of null (setting 'textContent')"；该异常发生在 apply()
// 里 overview() 之前，会把整条渲染增强链截断——KPI 卡因此拿不到 .console-kpi，
// 图标失去尺寸约束而撑满整张卡片。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/overview/traffic/client.js', () => ({ trafficClientService: { mount: vi.fn() } }));
vi.mock('../src/features/identity/index.js', () => ({ identityService: null }));
vi.mock('../src/core/security/safe-dom.ts', () => ({
  setHTML: (element: Element, html: string) => { element.innerHTML = html; },
  insertHTML: (element: Element, position: string, html: string) => {
    if (position === 'afterbegin') element.insertAdjacentHTML('afterbegin', html);
  },
}));
vi.mock('../src/core/persistence/preferences.ts', () => ({
  sessionPreferences: { getItem: () => null, setItem: () => {} },
}));

import { initialize, shellInterfaceService } from '../src/features/shell/interface.js';

// connection() 在缺少 #connection-status 时会提前返回，所以这里必须带上它，
// 否则测不到 .console-service-health 那一段。
const shell = (extra = '') => `
  <div id="connection-status">
    <span class="console-connection-text"></span>
    <small></small>
  </div>
  <div class="console-service-health">
    <h2 id="service-summary-title"></h2>
    ${extra}
    <span data-service-check></span>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = '';
  initialize();
});

describe('shell 连接状态', () => {
  it('概览没有「已连接」徽章时仍能更新服务状态，不抛异常', () => {
    document.body.innerHTML = shell();
    expect(() => shellInterfaceService.connection(true)).not.toThrow();
    expect(document.querySelector('#service-summary-title')!.textContent).toBe('DNS 服务运行中');
    expect(document.querySelector('[data-service-check]')!.getAttribute('d')).toBe('m7 12 3 3 7-7');
  });

  it('徽章存在时仍然同步它的文案', () => {
    document.body.innerHTML = shell('<span class="service-connection"></span>');
    expect(() => shellInterfaceService.connection(false)).not.toThrow();
    expect(document.querySelector('.service-connection')!.textContent).toBe('已断开');
    expect(document.querySelector('#service-summary-title')!.textContent).toBe('DNS 服务连接已断开');
  });
});
