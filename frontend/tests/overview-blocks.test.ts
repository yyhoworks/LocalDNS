// @vitest-environment jsdom
// 概览内容块自定义显示（features/overview/blocks.js）的单元测试：
// 存储/恢复、data-ov-hide 应用、弹层开关与勾选联动、静默重渲染后的重绑定。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.mock('../src/core/persistence/preferences.ts', () => ({
  preferences: {
    getItem: (key: string) => (mem.has(key) ? (mem.get(key) as string) : null),
    setItem: (key: string, value: string) => { mem.set(key, String(value)); },
    removeItem: (key: string) => { mem.delete(key); },
  },
  sessionPreferences: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
}));
vi.mock('../src/core/security/safe-dom.ts', () => ({
  setHTML: (element: Element, html: string) => { element.innerHTML = String(html); },
}));

let blocks: typeof import('../src/features/overview/blocks.js');

const page = () => document.querySelector('#page-content') as HTMLElement;
const popover = () => document.querySelector('#overview-blocks-popover') as HTMLElement;
const trigger = () => page().querySelector('[data-ovb-trigger]') as HTMLButtonElement;

beforeAll(async () => {
  // context.js 在模块导入期读取 matchMedia，先补全局再动态导入被测模块。
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '';
  blocks = await import('../src/features/overview/blocks.js');
});

beforeEach(() => {
  mem.clear();
  document.body.innerHTML = '<div id="page-content"><button type="button" data-ovb-trigger>自定义显示</button></div>';
});

describe('概览内容块自定义显示', () => {
  it('默认全部显示：存储为空时不设置 data-ov-hide', () => {
    expect(blocks.getHiddenBlocks()).toEqual([]);
    blocks.applyBlockVisibility();
    expect(page().hasAttribute('data-ov-hide')).toBe(false);
  });

  it('setHiddenBlocks 过滤未知 key，并按块定义顺序持久化与应用', () => {
    blocks.setHiddenBlocks(['slow', 'bogus', 'topology']);
    expect(blocks.getHiddenBlocks()).toEqual(['topology', 'slow']);
    blocks.applyBlockVisibility();
    expect(page().dataset.ovHide).toBe('topology slow');
  });

  it('清空隐藏列表后 data-ov-hide 属性被移除', () => {
    blocks.setHiddenBlocks(['kpi']);
    blocks.applyBlockVisibility();
    expect(page().hasAttribute('data-ov-hide')).toBe(true);
    blocks.setHiddenBlocks([]);
    blocks.applyBlockVisibility();
    expect(page().hasAttribute('data-ov-hide')).toBe(false);
  });

  it('点击触发按钮打开弹层，勾选状态反映当前隐藏列表', () => {
    blocks.setHiddenBlocks(['trend']);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    expect(popover()).toBeTruthy();
    expect(popover().hidden).toBe(false);
    const boxes = [...popover().querySelectorAll<HTMLInputElement>('[data-ovb-key]')];
    expect(boxes).toHaveLength(blocks.OVERVIEW_BLOCKS.length);
    expect(boxes.find(box => box.dataset.ovbKey === 'trend')!.checked).toBe(false);
    expect(boxes.find(box => box.dataset.ovbKey === 'topology')!.checked).toBe(true);
  });

  it('取消勾选立即写入存储并应用到 data-ov-hide，恢复按钮重新显示全部', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    const box = popover().querySelector<HTMLInputElement>('[data-ovb-key="topology"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(blocks.getHiddenBlocks()).toEqual(['topology']);
    expect(page().dataset.ovHide).toBe('topology');

    (popover().querySelector('[data-ovb-reset]') as HTMLButtonElement).click();
    expect(blocks.getHiddenBlocks()).toEqual([]);
    expect(page().hasAttribute('data-ov-hide')).toBe(false);
    expect((popover().querySelector<HTMLInputElement>('[data-ovb-key="topology"]')!).checked).toBe(true);
  });

  it('点击弹层外部或按 Esc 关闭弹层', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    expect(popover().hidden).toBe(false);
    document.body.click();
    expect(popover().hidden).toBe(true);
    trigger().click();
    expect(popover().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(popover().hidden).toBe(true);
  });

  it('静默重渲染重建触发按钮后重新绑定，aria-expanded 与弹层状态一致', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    page().innerHTML = '<button type="button" data-ovb-trigger>自定义显示</button>';
    blocks.bindOverviewBlocks(page());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(popover().hidden).toBe(false);
  });
});
