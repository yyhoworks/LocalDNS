import { setHTML } from '../../core/security/safe-dom.ts';
import { overviewGrip } from './drag.js';

/** Preview via CSS order, preserving pointer capture; save only on drop. */
export function createOverviewListDrag(popover, { locked, order, preview, commit }) {
  const list = popover.querySelector('.ovb-list');
  const rows = [...list.querySelectorAll('[data-ovb-unit]')];
  const listeners = [];
  let drag = null, suppressUntil = 0;
  const same = (a, b) => a.join('|') === b.join('|');
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  function paint(keys) {
    rows.forEach(row => { row.style.order = String(keys.indexOf(row.dataset.ovbUnit)); });
    preview(keys);
  }
  function finish(cancel = false) {
    if (!drag) return;
    const current = drag; drag = null;
    clearTimeout(current.timer); cancelAnimationFrame(current.frame);
    current.ghost?.remove(); current.row.classList.remove('ovb-dragging');
    current.handle.setAttribute('aria-grabbed', 'false');
    delete popover.dataset.sorting;
    if (current.handle.hasPointerCapture?.(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    if (current.started) suppressUntil = Date.now() + 350;
    if (cancel || !current.started || same(current.before, current.next)) paint(order());
    else commit(current.next, current.before);
    if (current.started && popover.isConnected && !popover.hidden) popover.querySelector(`[data-ovb-drag="${current.key}"]`)?.focus({ preventScroll:true });
  }
  function updateTarget() {
    if (!drag?.started) return;
    if (locked() || !list.isConnected || popover.hidden) { finish(true); return; }
    const bounds = popover.getBoundingClientRect();
    drag.ghost.style.left = `${Math.max(8, Math.min(innerWidth - drag.ghost.offsetWidth - 8, bounds.left + 10))}px`;
    drag.ghost.style.top = `${Math.max(8, Math.min(innerHeight - 44, drag.y + 12))}px`;
    if (drag.x < bounds.left - 20 || drag.x > bounds.right + 20) return;
    const target = rows.find(row => {
      if (row === drag.row) return false;
      const rect = row.getBoundingClientRect();
      return drag.y >= rect.top && drag.y <= rect.bottom;
    });
    if (!target) return;
    const rect = target.getBoundingClientRect(), after = drag.y >= rect.top + rect.height / 2;
    const signature = target.dataset.ovbUnit + ':' + after;
    if (signature === drag.lastTarget) return;
    drag.lastTarget = signature;
    const next = drag.next.filter(key => key !== drag.key);
    next.splice(next.indexOf(target.dataset.ovbUnit) + (after ? 1 : 0), 0, drag.key);
    if (!same(next, drag.next)) { drag.next = next; paint(next); }
  }
  function begin() {
    if (!drag || locked() || !list.isConnected || popover.hidden) { finish(true); return; }
    drag.started = true; popover.dataset.sorting = 'true';
    drag.row.classList.add('ovb-dragging'); drag.handle.setAttribute('aria-grabbed', 'true');
    drag.ghost = document.createElement('div'); drag.ghost.className = 'ov-drag-ghost ovb-drag-ghost';
    drag.ghost.setAttribute('aria-hidden', 'true'); setHTML(drag.ghost, overviewGrip);
    drag.ghost.append(document.createTextNode(drag.handle.dataset.ovbLabel)); document.body.append(drag.ghost);
    updateTarget();
    let previousTime = 0;
    const frame = time => {
      if (!drag?.started) return;
      const delta = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = time;
      const bounds = popover.getBoundingClientRect(), edge = 64;
      const speed = drag.y < bounds.top + edge ? -Math.min(1, (bounds.top + edge - drag.y) / edge)
        : drag.y > bounds.bottom - edge ? Math.min(1, (drag.y - bounds.bottom + edge) / edge) : 0;
      if (speed) { popover.scrollTop += speed * delta * .65; updateTarget(); }
      if (drag) drag.frame = requestAnimationFrame(frame);
    };
    if (drag) drag.frame = requestAnimationFrame(frame);
  }
  listen(list, 'pointerdown', event => {
    const handle = event.target.closest?.('[data-ovb-drag]');
    if (!handle || locked() || event.button !== 0 || event.isPrimary === false || drag) return;
    const before = order();
    drag = { key:handle.dataset.ovbDrag, row:handle.closest('[data-ovb-unit]'), handle, pointer:event.pointerId,
      before, next:[...before], x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, touch:event.pointerType === 'touch', started:false };
    handle.setPointerCapture?.(event.pointerId);
    if (drag.touch) drag.timer = setTimeout(begin, 160);
    event.preventDefault(); event.stopPropagation();
  });
  listen(document, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 7) return;
      if (drag.touch) { finish(true); return; }
      begin();
    }
    event.preventDefault(); updateTarget();
  }, { passive:false });
  listen(document, 'pointerup', event => { if (drag && event.pointerId === drag.pointer) finish(); });
  listen(document, 'pointercancel', event => { if (drag && event.pointerId === drag.pointer) finish(true); });
  listen(popover, 'lostpointercapture', event => { if (drag && event.pointerId === drag.pointer) finish(true); });
  listen(window, 'blur', () => finish(true));
  listen(document, 'visibilitychange', () => { if (document.hidden) finish(true); });
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); return; }
    const handle = event.target.closest?.('[data-ovb-drag]');
    if (!handle || !popover.contains(handle) || locked() || !['ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const before = order(), from = before.indexOf(handle.dataset.ovbDrag), to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= before.length) return;
    const next = [...before]; [next[from], next[to]] = [next[to], next[from]];
    commit(next, before);
    popover.querySelector(`[data-ovb-drag="${handle.dataset.ovbDrag}"]`)?.focus({ preventScroll:true });
  }, true);
  listen(popover, 'click', event => {
    if (event.target.closest?.('[data-ovb-drag]') || Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  return { dispose() { finish(true); listeners.forEach(remove => remove()); } };
}
