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
  it('连续勾选时弹层保持打开（显隐切换只广播 localdns:layoutchange，不派发 window resize）', () => {
    const resize = vi.fn();
    const layout = vi.fn();
    window.addEventListener('resize', resize);
    window.addEventListener('localdns:layoutchange', layout);
    blocks.bindOverviewBlocks(page());
    trigger().click();
    // bindOverviewBlocks 自身应用一次；只统计之后每次勾选
    layout.mockClear();
    for (const key of ['topology', 'trend', 'slow']) {
      const box = popover().querySelector<HTMLInputElement>(`[data-ovb-key="${key}"]`)!;
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      expect(popover().hidden).toBe(false);
    }
    expect(blocks.getHiddenBlocks()).toEqual(['trend', 'topology', 'slow']);
    expect(resize).not.toHaveBeenCalled();
    expect(layout).toHaveBeenCalledTimes(3);
    window.removeEventListener('resize', resize);
    window.removeEventListener('localdns:layoutchange', layout);
  });

  it('尺寸不变的合成 resize（shell 增强链每次都会派发）不收起弹层，真实视口变化时重新定位', () => {
    const width = window.innerWidth;
    blocks.bindOverviewBlocks(page());
    trigger().getBoundingClientRect = () => ({ top: 10, bottom: 40, left: 900, right: 940, width: 40, height: 30, x: 900, y: 10, toJSON: () => ({}) });
    trigger().click();
    const before = popover().style.right;
    window.dispatchEvent(new Event('resize'));
    expect(popover().hidden).toBe(false);
    expect(popover().style.right).toBe(before);
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width + 200 });
      window.dispatchEvent(new Event('resize'));
      expect(popover().hidden).toBe(false);
      expect(popover().style.right).not.toBe(before);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('页面滚动（含静默刷新后的滚动还原）不收起弹层；触发按钮滚出视口才收起', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    popover().querySelector('.ovb-list')!.dispatchEvent(new Event('scroll'));
    popover().dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(false);
    page().dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(false);
    trigger().getBoundingClientRect = () => ({ top: -80, bottom: -50, left: 0, right: 40, width: 40, height: 30, x: 0, y: -80, toJSON: () => ({}) });
    window.dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(true);
  });

  it('静默刷新重建页面后弹层仍保持打开（滚动还原 + 合成 resize）', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    page().innerHTML = '<button type="button" data-ovb-trigger>自定义显示</button>';
    blocks.bindOverviewBlocks(page());
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(popover().hidden).toBe(false);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('宽屏弹层按起点计算 max-height，底边留在视口内；按钮太靠下时翻到上方', () => {
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    try {
      blocks.bindOverviewBlocks(page());
      trigger().getBoundingClientRect = () => ({ top: 20, bottom: 52, left: 900, right: 940, width: 40, height: 32, x: 900, y: 20, toJSON: () => ({}) });
      trigger().click();
      expect(popover().style.top).toBe('60px');
      expect(popover().style.bottom).toBe('');
      // 700 - 60 - 12
      expect(popover().style.maxHeight).toBe('628px');
      trigger().click();
      expect(popover().hidden).toBe(true);

      trigger().getBoundingClientRect = () => ({ top: 600, bottom: 632, left: 900, right: 940, width: 40, height: 32, x: 900, y: 600, toJSON: () => ({}) });
      trigger().click();
      expect(popover().style.top).toBe('');
      // 700 - 600 + 8
      expect(popover().style.bottom).toBe('108px');
      // 600 - 8 - 12
      expect(popover().style.maxHeight).toBe('580px');
    } finally {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('窄屏停靠时清掉宽屏写入的 inline 定位，尺寸交给 CSS', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    trigger().click();
    vi.stubGlobal('matchMedia', () => ({ matches: true, media: '', addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      trigger().click();
      expect(popover().classList.contains('is-docked')).toBe(true);
      expect(popover().style.top).toBe('');
      expect(popover().style.bottom).toBe('');
      expect(popover().style.maxHeight).toBe('');
    } finally {
      vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }));
    }
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
    // 服务运行状态与指标卡整组相邻，组内顺序固定
    expect(blocks.getBlockOrder()).toEqual([
      'slow','service','kpi','shortcuts','trend','outcomes','topology','rankings','caches'
    ]);
  });

  it('moveBlock 上下移动并持久化', () => {
    expect(blocks.moveBlock('shortcuts', -1)).toBe(true);
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['shortcuts','service','kpi']);
    // 顶到底：再上移已到顶
    expect(blocks.moveBlock('shortcuts', -1)).toBe(false);
    // 底到顶：下移已到底
    expect(blocks.moveBlock('slow', 1)).toBe(false);
  });

  it('applyBlockVisibility 给 #page-content 的直接子元素设置 order，不改动 grid', async () => {
    document.body.innerHTML = '<div id="page-content" class="dashboard-12grid">' +
      '<div class="view-title-row"></div>' +
      '<section class="console-service-summary"><div class="console-service-row"></div><div class="console-kpi-row"></div></section>' +
      '<div class="col-12 console-topology"></div><div class="col-8 console-trend"></div></div>';
    blocks.setBlockOrder(['topology', 'kpi', 'shortcuts', 'service', 'trend', 'outcomes', 'rankings', 'caches', 'slow']);
    blocks.applyBlockVisibility();
    const p = document.querySelector('#page-content') as HTMLElement;
    expect(p.className).toBe('dashboard-12grid');
    expect(p.style.display).toBe('');
    const [title, summary, topo, trend] = [...p.children] as HTMLElement[];
    expect(title.style.order).toBe('');
    expect(topo.style.order).toBe('1');
    // 服务与指标卡同处一个 section，取两者中较前的序号（kpi=1 → order 2）
    expect(summary.style.order).toBe('2');
    expect(trend.style.order).toBe('5');
    // 块内部元素不设 order
    expect((p.querySelector('.console-kpi-row') as HTMLElement).style.order).toBe('');
  });

  it('shell 增强前的模板形态也能认出各块，增强搬移后会再应用一次', async () => {
    document.body.innerHTML = '<div id="page-content">' +
      '<div class="view-title-row"></div><div class="col-4"><div class="control-bar-card"></div></div>' +
      '<div class="col-12"><section class="topology-glass-card"></section></div></div>';
    blocks.setBlockOrder(['topology', 'shortcuts']);
    blocks.bindOverviewBlocks(page());
    const p = document.querySelector('#page-content') as HTMLElement;
    expect((p.children[1] as HTMLElement).style.order).toBe('2');
    expect((p.children[2] as HTMLElement).style.order).toBe('1');
    // 模拟 shell 增强：快捷控制条收进新建的 details，原 col-4 移除
    const details = document.createElement('details');
    details.className = 'console-shortcuts';
    details.append(p.querySelector('.control-bar-card')!);
    p.children[1].remove();
    p.children[0].after(details);
    await Promise.resolve();
    expect(details.style.order).toBe('2');
  });

  it('切换到其他页面后不残留布局改动', () => {
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
    (popover().querySelector('[data-ovb-up="shortcuts"]') as HTMLButtonElement).click();
    expect(blocks.getBlockOrder()[0]).toBe('shortcuts');
    expect(document.activeElement?.getAttribute('data-ovb-down')).toBe('shortcuts');
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
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['shortcuts', 'service', 'kpi']);
    // 弹层重建后焦点在被移动项的按钮上
    expect(document.activeElement?.getAttribute('data-ovb-down')).toBe('service');
  });
});

describe('服务运行状态与指标卡作为整体排序', () => {
  it('旧版分开存储的顺序读取时整组归位到组内最靠前成员的位置', () => {
    mem.set('localdns-overview-block-order:' + location.host, JSON.stringify(['shortcuts','service','trend','outcomes','topology','rankings','caches','slow','kpi']));
    expect(blocks.getBlockOrder()).toEqual(['shortcuts','service','kpi','trend','outcomes','topology','rankings','caches','slow']);
    mem.set('localdns-overview-block-order:' + location.host, JSON.stringify(['kpi','shortcuts','trend','service']));
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['service','kpi','shortcuts']);
  });

  it('移动组内任一成员都整体移动，不会出现页面无变化的空操作', () => {
    expect(blocks.moveBlock('kpi', 1)).toBe(true);
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['shortcuts','service','kpi']);
    expect(blocks.moveBlock('service', 1)).toBe(true);
    expect(blocks.getBlockOrder().slice(0, 4)).toEqual(['shortcuts','trend','service','kpi']);
    // 移到末尾后再下移：已到底
    for (let i = 0; i < 10; i++) blocks.moveBlock('kpi', 1);
    expect(blocks.getBlockOrder().slice(-2)).toEqual(['service','kpi']);
    expect(blocks.moveBlock('service', 1)).toBe(false);
  });

  it('弹层把两者合成一项：两个勾选框各自控制显隐，共用一组上移/下移按钮', () => {
    blocks.bindOverviewBlocks(page());
    trigger().click();
    const items = [...popover().querySelectorAll('.ovb-item')];
    expect(items).toHaveLength(blocks.OVERVIEW_BLOCKS.length - 1);
    const group = items[0];
    expect(group.classList.contains('ovb-group')).toBe(true);
    expect([...group.querySelectorAll('[data-ovb-key]')].map(box => box.getAttribute('data-ovb-key'))).toEqual(['service','kpi']);
    expect(group.querySelectorAll('[data-ovb-up],[data-ovb-down]')).toHaveLength(2);
    expect(popover().querySelector('[data-ovb-up="kpi"],[data-ovb-down="kpi"]')).toBeNull();
    const kpi = group.querySelector<HTMLInputElement>('[data-ovb-key="kpi"]')!;
    kpi.checked = false;
    kpi.dispatchEvent(new Event('change'));
    expect(blocks.getHiddenBlocks()).toEqual(['kpi']);
    (group.querySelector('[data-ovb-down]') as HTMLButtonElement).click();
    expect(blocks.getBlockOrder().slice(0, 3)).toEqual(['shortcuts','service','kpi']);
    expect(popover().querySelectorAll('.ovb-item')[1].classList.contains('ovb-group')).toBe(true);
  });

  it('整组移动后页面上该 section 的 order 随之变化', () => {
    document.body.innerHTML = '<div id="page-content">' +
      '<div class="view-title-row"></div>' +
      '<section class="console-service-summary"><div class="console-service-row"></div><div class="console-kpi-row"></div></section>' +
      '<details class="console-shortcuts"></details></div>';
    blocks.applyBlockVisibility();
    const [, summary, shortcuts] = [...page().children] as HTMLElement[];
    expect(summary.style.order).toBe('1');
    expect(shortcuts.style.order).toBe('3');
    blocks.moveBlock('kpi', 1);
    blocks.applyBlockVisibility();
    expect(shortcuts.style.order).toBe('1');
    expect(summary.style.order).toBe('2');
  });
});
