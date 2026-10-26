// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appName, focusPageHeading, setPageLabel, syncDocumentTitle } from '../src/core/router/page-title.js';

type ToastModule = typeof import('../src/shared/components/toast.js');
let toastModule: ToastModule;

beforeAll(async () => {
  // context.js reads matchMedia and the static shell at import time.
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = '<main id="page-content"></main><div id="toast-stack" aria-live="polite"></div>';
  toastModule = await import('../src/shared/components/toast.js');
});

describe('toasts', () => {
  beforeEach(() => { vi.useFakeTimers(); document.getElementById('toast-stack')!.replaceChildren(); });
  afterEach(() => vi.useRealTimers());

  it('announces errors as alerts, keeps them until closed and offers a close button', () => {
    const { element } = toastModule.toast('规则更新失败', 'error', 'a, b, c');
    expect(element.getAttribute('role')).toBe('alert');
    vi.advanceTimersByTime(60_000);
    expect(element.isConnected).toBe(true);
    const close = element.querySelector<HTMLButtonElement>('button.toast-close')!;
    expect(close.getAttribute('aria-label')).toBe('关闭通知');
    close.click(); vi.advanceTimersByTime(300);
    expect(element.isConnected).toBe(false);
  });

  it('auto-dismisses other toasts as status and pauses while hovered', () => {
    const { element } = toastModule.toast('已保存');
    expect(element.getAttribute('role')).toBe('status');
    expect(element.querySelector('.toast-close')).toBeNull();
    vi.advanceTimersByTime(1000);
    element.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(10_000);
    expect(element.isConnected).toBe(true);
    element.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(toastModule.TOAST_DURATION - 1000 + 300);
    expect(element.isConnected).toBe(false);
  });
});

describe('route title and heading focus', () => {
  it('formats the document title as "<page> · <app>" and follows a renamed app', () => {
    document.body.innerHTML = '<span class="brand-name">LocalDNS</span><main id="page-content"></main>';
    expect(appName()).toBe('LocalDNS');
    setPageLabel('查询日志');
    expect(document.title).toBe('查询日志 · LocalDNS');
    document.querySelector('.brand-name')!.textContent = '家庭 DNS';
    syncDocumentTitle();
    expect(document.title).toBe('查询日志 · 家庭 DNS');
  });

  it('focuses the page h1 with tabindex=-1', () => {
    document.body.innerHTML = '<main id="page-content"><div><h1>规则管理</h1></div></main>';
    const root = document.getElementById('page-content')!;
    expect(focusPageHeading(root)).toBe(true);
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('heading focus survives a silent re-render', () => {
  it('restores focus to a re-rendered h1 once it is marked focusable', async () => {
    const { focusSelectors, restoreFocus } = await import('../src/core/router/focus-restore.js');
    const { markPageHeading } = await import('../src/core/router/page-title.js');
    document.body.innerHTML = '<main id="page-content"><div><h1>运行概览</h1></div></main>';
    const root = document.getElementById('page-content')!;
    focusPageHeading(root);
    const selectors = focusSelectors(document.activeElement, root);
    root.innerHTML = '<div><h1>运行概览</h1></div>';
    markPageHeading(root);
    expect(restoreFocus(selectors, root)).toBe(true);
    expect(document.activeElement?.tagName).toBe('H1');
  });
});
