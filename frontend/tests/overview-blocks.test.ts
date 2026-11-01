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
  it('连续勾选时弹层保持打开（显隐切换自己发出的 resize 不会收起弹层）', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    for (const key of ['topology', 'trend', 'slow']) {
      const box = popover().querySelector<HTMLInputElement>(`[data-ovb-key="${key}"]`)!;
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      expect(popover().hidden).toBe(false);
    }
    expect(blocks.getHiddenBlocks()).toEqual(['topology', 'trend', 'slow']);
    window.dispatchEvent(new Event('resize'));
    expect(popover().hidden).toBe(true);
  });

  it('弹层内部滚动不收起，页面滚动才收起', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    popover().querySelector('.ovb-list')!.dispatchEvent(new Event('scroll'));
    popover().dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(false);
    page().dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(true);
  });

  it('打开时焦点进入弹层，Esc 与关闭按钮把焦点还给触发按钮，点击外部不抢焦点', () => {
    blocks.bindOverviewBlocks(page());
    trigger().focus();
    trigger().click();
    expect(document.activeElement).toBe(popover().querySelector('[data-ovb-key]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.activeElement).toBe(trigger());

    trigger().click();
    (popover().querySelector('[data-ovb-close]') as HTMLButtonElement).click();
    expect(popover().hidden).toBe(true);
    expect(document.activeElement).toBe(trigger());

    trigger().click();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    outside.click();
    expect(popover().hidden).toBe(true);
    expect(document.activeElement).toBe(outside);
  });

  it('恢复全部显示后焦点留在弹层内', () => {
    blocks.setHiddenBlocks(['kpi']);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    (popover().querySelector('[data-ovb-reset]') as HTMLButtonElement).click();
    expect(popover().contains(document.activeElement)).toBe(true);
    expect(popover().hidden).toBe(false);
  });
});

describe('概览内容块排序', () => {
  it('默认顺序为 OVERVIEW_BLOCKS 定义顺序', () => {
    expect(blocks.getBlockOrder()).toEqual([
      'shortcuts','service','kpi','topology','trend','outcomes','rankings','caches','slow'
    ]);
  });

  it('setBlockOrder 过滤未知 key 并补齐缺失项', () => {
    blocks.setBlockOrder(['slow','bogus','kpi']);
    expect(blocks.getBlockOrder()).toEqual([
      'slow','kpi','shortcuts','service','topology','trend','outcomes','rankings','caches'
    ]);
  });

  it('moveBlock 上下移动并持久化', () => {
    expect(blocks.moveBlock('kpi', -1)).toBe(true);
    expect(blocks.getBlockOrder()[1]).toBe('kpi');
    expect(blocks.getBlockOrder()[2]).toBe('service');
    // 顶到底：再上移已到顶
    expect(blocks.moveBlock('shortcuts', -1)).toBe(false);
    // 底到顶：下移已到底
    expect(blocks.moveBlock('slow', 1)).toBe(false);
  });

  it('applyBlockVisibility 给各块设置 order', () => {
    document.body.innerHTML = '<div id="page-content">' +
      '<div class="console-kpi-row"></div><div class="console-topology"></div></div>';
    blocks.setBlockOrder(['topology','kpi','shortcuts','service','trend','outcomes','rankings','caches','slow']);
    blocks.applyBlockVisibility();
    const page = document.querySelector('#page-content') as HTMLElement;
    expect(page.classList.contains('ov-blocks-sortable')).toBe(true);
    const kpi = page.querySelector('.console-kpi-row') as HTMLElement;
    const topo = page.querySelector('.console-topology') as HTMLElement;
    expect(kpi.style.order).toBe('1');
    expect(topo.style.order).toBe('0');
  });

  it('弹层按自定义顺序渲染且首尾按钮禁用', () => {
    blocks.setBlockOrder(['slow','shortcuts','service','kpi','topology','trend','outcomes','rankings','caches']);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    const items = [...popover().querySelectorAll('.ovb-item')];
    expect(items[0].querySelector('[data-ovb-up]')?.hasAttribute('disabled')).toBe(true);
    expect(items[0].querySelector('[data-ovb-down]')?.hasAttribute('disabled')).toBe(false);
    const last = items[items.length - 1];
    expect(last.querySelector('[data-ovb-down]')?.hasAttribute('disabled')).toBe(true);
    // 第一个是 slow
    expect(items[0].querySelector('[data-ovb-key]')?.getAttribute('data-ovb-key')).toBe('slow');
  });

  it('点下移按钮后顺序变化且弹层重建', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    const firstDown = popover().querySelector('[data-ovb-down="shortcuts"]') as HTMLButtonElement;
    firstDown.click();
    expect(blocks.getBlockOrder()[0]).toBe('service');
    expect(blocks.getBlockOrder()[1]).toBe('shortcuts');
    // 弹层重建后焦点在被移动项的按钮上
    expect(document.activeElement?.getAttribute('data-ovb-down')).toBe('shortcuts');
  });
});
