// 概览页内容块的自定义显示：块定义、按浏览器持久化与设置弹层。
// 显隐走 CSS（#page-content[data-ov-hide~="key"] 隐藏对应块，规则见
// styles/features/overview.css），不改渲染结构：被隐藏的块照常渲染、
// 取数并参与 shell 增强链，避免破坏既有的 DOM 重排与事件绑定。
// 弹层挂在 body 上而不是 #page-content 里：概览页每 30 秒静默重渲染一次，
// 页面内的弹层会连带销毁；挂在页面外则不受影响，也不占用页面的焦点还原快照。
import { $, $$, storage, API_BASE } from '../../core/context.js';
import { esc } from '../../shared/format/number.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { icon } from '../../shared/components/icons.js';

// 顺序即弹层展示顺序；key 与 styles/features/overview.css 的隐藏规则一一对应。
export const OVERVIEW_BLOCKS = [
  ['shortcuts', '快捷控制条', '客户端分流、缓存与过期、功能开关'],
  ['service', '服务运行状态', '服务状态、运行时长、CPU、内存与健康提示'],
  ['kpi', '指标卡', '累计请求、缓存命中率、客户端数等数据卡'],
  ['topology', '解析链路拓扑', '五阶段 DNS 解析路径示意'],
  ['trend', '响应趋势图', '服务运行体征与查询吞吐监控'],
  ['outcomes', '查询结果占比', '分流结果环形图与分类列表'],
  ['rankings', '访问排行', '域名、客户端与名单排行'],
  ['caches', '缓存池状态', '多级缓存池命中率与管理入口'],
  ['slow', '慢查询排行', '耗时最高的查询样本列表']
];

const BLOCK_KEYS = new Set(OVERVIEW_BLOCKS.map(([key]) => key));
const storageKey = () => 'localdns-overview-hidden-blocks:' + (API_BASE || location.host);

/** 当前隐藏的块；始终按 OVERVIEW_BLOCKS 顺序输出，列表里的未知 key 会被过滤。 */
export function getHiddenBlocks() {
  try {
    const raw = JSON.parse(storage.get(storageKey()) || '[]');
    if (!Array.isArray(raw)) return [];
    return OVERVIEW_BLOCKS.map(([key]) => key).filter(key => raw.includes(key));
  } catch { return []; }
}

export function setHiddenBlocks(keys) {
  const unique = new Set(keys.filter(key => BLOCK_KEYS.has(key)));
  storage.set(storageKey(), JSON.stringify(OVERVIEW_BLOCKS.map(([key]) => key).filter(key => unique.has(key))));
}

/** 把隐藏列表落到 #page-content 的 data-ov-hide 上，由 CSS 控制显隐。 */
export function applyBlockVisibility() {
  const page = $('#page-content');
  if (!page) return;
  const hidden = getHiddenBlocks();
  const next = hidden.join(' ');
  const prev = page.dataset.ovHide || '';
  if (prev === next) return;
  if (next) page.dataset.ovHide = next;
  else delete page.dataset.ovHide;
  // 显隐变化会影响布局；概览页监听 resize 重画拓扑连线（SVG 连线按节点
  // 真实盒模型绘制），这里补发一次让刚显示出来的拓扑立即有连线。
  window.dispatchEvent(new Event('resize'));
}

let popover = null;

function ensurePopover() {
  if (popover?.isConnected) return popover;
  popover = document.createElement('div');
  popover.id = 'overview-blocks-popover';
  popover.className = 'overview-blocks-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '自定义概览显示内容');
  popover.hidden = true;
  document.body.append(popover);
  bindGlobalListeners();
  return popover;
}

function closePopover() {
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  document.querySelector('[data-ovb-trigger]')?.setAttribute('aria-expanded', 'false');
}

function positionPopover(trigger) {
  const rect = trigger.getBoundingClientRect();
  // 右对齐触发按钮，同时兜底保证弹层整体留在视口内。
  const right = Math.min(Math.max(12, window.innerWidth - rect.right), Math.max(12, window.innerWidth - 324));
  popover.style.top = `${Math.max(12, rect.bottom + 8)}px`;
  popover.style.right = `${right}px`;
}

function popoverHtml() {
  const hidden = new Set(getHiddenBlocks());
  return `
    <div class="ovb-head">
      <strong>自定义概览显示内容</strong>
      <button type="button" class="ovb-close" data-ovb-close aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="ovb-list">
      ${OVERVIEW_BLOCKS.map(([key, label, desc]) => `
        <label class="ovb-item" title="${esc(desc)}">
          <input type="checkbox" data-ovb-key="${esc(key)}" ${hidden.has(key) ? '' : 'checked'}>
          <span class="ovb-item-text"><span>${esc(label)}</span><small>${esc(desc)}</small></span>
        </label>`).join('')}
    </div>
    <div class="ovb-foot">
      <button type="button" class="glass-btn ovb-reset" data-ovb-reset ${hidden.size ? '' : 'disabled'}>恢复全部显示</button>
      <span class="ovb-note">按浏览器保存 · 仅影响概览页</span>
    </div>`;
}

function openPopover(trigger) {
  const pop = ensurePopover();
  setHTML(pop, popoverHtml());
  bindPopoverControls(pop);
  if (matchMedia('(max-width:600px)').matches) {
    pop.classList.add('is-docked');
    pop.style.top = ''; pop.style.right = '';
  } else {
    pop.classList.remove('is-docked');
    positionPopover(trigger);
  }
  pop.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
}

function bindPopoverControls(pop) {
  $$('[data-ovb-key]', pop).forEach(box => {
    box.onchange = () => {
      const hidden = new Set(getHiddenBlocks());
      const key = box.dataset.ovbKey;
      if (box.checked) hidden.delete(key); else hidden.add(key);
      setHiddenBlocks([...hidden]);
      applyBlockVisibility();
      const reset = $('[data-ovb-reset]', pop);
      if (reset) reset.disabled = hidden.size === 0;
    };
  });
  $('[data-ovb-close]', pop).onclick = closePopover;
  $('[data-ovb-reset]', pop).onclick = () => {
    setHiddenBlocks([]);
    applyBlockVisibility();
    setHTML(pop, popoverHtml());
    bindPopoverControls(pop);
  };
}

let globalListenersBound = false;
function bindGlobalListeners() {
  if (globalListenersBound) return;
  globalListenersBound = true;
  // 点击弹层与触发按钮以外的地方关闭；capture 模式先于页面内其它点击逻辑执行。
  document.addEventListener('click', event => {
    if (!popover || popover.hidden) return;
    if (popover.contains(event.target) || event.target.closest('[data-ovb-trigger]')) return;
    closePopover();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popover && !popover.hidden) { event.stopPropagation(); closePopover(); }
  });
  // 滚动或调整窗口后触发按钮的定位不再可靠，直接收起。
  window.addEventListener('scroll', () => closePopover(), true);
  window.addEventListener('resize', () => closePopover());
}

/**
 * 概览每次渲染后调用：应用显隐设置并绑定标题行的“自定义显示”按钮。
 * 静默刷新会重建触发按钮，因此需要重复调用；弹层本体只在首次创建。
 */
export function bindOverviewBlocks(page) {
  ensurePopover();
  applyBlockVisibility();
  const trigger = $('[data-ovb-trigger]', page);
  if (!trigger) return;
  trigger.onclick = event => {
    event.stopPropagation();
    if (popover && !popover.hidden) closePopover();
    else openPopover(trigger);
  };
  // 弹层开着时经历静默重渲染，重建后的按钮要同步展开状态。
  if (popover && !popover.hidden) trigger.setAttribute('aria-expanded', 'true');
}
