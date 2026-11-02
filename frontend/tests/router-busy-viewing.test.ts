// @vitest-environment jsdom
// 静默刷新的“正在操作”判定（core/router/router.js 的 busyViewing）。
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let busyViewing: () => boolean;

beforeAll(async () => {
  // context.js 在模块导入期读取 matchMedia，先补全局再动态导入。
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {} }));
  document.body.innerHTML = '<main><div id="page-content"></div></main>';
  ({ busyViewing } = await import('../src/core/router/router.js'));
});

beforeEach(() => {
  document.querySelector('#overview-blocks-popover')?.remove();
});

describe('busyViewing', () => {
  it('空闲时不算正在操作', () => {
    expect(busyViewing()).toBe(false);
  });

  it('概览「自定义显示」弹层（挂在 body 上）打开时暂停静默刷新，收起后恢复', () => {
    const pop = document.createElement('div');
    pop.id = 'overview-blocks-popover';
    pop.hidden = false;
    document.body.append(pop);
    expect(busyViewing()).toBe(true);
    pop.hidden = true;
    expect(busyViewing()).toBe(false);
  });
});
