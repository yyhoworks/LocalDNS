// @vitest-environment jsdom
// 概览内容块自定义显示（features/overview/blocks.js）的单元测试：
// 存储/恢复、data-ov-hide 应用、弹层开关与勾选联动、静默重渲染后的重绑定。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

// jsdom 没有布局，拖动测试给每个块按顺序造一列矩形。
const originalRect = Element.prototype.getBoundingClientRect;
function stubRects(elements: Element[]) {
  const rects = new Map<Element, DOMRect>();
  elements.forEach((el, index) => {
    const top = index * 100;
    rects.set(el, { left: 0, right: 800, top, bottom: top + 90, width: 800, height: 90, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
  });
  const empty = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  Element.prototype.getBoundingClientRect = function () { return rects.get(this) ?? empty; };
}
afterEach(() => { Element.prototype.getBoundingClientRect = originalRect; });

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
    expect(blocks.getHiddenBlocks()).toEqual(['trend', 'topology', 'slow']);
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

  it('恢复默认后焦点留在弹层内', () => {
    blocks.setHiddenBlocks(['kpi']);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    (popover().querySelector('[data-ovb-reset]') as HTMLButtonElement).click();
    expect(popover().contains(document.activeElement)).toBe(true);
    expect(popover().hidden).toBe(false);
  });

  it('页面里没有入口时，在顶部工具栏创建「自定义显示」按钮', () => {
    // 概览页的标题行在成品里是隐藏的，入口必须落在可见的工具栏上。
    document.body.innerHTML = '<div class="glass-action-capsule"></div><div id="page-content"></div>';
    blocks.bindOverviewBlocks(page());
    const created = document.querySelector('.glass-action-capsule [data-ovb-trigger]') as HTMLButtonElement;
    expect(created).toBeTruthy();
    expect(created.getAttribute('aria-label')).toBe('自定义概览显示内容');
    created.click();
    expect(popover().hidden).toBe(false);
    // 重复调用不会重复插入
    blocks.bindOverviewBlocks(page());
    expect(document.querySelectorAll('[data-ovb-trigger]').length).toBe(1);
  });
});

describe('概览内容块排序', () => {
  it('默认顺序为 OVERVIEW_BLOCKS 定义顺序，与样式表既有的 order 设计一致', () => {
    expect(blocks.getBlockOrder()).toEqual([
      'service','kpi','shortcuts','trend','outcomes','topology','rankings','caches','slow'
    ]);
  });

  it('setBlockOrder 过滤未知 key 并补齐缺失项', () => {
    blocks.setBlockOrder(['slow','bogus','kpi']);
    expect(blocks.getBlockOrder()).toEqual([
      'slow','kpi','service','shortcuts','trend','outcomes','topology','rankings','caches'
    ]);
  });

  it('moveBlock 上下移动并持久化', () => {
    expect(blocks.moveBlock('kpi', -1)).toBe(true);
    expect(blocks.getBlockOrder().slice(0, 2)).toEqual(['kpi','service']);
    // 顶到底：再上移已到顶
    expect(blocks.moveBlock('kpi', -1)).toBe(false);
    // 底到顶：下移已到底
    expect(blocks.moveBlock('slow', 1)).toBe(false);
  });

  it('applyBlockVisibility 按用户顺序重排 #page-content 的直接子元素', async () => {
    document.body.innerHTML = '<div id="page-content" class="dashboard-12grid">' +
      '<div class="view-title-row"></div>' +
      '<section class="console-service-summary"><div class="console-service-row"></div><div class="console-kpi-row"></div></section>' +
      '<div class="col-12 console-topology"></div><div class="col-8 console-trend"></div></div>';
    blocks.setBlockOrder(['topology', 'kpi', 'shortcuts', 'service', 'trend', 'outcomes', 'rankings', 'caches', 'slow']);
    blocks.applyBlockVisibility();
    const p = document.querySelector('#page-content') as HTMLElement;
    // 顺序落到 DOM 上：标题行永远最前，其余按用户顺序；不再写 CSS order
    expect([...p.children].map(el => el.className || el.tagName)).toEqual([
      'view-title-row', 'col-12 console-topology', 'console-service-summary', 'col-8 console-trend'
    ]);
    expect(p.className).toBe('dashboard-12grid');
    expect((p.children[1] as HTMLElement).getAttribute('data-ov-block')).toBe('topology');
    // 服务与指标卡同处一个 section，两个 key 都记下来，拖动时一起搬
    expect((p.querySelector('.console-service-summary') as HTMLElement).dataset.ovBlockKeys).toBe('kpi service');
    expect((p.querySelector('.console-kpi-row') as HTMLElement).style.order).toBe('');
  });

  it('shell 增强前的模板形态也能认出各块，增强搬移后会再排一次', async () => {
    document.body.innerHTML = '<div id="page-content">' +
      '<div class="view-title-row"></div><div class="col-4"><div class="control-bar-card"></div></div>' +
      '<div class="col-12"><section class="topology-glass-card"></section></div></div>';
    blocks.setBlockOrder(['topology', 'shortcuts']);
    blocks.bindOverviewBlocks(page());
    const p = document.querySelector('#page-content') as HTMLElement;
    expect([...p.children].map(el => el.className || el.tagName)).toEqual([
      'view-title-row', 'col-12', 'col-4'
    ]);
    // 模拟 shell 增强：快捷控制条收进新建的 details，原 col-4 移除
    const details = document.createElement('details');
    details.className = 'console-shortcuts';
    const shortcutColumn = p.querySelector('.col-4')!;
    details.append(p.querySelector('.control-bar-card')!);
    shortcutColumn.remove();
    p.children[0].after(details);
    await Promise.resolve();
    // 增强后新建的 details 没有 data-ov-block，观察器补排后应该排到拓扑后面
    expect([...p.children].map(el => el.className || el.tagName)).toEqual([
      'view-title-row', 'col-12', 'console-shortcuts'
    ]);
    expect(details.getAttribute('data-ov-block')).toBe('shortcuts');
  });

  it('拖动块可以改变顺序并写回存储', () => {
    document.body.innerHTML = '<div id="page-content">' +
      '<div class="col-12 console-topology"></div>' +
      '<div class="col-8 console-trend"></div>' +
      '<div class="col-4 console-donut"></div></div>';
    blocks.bindOverviewBlocks(page());
    const p = page();
    // 默认顺序是 trend(3) / outcomes(4) / topology(5)
    expect([...p.children].map(el => el.className)).toEqual(['col-8 console-trend', 'col-4 console-donut', 'col-12 console-topology']);
    stubRects([...p.children]);
    const donut = p.querySelector('.console-donut') as HTMLElement;
    donut.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 250 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 40 }));
    expect(donut.classList.contains('is-dragging')).toBe(true);
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 20, clientY: 40 }));
    expect([...p.children].map(el => el.className)).toEqual(['col-4 console-donut', 'col-8 console-trend', 'col-12 console-topology']);
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['outcomes', 'trend', 'topology']);
    expect(donut.classList.contains('is-dragging')).toBe(false);
  });

  it('切换块位置后不残留布局改动', () => {
    blocks.applyBlockVisibility();
    expect(page().classList.contains('ov-blocks-sortable')).toBe(false);
    expect(page().style.display).toBe('');
  });

  it('点击条目文字即可切换显示，恢复默认同时重置显隐与顺序', () => {
    blocks.moveBlock('slow', -1);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    const box = popover().querySelector<HTMLInputElement>('[data-ovb-key="trend"]')!;
    (box.closest('label')!.querySelector('.ovb-item-text') as HTMLElement).click();
    expect(blocks.getHiddenBlocks()).toEqual(['trend']);
    const reset = popover().querySelector('[data-ovb-reset]') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(blocks.getHiddenBlocks()).toEqual([]);
    expect(blocks.getBlockOrder()).toEqual(blocks.OVERVIEW_BLOCKS.map(([key]: string[]) => key));
    expect((popover().querySelector('[data-ovb-reset]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('移到顶端后同向按钮被禁用，焦点落到反向按钮而不是 body', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    (popover().querySelector('[data-ovb-up="kpi"]') as HTMLButtonElement).click();
    expect(blocks.getBlockOrder()[0]).toBe('kpi');
    expect(document.activeElement?.getAttribute('data-ovb-down')).toBe('kpi');
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
    const firstDown = popover().querySelector('[data-ovb-down="service"]') as HTMLButtonElement;
    firstDown.click();
    expect(blocks.getBlockOrder()[0]).toBe('kpi');
    expect(blocks.getBlockOrder()[1]).toBe('service');
    // 弹层重建后焦点在被移动项的按钮上
    expect(document.activeElement?.getAttribute('data-ovb-down')).toBe('service');
  });
});
