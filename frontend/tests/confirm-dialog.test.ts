// @vitest-environment jsdom
// 回归：confirmDialog 必须使用自己的 <dialog>，不能覆盖/关闭调用方已打开的 #modal。
// 之前它复用 #modal，导致审计控制弹窗在确认瞬间被替换，保存后既无反馈也不刷新。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/context.js', () => ({
  $: (selector: string, root: ParentNode = document) => root.querySelector(selector),
}));
vi.mock('../src/core/router/route-lifetime', () => ({ currentScope: () => ({ signal: new AbortController().signal }) }));
vi.mock('../src/features/shell/interface.js', () => ({ shellInterfaceService: null }));
vi.mock('../src/shared/workspace.js', () => ({ workspaceService: { modalChanging: vi.fn() } }));
vi.mock('../src/shared/components/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/core/security/safe-dom.ts', () => ({ setHTML: (element: Element, html: string) => { element.innerHTML = html; } }));

import { confirmDialog, modalOpen } from '../src/shared/components/dialog.js';

const dialogOf = (id: string) => document.querySelector<HTMLDialogElement>(`#${id}`)!;
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = `<dialog id="modal"><form method="dialog" class="modal-panel" id="modal-form">
    <h2 id="modal-title"></h2><p id="modal-subtitle"></p>
    <div id="modal-content"></div><div id="modal-actions"></div></form></dialog>`;
  // jsdom 没有实现 dialog 的模态方法，用最小实现替代
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});

describe('confirmDialog', () => {
  it('不覆盖、也不关闭调用方已打开的弹窗', async () => {
    modalOpen('审计控制', '管理 DNS 查询日志', '<input id="audit-dir" value="logs">', null, false);
    const caller = dialogOf('modal');
    expect(caller.open).toBe(true);

    const pending = confirmDialog({ message: '确定保存目录？', danger: true });

    // 确认框出现时，调用方的标题和表单原封不动
    expect(caller.open).toBe(true);
    expect(document.querySelector('#modal-title')!.textContent).toBe('审计控制');
    expect(document.querySelector('#audit-dir')).not.toBeNull();
    expect(dialogOf('confirm-modal').open).toBe(true);
    expect(document.querySelector('#confirm-message')!.textContent).toBe('确定保存目录？');

    button('#confirm-ok').click();
    await expect(pending).resolves.toBe(true);

    // 确认框收起，调用方弹窗仍然开着——这是保存后还能显示反馈的前提
    expect(dialogOf('confirm-modal').open).toBe(false);
    expect(caller.open).toBe(true);
    expect(document.querySelector('#audit-dir')).not.toBeNull();
  });

  it('Esc 视为取消，且不关闭调用方弹窗', async () => {
    modalOpen('审计控制', '', '<input id="audit-dir">', null, false);
    const pending = confirmDialog({ message: '继续？' });
    dialogOf('confirm-modal').dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(pending).resolves.toBe(false);
    expect(dialogOf('modal').open).toBe(true);
  });

  it('复用同一个确认框，并重置文案与危险样式', async () => {
    const first = confirmDialog({ message: '第一次', confirmText: '删除', danger: true });
    expect(button('#confirm-ok').textContent).toBe('删除');
    expect(button('#confirm-ok').className).toBe('button danger');
    button('#confirm-ok').click();
    await expect(first).resolves.toBe(true);

    const second = confirmDialog({ message: '第二次' });
    expect(document.querySelector('#confirm-message')!.textContent).toBe('第二次');
    expect(button('#confirm-ok').textContent).toBe('确定');
    expect(button('#confirm-ok').className).toBe('button primary');
    button('#confirm-cancel').click();
    await expect(second).resolves.toBe(false);
    expect(document.querySelectorAll('#confirm-modal')).toHaveLength(1);
  });
});
