// @ts-check
// 静默刷新会整页替换 DOM：刷新前记下焦点元素的稳定选择器，刷新后按顺序尝试恢复。
// Candidates, most stable first: id → data-* attributes → aria-label → structural path from the root.

/** @param {string} value */
const quote = value => `"${value.replace(/["\\]/g, '\\$&')}"`;

/** @param {Element} el @param {Element} root */
function structuralPath(el, root) {
  /** @type {string[]} */
  const parts = [];
  for (let node = /** @type {Element | null} */ (el); node && node !== root; node = node.parentElement) {
    const parent = /** @type {Element | null} */ (node.parentElement);
    if (!parent) return null;
    const tag = node.tagName.toLowerCase();
    const index = [...parent.children].filter(child => child.tagName === node?.tagName).indexOf(node) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
  }
  return parts.length ? `:scope > ${parts.join(' > ')}` : null;
}

/**
 * Selectors that should find the same control after a re-render. Empty when focus is not inside root.
 * @param {Element | null} el @param {Element} root
 * @returns {string[]}
 */
export function focusSelectors(el, root) {
  if (!el || el === root || !root.contains(el)) return [];
  const tag = el.tagName.toLowerCase();
  /** @type {string[]} */
  const selectors = [];
  if (el.id) selectors.push(`[id=${quote(el.id)}]`);
  const data = [...el.attributes].filter(attribute => attribute.name.startsWith('data-'));
  if (data.length) selectors.push(tag + data.map(attribute => `[${attribute.name}=${quote(attribute.value)}]`).join(''));
  const label = el.getAttribute('aria-label');
  if (label) selectors.push(`${tag}[aria-label=${quote(label)}]`);
  const path = structuralPath(el, root);
  if (path) selectors.push(path);
  return selectors;
}

/**
 * Focus the first selector that matches exactly one element, unless the user already moved focus elsewhere.
 * @param {string[]} selectors @param {Element} root
 * @returns {boolean} whether focus was restored
 */
export function restoreFocus(selectors, root) {
  if (!selectors.length) return false;
  const active = document.activeElement;
  // Only step in when the re-render dropped focus (to body/root); never pull focus away from the user.
  if (active && active !== document.body && active !== root && active.isConnected) return false;
  for (const selector of selectors) {
    /** @type {NodeListOf<HTMLElement>} */
    let matches;
    try { matches = root.querySelectorAll(selector); } catch { continue; }
    if (matches.length !== 1) continue;
    matches[0].focus({ preventScroll: true });
    return document.activeElement === matches[0];
  }
  return false;
}
