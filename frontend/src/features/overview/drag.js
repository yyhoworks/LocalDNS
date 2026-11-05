import { setHTML } from '../../core/security/safe-dom.ts';

export const overviewGrip = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg>';

/** Pointer sorting only previews CSS order; persistence happens once, on drop. */
export function createOverviewDrag(page, { nodes, order, preview, commit, hide }) {
  let locked = true, drag = null, suppressUntil = 0;
  const listeners = [];
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const same = (a, b) => a.join('|') === b.join('|');
  const visible = () => nodes().filter(({ element }) => element.getClientRects().length && getComputedStyle(element).display !== 'none');

  function finish(cancel = false) {
    if (!drag) return;
    const current = drag; drag = null;
    clearTimeout(current.timer); cancelAnimationFrame(current.frame);
    current.ghost?.remove();
    current.element.classList.remove('ov-is-dragging');
    current.handle.setAttribute('aria-grabbed', 'false');
    delete page.dataset.overviewDragging;
    document.body.classList.remove('ov-pointer-dragging');
    if (current.handle.hasPointerCapture?.(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    if (cancel || !current.started) preview(order());
    else if (!same(current.before, current.next)) commit(current.next, current.before);
    if (current.started) {
      suppressUntil = Date.now() + 350;
      if (current.handle.isConnected) current.handle.focus({ preventScroll: true });
    }
  }

  function targetAtPointer() {
    if (!drag?.started) return;
    if (!drag.element.isConnected || locked) { finish(true); return; }
    drag.ghost.style.left = `${Math.max(8, Math.min(innerWidth - 240, drag.x + 16))}px`;
    drag.ghost.style.top = `${Math.max(8, Math.min(innerHeight - 48, drag.y + 12))}px`;
    const candidates = visible();
    const hit = document.elementsFromPoint(drag.x, drag.y).map(el => candidates.find(node => node.element === el || node.element.contains(el))).find(Boolean);
    if (!hit || hit.key === drag.key) return;
    const rect = hit.element.getBoundingClientRect(), own = drag.element.getBoundingClientRect();
    const sameRow = Math.abs(own.top - rect.top) < 24 && own.width < page.clientWidth * .9 && rect.width < page.clientWidth * .9;
    const after = sameRow ? drag.x > rect.left + rect.width / 2 : drag.y > rect.top + rect.height / 2;
    const signature = hit.key + ':' + after;
    if (signature === drag.lastTarget) return;
    drag.lastTarget = signature;
    const next = drag.next.filter(key => key !== drag.key);
    next.splice(next.indexOf(hit.key) + (after ? 1 : 0), 0, drag.key);
    if (!same(next, drag.next)) { drag.next = next; preview(next); }
  }

  function begin() {
    if (!drag || locked || !drag.element.isConnected) { finish(true); return; }
    drag.started = true;
    drag.element.classList.add('ov-is-dragging');
    drag.handle.setAttribute('aria-grabbed', 'true');
    page.dataset.overviewDragging = 'true';
    document.body.classList.add('ov-pointer-dragging');
    const ghost = document.createElement('div'); ghost.className = 'ov-drag-ghost';
    setHTML(ghost, overviewGrip); ghost.append(document.createTextNode(drag.label));
    ghost.setAttribute('aria-hidden', 'true'); document.body.append(ghost); drag.ghost = ghost;
    let previousTime = 0;
    const frame = time => {
      if (!drag?.started) return;
      const delta = previousTime ? Math.min(32, time - previousTime) : 16;
      previousTime = time;
      const edge = 90;
      const speed = drag.y < edge ? -Math.min(1, (edge - drag.y) / edge) : drag.y > innerHeight - edge ? Math.min(1, (drag.y - innerHeight + edge) / edge) : 0;
      if (speed) { window.scrollBy(0, speed * delta * .9); targetAtPointer(); }
      if (drag) drag.frame = requestAnimationFrame(frame);
    };
    targetAtPointer(); drag.frame = requestAnimationFrame(frame);
  }

  listen(page, 'pointerdown', event => {
    const handle = event.target.closest?.('[data-ov-drag]');
    if (!handle || locked || event.button !== 0 || event.isPrimary === false || drag) return;
    const node = nodes().find(item => item.key === handle.dataset.ovDrag);
    if (!node) return;
    const before = order();
    drag = { ...node, handle, pointer: event.pointerId, before, next: [...before], x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, touch: event.pointerType === 'touch', started: false };
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
    event.preventDefault(); targetAtPointer();
  }, { passive: false });
  listen(document, 'pointerup', event => { if (drag && event.pointerId === drag.pointer) finish(); });
  listen(document, 'pointercancel', event => { if (drag && event.pointerId === drag.pointer) finish(true); });
  listen(page, 'lostpointercapture', event => { if (drag && event.pointerId === drag.pointer) finish(true); });
  listen(window, 'blur', () => finish(true));
  listen(document, 'visibilitychange', () => { if (document.hidden) finish(true); });
  listen(document, 'keydown', event => {
    if (event.key === 'Escape' && drag) { finish(true); event.preventDefault(); event.stopPropagation(); return; }
    const handle = event.target.closest?.('[data-ov-drag]');
    if (!handle || !page.contains(handle) || locked || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const before = order(), shown = new Set(visible().map(node => node.key));
    const keys = before.filter(key => shown.has(key)), from = keys.indexOf(handle.dataset.ovDrag);
    const to = from + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
    if (from < 0 || to < 0 || to >= keys.length) return;
    const next = [...before], a = next.indexOf(keys[from]), b = next.indexOf(keys[to]);
    [next[a], next[b]] = [next[b], next[a]];
    commit(next, before); handle.focus({ preventScroll: true });
  });
  listen(page, 'click', event => {
    if (event.target.closest('[data-ov-drag]') || (Date.now() < suppressUntil && event.target.closest('[data-ov-unit]'))) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  function sync() {
    if (drag && !drag.element.isConnected) finish(true);
    // Wait until the shell has merged service status and KPIs into one unit.
    if (page.querySelector('.spark-kpi-card') && !page.querySelector('.console-kpi-row')) return;
    for (const { key, label, element } of nodes()) {
      element.dataset.ovUnit = key;
      let bar = element.querySelector(':scope > .ov-drag-controls, :scope > summary > .ov-drag-controls');
      if (!bar) {
        bar = document.createElement('div'); bar.className = 'ov-drag-controls';
        const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'ov-drag-handle'; handle.dataset.ovDrag = key;
        setHTML(handle, overviewGrip); handle.append(document.createTextNode(label));
        handle.setAttribute('aria-label', `拖动${label}，方向键排序`); handle.setAttribute('aria-grabbed', 'false');
        const hideButton = document.createElement('button'); hideButton.type = 'button'; hideButton.className = 'ov-hide-block'; hideButton.textContent = '隐藏'; hideButton.setAttribute('aria-label', `隐藏${label}`);
        hideButton.onclick = event => { event.preventDefault(); event.stopPropagation(); if (!locked) hide(key); };
        bar.append(handle, hideButton);
        if (element.matches('details')) element.querySelector('summary')?.append(bar); else element.prepend(bar);
      }
      bar.querySelector('[data-ov-drag]').disabled = locked;
    }
  }
  return {
    sync,
    setLocked(value) { finish(true); locked = value; page.dataset.overviewEditing = String(!locked); sync(); },
    dispose() { finish(true); listeners.forEach(remove => remove()); page.querySelectorAll('.ov-drag-controls').forEach(el => el.remove()); delete page.dataset.overviewEditing; page.querySelectorAll('[data-ov-unit]').forEach(el => delete el.dataset.ovUnit); }
  };
}
