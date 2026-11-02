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

// 顺序即默认展示顺序与弹层顺序；key 与 styles/features/overview.css 的隐藏规则一一对应。
// 默认顺序必须与样式表里既有的 order 设计一致（overview.css 的 .console-service-summary
// order:1、base.css 的 .console-shortcuts order:2 / .console-trend、.console-donut order:3、
// overview.css 的 .console-topology order:4 / .workspace-rankings order:5 / 缓存与慢查询
// order:6），否则从没改过顺序的用户也会看到布局被改写。
export const OVERVIEW_BLOCKS = [
  ['service', '服务运行状态', '服务状态、运行时长、CPU、内存与健康提示'],
  ['kpi', '指标卡', '累计请求、缓存命中率、客户端数等数据卡'],
  ['shortcuts', '快捷控制条', '客户端分流、缓存与过期、功能开关'],
  ['trend', '响应趋势图', '服务运行体征与查询吞吐监控'],
  ['outcomes', '查询结果占比', '分流结果环形图与分类列表'],
  ['topology', '解析链路拓扑', '五阶段 DNS 解析路径示意'],
  ['rankings', '访问排行', '域名、客户端与名单排行'],
  ['caches', '缓存池状态', '多级缓存池命中率与管理入口'],
  ['slow', '慢查询排行', '耗时最高的查询样本列表']
];

/** 块 key → 能认出该块的选择器：同时覆盖 shell 增强前（模板原样）与增强后的 DOM。 */
const BLOCK_SELECTORS = {
  shortcuts: ['.console-shortcuts', '.control-bar-card'],
  service: ['.console-service-row', '.console-health-strip', '.console-service-summary'],
  kpi: ['.console-kpi-row', '.spark-kpi-card'],
  topology: ['.console-topology', '.topology-glass-card'],
  trend: ['.console-trend', '.traffic-chart-body'],
  outcomes: ['.console-donut', '.outbound-donut-body'],
  rankings: ['.workspace-rankings'],
  caches: ['.overview-cache-panel'],
  slow: ['.overview-slow-panel'],
};

const BLOCK_KEYS = new Set(OVERVIEW_BLOCKS.map(([key]) => key));
/** 一条能认出“当前页有概览块”的选择器，用于判断观察器是否还该留在页面上。 */
const BLOCK_PROBE = Object.values(BLOCK_SELECTORS).flat().join(',');
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

/**
 * 按用户顺序给 #page-content 的直接子元素设置 CSS order。
 * #page-content 是全站共用的 12 栏 grid（.dashboard-12grid），grid 子项本身就支持
 * order，不需要也不能改动它的 display。每个直接子元素取其中所含块的最小序号：
 * 服务状态与指标卡在 shell 增强后同处一个 section，因此作为一个整体移动。
 * 不属于任何块的子元素（标题行）order 为空，保持在最前。
 */
function applyBlockOrder(page) {
  const rank = new Map(getBlockOrder().map((key, idx) => [key, idx]));
  [...page.children].forEach(child => {
    let best = null;
    for (const [key, selectors] of Object.entries(BLOCK_SELECTORS)) {
      if (selectors.some(sel => child.matches(sel) || child.querySelector(sel))) {
        const r = rank.get(key) ?? 0;
        best = best === null ? r : Math.min(best, r);
      }
    }
    /** @type {HTMLElement} */ (child).style.order = best === null ? '' : String(best + 1);
  });
}

/** 把隐藏列表落到 #page-content 的 data-ov-hide 上，由 CSS 控制显隐，并应用块顺序。 */
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
  // 30 秒重渲染会重建 DOM，因此每次调用都重新应用，重复调用结果不变。
  // shell 增强会在渲染之后搬移 DOM（快捷控制条收进 details、指标卡并入服务 section），
  // 那时新建的节点还没有 inline order；搬移完成后的补应用见 watchBlockOrder。
  applyBlockOrder(page);
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

function isDefaultOrder(order) {
  return order.every((key, idx) => key === OVERVIEW_BLOCKS[idx][0]);
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
          <label class="ovb-item-main">
            <input type="checkbox" data-ovb-key="${esc(k)}" aria-label="显示${esc(l)}" ${hidden.has(k) ? '' : 'checked'}>
            <span class="ovb-item-text"><span>${esc(l)}</span><small>${esc(d)}</small></span>
          </label>
          <span class="ovb-move">
            <button type="button" data-ovb-up="${esc(k)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移${esc(l)}">▲</button>
            <button type="button" data-ovb-down="${esc(k)}" ${idx === order.length - 1 ? 'disabled' : ''} aria-label="下移${esc(l)}">▼</button>
          </span>
        </div>`;
      }).join('')}
    </div>
    <div class="ovb-foot">
      <button type="button" class="glass-btn ovb-reset" data-ovb-reset ${hidden.size || !isDefaultOrder(order) ? '' : 'disabled'}>恢复默认</button>
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
      if (reset) reset.disabled = hidden.size === 0 && isDefaultOrder(getBlockOrder());
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
        setHTML(pop, popoverHtml());
        bindPopoverControls(pop);
        // 焦点留在被移动项的同向按钮上；移到首/尾后该按钮被禁用，改落到反向按钮。
        const other = attr === 'data-ovb-up' ? 'data-ovb-down' : 'data-ovb-up';
        const same = /** @type {HTMLButtonElement|null} */ ($(`[${attr}="${key}"]`, pop));
        const fallback = /** @type {HTMLButtonElement|null} */ ($(`[${other}="${key}"]`, pop));
        (same && !same.disabled ? same : fallback)?.focus({ preventScroll: true });
      };
    });
  };
  rebindMove('data-ovb-up', -1);
  rebindMove('data-ovb-down', 1);
  $('[data-ovb-close]', pop).onclick = () => closePopover(true);
  $('[data-ovb-reset]', pop).onclick = () => {
    setHiddenBlocks([]);
    setBlockOrder(OVERVIEW_BLOCKS.map(([key]) => key));
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

let orderObserver = null;

/**
 * shell 增强在渲染之后同步搬移 DOM（快捷控制条收进新建的 details、指标卡并入服务
 * section），这些新建节点没有 inline order，搬移前算出的顺序也随之失效。这里观察
 * #page-content 的子节点变化，在搬移完成后补应用一次；离开概览页后自行断开。
 */
function watchBlockOrder(page) {
  orderObserver?.disconnect();
  orderObserver = new MutationObserver(() => {
    // 概览页之外没有这些块元素，断开观察，避免在其他页面的每次渲染里空跑。
    if (!page.isConnected || !page.querySelector(BLOCK_PROBE)) {
      orderObserver?.disconnect();
      return;
    }
    applyBlockOrder(page);
  });
  orderObserver.observe(page, { childList: true, subtree: true });
}

/**
 * 「自定义显示」入口。概览页的标题行在成品里是隐藏的（shared/workspace.js 的 finish
 * 对 overview 路由设 hidden），所以入口放在顶部工具栏，与「外观」「流光」同类；
 * 只在概览路由显示，规则见 styles/features/overview.css。
 */
function ensureTrigger() {
  const existing = /** @type {HTMLElement|null} */ (document.querySelector('[data-ovb-trigger]'));
  if (existing) return existing;
  const dock = document.querySelector('.glass-action-capsule');
  if (!dock) return null;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'icon-action-btn';
  trigger.dataset.ovbTrigger = '';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'overview-blocks-popover');
  trigger.setAttribute('aria-label', '自定义概览显示内容');
  trigger.title = '自定义概览显示内容';
  setHTML(trigger, icon('overview'));
  dock.prepend(trigger);
  return trigger;
}

/**
 * 概览每次渲染后调用：应用显隐与顺序设置，并绑定顶部工具栏的“自定义显示”入口。
 * 入口在页面外，静默刷新不会重建，但重复绑定一次没有影响；弹层本体只在首次创建。
 */
export function bindOverviewBlocks(page) {
  ensurePopover();
  applyBlockVisibility();
  watchBlockOrder(page);
  const trigger = ensureTrigger();
  if (!trigger) return;
  trigger.onclick = event => {
    event.stopPropagation();
    if (popover && !popover.hidden) closePopover();
    else openPopover(trigger);
  };
  // 弹层开着时经历静默重渲染，重建后的按钮要同步展开状态。
  if (popover && !popover.hidden) trigger.setAttribute('aria-expanded', 'true');
}
