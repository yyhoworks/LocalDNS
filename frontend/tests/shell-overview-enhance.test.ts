// @vitest-environment jsdom
// 概览页的渲染增强链（shell/interface.js 的 apply → overview）集成测试。
// 覆盖两类曾经真实发生的问题：
//  1. connection() 写已删除的 .service-connection，抛错截断整条链；
//  2. 时间范围控件用 head.lastElementChild 取元素，实际拿到的是标题，
//     把 .gc-title 改名成 .console-range，卡片标题因此消失。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/overview/traffic/client.js', () => ({ trafficClientService: { mount: vi.fn() } }));
vi.mock('../src/features/identity/index.js', () => ({ identityService: null }));
vi.mock('../src/core/security/safe-dom.ts', () => ({
  setHTML: (element: Element, html: string) => { element.innerHTML = html; },
  insertHTML: (element: Element, position: string, html: string) => {
    if (position === 'afterbegin') element.insertAdjacentHTML('afterbegin', html);
    else if (position === 'beforeend') element.insertAdjacentHTML('beforeend', html);
  },
}));
vi.mock('../src/core/persistence/preferences.ts', () => ({
  sessionPreferences: { getItem: () => null, setItem: () => {} },
}));

import { initialize, shellInterfaceService } from '../src/features/shell/interface.js';

const kpi = (title: string) => `
  <div class="col-2">
    <div class="glass-card spark-kpi-card">
      <div class="sk-top"><span class="sk-title">${title}</span><svg viewBox="0 0 24 24"></svg></div>
      <div class="sk-bottom"><div class="sk-val">1,234</div><svg class="sk-chart" viewBox="0 0 100 34"></svg></div>
      <div class="sk-note">备注</div>
    </div>
  </div>`;

const page = () => `
  <div class="view-title-row" data-shortcuts-summary="当前策略：指定 FakeIP">
    <div><h1>概览</h1></div>
  </div>
  <div class="console-service-summary">
    <div class="console-service-health">
      <h2 id="service-summary-title"></h2>
      <span data-service-check></span>
    </div>
  </div>
  <div class="col-12"><div class="glass-card"><div class="control-bar-card">运行中</div></div></div>
  ${kpi('累计请求')}${kpi('缓存命中')}${kpi('客户端数')}${kpi('AdGuard 拦截')}${kpi('平均响应')}${kpi('域名统计')}
  <div class="col-8">
    <div class="glass-card">
      <div class="gc-head"><div class="gc-title">服务运行体征与查询吞吐监控</div></div>
      <div class="traffic-chart-body"></div>
    </div>
  </div>
  <div class="col-4">
    <div class="glass-card">
      <div class="topology-glass-card"><div class="t-node" data-node-id="e_core"><div class="tn-name">核心</div></div></div>
    </div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = '<div id="page-content"></div>';
  document.querySelector('#page-content')!.innerHTML = page();
  // jsdom 没有 ResizeObserver
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  initialize();
});

describe('概览渲染增强', () => {
  it('跑完增强链后 KPI 卡拿到 .console-kpi，图标尺寸规则才会生效', () => {
    expect(() => shellInterfaceService.apply()).not.toThrow();
    expect(document.querySelectorAll('.console-kpi')).toHaveLength(6);
  });

  it('趋势卡保留标题，时间范围按钮放进独立容器', () => {
    shellInterfaceService.apply();

    const title = document.querySelector('.col-8 .gc-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('响应延迟与解析异常');

    const range = document.querySelector('.col-8 .console-range');
    expect(range).not.toBeNull();
    expect(range).not.toBe(title);
    expect(range!.querySelectorAll('[data-chart-range]')).toHaveLength(4);
    expect(document.querySelector('.col-8')!.classList.contains('console-trend')).toBe(true);
  });

  it('重复渲染不会叠加出多个时间范围容器', () => {
    shellInterfaceService.apply();
    shellInterfaceService.apply();
    expect(document.querySelectorAll('.col-8 .console-range')).toHaveLength(1);
    expect(document.querySelectorAll('.col-8 .gc-title')).toHaveLength(1);
  });
});
