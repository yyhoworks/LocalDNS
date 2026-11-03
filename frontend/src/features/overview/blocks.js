// 概览页内容块的自定义显示：块定义、按浏览器持久化与设置弹层。
// 显隐走 CSS（#page-content[data-ov-hide~="key"] 隐藏对应块，规则见
// styles/features/overview.css），不改渲染结构：被隐藏的块照常渲染、
// 取数并参与 shell 增强链，避免破坏既有的 DOM 重排与事件绑定。
// 弹层挂在 body 上而不是 #page-content 里：概览页每 30 秒静默重渲染一次，
// 页面内的弹层会连带销毁；挂在页面外则不受影响，也不占用页面的焦点还原快照。
import { $, $$, storage, API_BASE } from '../../core/context.js';
import { esc } from '../../shared/format/number.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { icon, strokeIcon } from '../../shared/components/icons.js';

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

/**
 * 必须相邻、作为一个整体排序的块组。shell 增强会把指标卡并进服务 section
 * （features/shell/interface.js 的 overview()），两者在页面上是同一个 grid 子项，
 * 单独移动其中一个不会带来任何变化；因此排序以组为单位，显隐仍各自独立。
 * 组内顺序固定为这里的顺序。
 */
const BLOCK_GROUPS = [['service', 'kpi']];
const groupOf = key => BLOCK_GROUPS.find(group => group.includes(key)) || null;

/** 把顺序规整为组内成员相邻：整组放在组内最靠前成员原来的位置（兼容旧版分开存储的顺序）。 */
function normalizeOrder(order) {
  const out = [];
  const placed = new Set();
  order.forEach(key => {
    if (placed.has(key)) return;
    const members = groupOf(key) || [key];
    members.forEach(member => { if (!placed.has(member)) { placed.add(member); out.push(member); } });
  });
  return out;
}

/** 排序单元：其余块各成一组，块组整体一个单元。 */
export function orderUnits(order = getBlockOrder()) {
  const units = [];
  order.forEach(key => {
    const group = groupOf(key);
    if (group && group[0] !== key) return;
    units.push(group ? [...group] : [key]);
  });
  return units;
}
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
    return normalizeOrder(ordered);
  } catch { return defaults; }
}

export function setBlockOrder(keys) {
  const seen = new Set();
  const ordered = keys.filter(key => BLOCK_KEYS.has(key) && !seen.has(key) && (seen.add(key), true));
  OVERVIEW_BLOCKS.forEach(([key]) => { if (!seen.has(key)) ordered.push(key); });
  storage.set(orderKey(), JSON.stringify(normalizeOrder(ordered)));
}

/**
 * 把 key 所在的排序单元上移/下移一位（dir=-1 上移，+1 下移），返回是否发生移动。
 * 块组（服务状态 + 指标卡）整体移动，不会出现组内互换这种页面上无变化的空操作。
 */
export function moveBlock(key, dir) {
  const units = orderUnits();
  const idx = units.findIndex(unit => unit.includes(key));
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= units.length) return false;
  [units[idx], units[next]] = [units[next], units[idx]];
  setBlockOrder(units.flat());
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
  // 显隐/排序变化会影响布局；概览页监听 localdns:layoutchange 重画拓扑连线（SVG 连线
  // 按节点真实盒模型绘制），shell 也据此重算分段滑块。这里不再发出合成的 window
  // resize：那会让背景画布、导航栏等所有 resize 监听者整体重绘一次。
  window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
}

let popover = null;
/** 弹层打开时的视口尺寸；只有真实的视口变化才重新定位（见 bindGlobalListeners）。 */
let viewport = { width: 0, height: 0 };
const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight });
/** 触发按钮下方/上方至少要有这么多空间才贴着按钮展开，否则改为翻转或整体贴边。 */
const MIN_POPOVER_SPACE = 200;
const VIEWPORT_GAP = 12;

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
  const vh = window.innerHeight;
  // 右对齐触发按钮，同时兜底保证弹层整体留在视口内。
  const right = Math.min(Math.max(VIEWPORT_GAP, window.innerWidth - rect.right), Math.max(VIEWPORT_GAP, window.innerWidth - 324));
  popover.style.right = `${right}px`;
  // 上下方向：默认贴在按钮下方，max-height 按实际起点计算，底边始终留在视口内；
  // 按钮过于靠下时翻到上方；上下都放不下（极矮视口）就贴视口上下边。
  const top = Math.max(VIEWPORT_GAP, rect.bottom + 8);
  const below = vh - top - VIEWPORT_GAP;
  const above = rect.top - 8 - VIEWPORT_GAP;
  if (below >= MIN_POPOVER_SPACE || (below >= above && below > 0)) {
    popover.style.top = `${top}px`;
    popover.style.bottom = '';
    popover.style.maxHeight = `${below}px`;
  } else if (above >= MIN_POPOVER_SPACE) {
    popover.style.top = '';
    popover.style.bottom = `${vh - rect.top + 8}px`;
    popover.style.maxHeight = `${above}px`;
  } else {
    popover.style.top = `${VIEWPORT_GAP}px`;
    popover.style.bottom = '';
    popover.style.maxHeight = `${Math.max(0, vh - VIEWPORT_GAP * 2)}px`;
  }
}

/** 按当前视口放置弹层：窄屏停靠在顶部工具栏下方（尺寸交给 CSS），宽屏贴着触发按钮。 */
function placePopover(trigger) {
  if (matchMedia('(max-width:600px)').matches) {
    popover.classList.add('is-docked');
    popover.style.top = ''; popover.style.right = ''; popover.style.bottom = ''; popover.style.maxHeight = '';
  } else {
    popover.classList.remove('is-docked');
    positionPopover(trigger);
  }
}

function isDefaultOrder(order) {
  return order.every((key, idx) => key === OVERVIEW_BLOCKS[idx][0]);
}

function popoverHtml() {
  const hidden = new Set(getHiddenBlocks());
  const order = getBlockOrder();
  const units = orderUnits(order);
  const byKey = new Map(OVERVIEW_BLOCKS.map(b => [b[0], b]));
  const label = key => (byKey.get(key) || [key, key, ''])[1];
  // 块组渲染成一项：各自一个勾选框（显隐独立），共用一组上移/下移按钮（整体排序）。
  return `
    <div class="ovb-head">
      <strong>自定义概览显示内容</strong>
      <button type="button" class="ovb-close" data-ovb-close aria-label="关闭">${icon('close')}</button>
    </div>
    <div class="ovb-list">
      ${units.map((unit, idx) => {
        const lead = unit[0];
        const name = unit.map(label).join('与');
        const boxes = unit.map(key => {
          const [k, l, d] = byKey.get(key) || [key, key, ''];
          return `
          <label class="ovb-item-main" title="${esc(d)}">
            <input type="checkbox" data-ovb-key="${esc(k)}" aria-label="显示${esc(l)}" ${hidden.has(k) ? '' : 'checked'}>
            <span class="ovb-item-text"><span>${esc(l)}</span><small>${esc(d)}</small></span>
          </label>`;
        }).join('');
        const grouped = unit.length > 1;
        return `
        <div class="ovb-item${grouped ? ' ovb-group' : ''}"${grouped ? ` role="group" aria-label="${esc(name)}（作为整体排序）"` : ''}>
          ${grouped ? `<div class="ovb-group-main">${boxes}</div>` : boxes}
          <span class="ovb-move">
            <button type="button" data-ovb-up="${esc(lead)}" ${idx === 0 ? 'disabled' : ''} aria-label="上移${esc(name)}">▲</button>
            <button type="button" data-ovb-down="${esc(lead)}" ${idx === units.length - 1 ? 'disabled' : ''} aria-label="下移${esc(name)}">▼</button>
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
  viewport = readViewport();
  placePopover(trigger);
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
  // 页面滚动后跟随触发按钮重新定位，而不是直接收起：概览每 30 秒静默刷新后，
  // 路由会用 window.scrollTo 还原滚动位置，这类程序滚动不应关掉用户正在用的弹层。
  // 触发按钮已离开视口（或已被移除）时才收起。弹层自身列表的滚动不处理。
  window.addEventListener('scroll', event => {
    if (!popover || popover.hidden) return;
    if (event.target instanceof Node && popover.contains(event.target)) return;
    followTrigger();
  }, true);
  // 只有视口尺寸真的变化才重新定位：shell 增强链每次都会在 rAF 里发出一次合成的
  // window resize（尺寸不变），按“有 resize 就收起”处理会让静默刷新关掉弹层。
  window.addEventListener('resize', () => {
    if (!popover || popover.hidden) return;
    const next = readViewport();
    if (next.width === viewport.width && next.height === viewport.height) return;
    viewport = next;
    followTrigger();
  });
}

function followTrigger() {
  const trigger = /** @type {HTMLElement|null} */ (document.querySelector('[data-ovb-trigger]'));
  if (!trigger?.isConnected) { closePopover(); return; }
  const rect = trigger.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) { closePopover(); return; }
  placePopover(trigger);
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
  setHTML(trigger, strokeIcon('overview'));
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
