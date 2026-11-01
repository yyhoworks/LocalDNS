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

/** 块 key → 页面内对应元素的选择器（与 overview.css 的隐藏规则保持一致）。 */
const BLOCK_SELECTORS = {
  shortcuts: ['.console-shortcuts', '.control-bar-card'],
  service: ['.console-service-row', '.console-health-strip'],
  kpi: ['.console-kpi-row', '.spark-kpi-card'],
  topology: ['.console-topology'],
  trend: ['.console-trend'],
  outcomes: ['.console-donut'],
  rankings: ['.workspace-rankings'],
  caches: ['.overview-cache-panel'],
  slow: ['.overview-slow-panel'],
};

const BLOCK_KEYS = new Set(OVERVIEW_BLOCKS.map(([key]) => key));
const storageKey = () => 'localdns-overview-hidden-blocks:' + (API_BASE || location.host);
const orderKey = () => 'localdns-overview-block-order:' + (API_BASE || location.host);

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

/** 当前块顺序；未自定义过时返回默认顺序，未知 key 被过滤、缺失的 key 按默认顺序补齐。 */
export function getBlockOrder() {
  const defaults = OVERVIEW_BLOCKS.map(([key]) => key);
  try {
    const raw = JSON.parse(storage.get(orderKey()) || '[]');
    if (!Array.isArray(raw)) return defaults;
    const seen = new Set();
    const ordered = raw.filter(key => BLOCK_KEYS.has(key) && !seen.has(key) && (seen.add(key), true));
    defaults.forEach(key => { if (!seen.has(key)) ordered.push(key); });
    return ordered;
  } catch { return defaults; }
}

export function setBlockOrder(keys) {
  const seen = new Set();
  const ordered = keys.filter(key => BLOCK_KEYS.has(key) && !seen.has(key) && (seen.add(key), true));
  OVERVIEW_BLOCKS.forEach(([key]) => { if (!seen.has(key)) ordered.push(key); });
  storage.set(orderKey(), JSON.stringify(ordered));
}

/** 把 key 指定的块上移/下移一位（dir=-1 上移，+1 下移），返回是否发生移动。 */
export function moveBlock(key, dir) {
  const order = getBlockOrder();
  const idx = order.indexOf(key);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= order.length) return false;
  [order[idx], order[next]] = [order[next], order[idx]];
  setBlockOrder(order);
  return true;
}

/** 把隐藏列表落到 #page-content 的 data-ov-hide 上，由 CSS 控制显隐；
 *  同时按用户自定义顺序给各块设置 CSS order（父容器为 flex column 时生效）。 */
export function applyBlockVisibility() {
  const page = $('#page-content');
  if (!page) return;
  const hidden = getHiddenBlocks();
  const next = hidden.join(' ');
  const prev = page.dataset.ovHide || '';
  if (prev !== next) {
    if (next) page.dataset.ovHide = next;
    else delete page.dataset.ovHide;
  }
  // 排序：按用户顺序给每个块的元素设置 order。30 秒重渲染会重建 DOM，
  // 因此每次调用都重新应用（幂等）。父容器需要 flex column 才生效。
  page.classList.add('ov-blocks-sortable');
  const order = getBlockOrder();
  order.forEach((key, idx) => {
    (BLOCK_SELECTORS[key] || []).forEach(sel => {
      page.querySelectorAll(sel).forEach(el => {
        el.style.order = String(idx);
      });
    });
  });
  // 显隐/排序变化会影响布局；概览页监听 resize 重画拓扑连线（SVG 连线按节点
  // 真实盒模型绘制），这里补发一次让刚显示/移动的拓扑立即有连线。
  // 这次 resize 是自己发出的（同步分发），弹层的“窗口变化即收起”要跳过它，
  // 否则每勾选一项弹层都会被关掉。
  selfResize = true;
  try { window.dispatchEvent(new Event('resize')); } finally { selfResize = false; }
}

let popover = null;
let selfResize = false;

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

/** returnFocus：经由键盘或关闭按钮收起时把焦点还给触发按钮；点击外部收起时不抢焦点。 */
function closePopover(returnFocus = false) {
  if (!popover || popover.hidden) return;
  const hadFocus = popover.contains(document.activeElement);
  popover.hidden = true;
  const trigger = /** @type {HTMLElement|null} */ (document.querySelector('[data-ovb-trigger]'));
  trigger?.setAttribute('aria-expanded', 'false');
  if (returnFocus && hadFocus) trigger?.focus({ preventScroll: true });
}

function focusFirstControl(pop) {
  /** @type {HTMLElement|null} */ ($('[data-ovb-key]', pop))?.focus({ preventScroll: true });
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
  const order = getBlockOrder();
  const byKey = new Map(OVERVIEW_BLOCKS.map(b => [b[0], b]));
  return `
    <div class="ovb-head">
      <strong>自定义概览显示内容</strong>
      <button type="button" class="ovb-close" data-ovb-close aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="ovb-list">
      ${order.map((key, idx) => {
        const [k, l, d] = byKey.get(key) || [key, key, ''];
        return `
        <div class="ovb-item" title="${esc(d)}">
          <input type="checkbox" data-ovb-key="${esc(k)}" ${hidden.has(k) ? '' : 'checked'} aria-label="显示${esc(l)}">
          <span class="ovb-item-text"><span>${esc(l)}</span><small>${esc(d)}</small></span>
          <span class="ovb-move">
            <button type="button" data-ovb-up="${esc(k)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移${esc(l)}">▲</button>
            <button type="button" data-ovb-down="${esc(k)}" ${idx === order.length - 1 ? 'disabled' : ''} aria-label="下移${esc(l)}">▼</button>
          </span>
        </div>`;
      }).join('')}
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
  // 弹层挂在 body 末尾，不移焦点的话键盘要 Tab 穿过整页才能到达。
  focusFirstControl(pop);
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
  // 上下移动：调整顺序后重建弹层列表（按钮禁用态会变），焦点留在被移动项的按钮上。
  const rebindMove = (attr, dir) => {
    $$(`[${attr}]`, pop).forEach(btn => {
      btn.onclick = event => {
        event.stopPropagation();
        const key = btn.getAttribute(attr);
        if (!moveBlock(key, dir)) return;
        applyBlockVisibility();
        const focusKey = attr;
        setHTML(pop, popoverHtml());
        bindPopoverControls(pop);
        const next = $(`[${focusKey}="${key}"]`, pop);
        if (next && !next.disabled) next.focus({ preventScroll: true });
      };
    });
  };
  rebindMove('data-ovb-up', -1);
  rebindMove('data-ovb-down', 1);
  $('[data-ovb-close]', pop).onclick = () => closePopover(true);
  $('[data-ovb-reset]', pop).onclick = () => {
    setHiddenBlocks([]);
    applyBlockVisibility();
    setHTML(pop, popoverHtml());
    bindPopoverControls(pop);
    // 重建后原按钮已移除（且已禁用），焦点落回第一项，避免掉到 body。
    focusFirstControl(pop);
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
    if (event.key === 'Escape' && popover && !popover.hidden) { event.stopPropagation(); closePopover(true); }
  });
  // 页面滚动或窗口变化后触发按钮的定位不再可靠，直接收起；
  // 弹层自身列表的滚动（overflow:auto）与显隐切换自己发出的 resize 除外。
  window.addEventListener('scroll', event => {
    if (popover && event.target instanceof Node && popover.contains(event.target)) return;
    closePopover();
  }, true);
  window.addEventListener('resize', () => { if (!selfResize) closePopover(); });
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
