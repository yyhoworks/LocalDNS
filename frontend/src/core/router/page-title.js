// @ts-check
// 路由切换的可访问性：标签页标题跟随当前页面，非静默渲染后把焦点移到页面 h1，让读屏用户知道页面已切换。

let pageLabel = '';

/** 当前显示名称（可在“名称与 Logo”里自定义），读取顶栏品牌名，缺省 LocalDNS。 */
export function appName() {
  return (document.querySelector('.brand-name')?.textContent || '').trim() || 'LocalDNS';
}

/** 标题格式：“<页面名> · <应用名>”；尚无页面时保留“<应用名> 控制台”。 */
export function syncDocumentTitle() {
  const app = appName();
  document.title = pageLabel ? `${pageLabel} · ${app}` : `${app} 控制台`;
}

/** @param {string} label */
export function setPageLabel(label) {
  pageLabel = label;
  syncDocumentTitle();
}

/** 让页面 h1 可被程序聚焦（每次渲染都调用，静默刷新重建后焦点才能恢复到标题上）。
 * @param {ParentNode} root @returns {HTMLElement | null} */
export function markPageHeading(root) {
  const heading = /** @type {HTMLElement | null} */ (root.querySelector('h1'));
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  return heading;
}

/** @param {ParentNode} root @returns {boolean} */
export function focusPageHeading(root) {
  const heading = markPageHeading(root);
  if (!heading) return false;
  heading.focus({ preventScroll: true });
  return document.activeElement === heading;
}
