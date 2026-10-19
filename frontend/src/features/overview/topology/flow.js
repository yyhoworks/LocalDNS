export let topologyFlowService;
export function initialize() {

  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let current = null;

  function stop() {
    current?.dispose();
    current = null;
  }

  function start(wrap, svg, edges) {
    stop();
    const paths = new Map();
    const outgoing = new Map();
    edges.forEach((edge, index) => {
      const path = svg.querySelector(`.topo-edge[data-edge-idx="${index}"]`);
      if (edge.muted || !path) return;
      paths.set(index, path);
      if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
      outgoing.get(edge.from).push({ ...edge, index });
    });
    const starts = [...outgoing.keys()].filter(id => /^c\d+$/.test(id));
    if (!starts.length) return;
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cursor.setAttribute('class', 'topo-cursor');
    cursor.setAttribute('r', '3.1');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.opacity = '0';
    svg.append(cursor);
    let frame = 0, disposed = false, hops = [], hopIndex = 0, started = null, restUntil = 0;
    let hovering = false, focused = false;
    const observer = new MutationObserver(sync);
    observer.observe(wrap, { attributes: true, attributeFilter: ['class'] });
    const canPlay = () => !disposed && wrap.isConnected && !document.hidden && !reduce.matches &&
      !wrap.classList.contains('no-particles') && !wrap.classList.contains('has-hover') && !hovering && !focused;
    function clear() {
      cursor.style.opacity = '0';
      svg.querySelectorAll('.is-flow').forEach(el => el.classList.remove('is-flow'));
      wrap.querySelectorAll('.is-pulse').forEach(el => el.classList.remove('is-pulse'));
      hops = []; hopIndex = 0; started = null; restUntil = 0;
    }
    function pickPath() {
      // This tour is a topology illustration, never a claim about an individual DNS request.
      let node = starts[Math.floor(Math.random() * starts.length)];
      const visited = new Set([node]);
      const result = [];
      for (let count = 0; count < 8; count++) {
        const choices = (outgoing.get(node) || []).filter(edge => !visited.has(edge.to));
        if (!choices.length) break;
        const edge = choices[Math.floor(Math.random() * choices.length)];
        result.push(edge); visited.add(edge.to); node = edge.to;
      }
      return result;
    }
    function pulse(id) {
      wrap.querySelectorAll('.is-pulse').forEach(el => el.classList.remove('is-pulse'));
      wrap.querySelector(`[data-node-id="${id}"]`)?.classList.add('is-pulse');
    }
    function tick(now) {
      frame = 0;
      if (!canPlay()) { clear(); return; }
      if (restUntil) {
        if (now < restUntil) { frame = requestAnimationFrame(tick); return; }
        clear();
      }
      if (!hops.length) { hops = pickPath(); if (!hops.length) return; }
      const hop = hops[hopIndex], path = paths.get(hop.index);
      if (started === null) {
        started = now; pulse(hop.from);
        svg.querySelectorAll(`[data-edge-idx="${hop.index}"]`).forEach(el => el.classList.add('is-flow'));
      }
      const progress = Math.min(1, (now - started) / 560);
      const point = path.getPointAtLength(path.getTotalLength() * progress);
      cursor.setAttribute('cx', point.x.toFixed(1)); cursor.setAttribute('cy', point.y.toFixed(1));
      cursor.style.opacity = '';
      if (progress === 1) {
        started = null; hopIndex++;
        if (hopIndex === hops.length) { pulse(hop.to); cursor.style.opacity = '0'; restUntil = now + 1400; }
      }
      frame = requestAnimationFrame(tick);
    }
    function sync() {
      if (!canPlay()) { cancelAnimationFrame(frame); frame = 0; clear(); }
      else if (!frame) frame = requestAnimationFrame(tick);
    }
    const enter = () => { hovering = true; sync(); };
    const leave = () => { hovering = false; sync(); };
    const focus = () => { focused = true; sync(); };
    const blur = event => { focused = wrap.contains(event.relatedTarget); sync(); };
    wrap.addEventListener('pointerenter', enter); wrap.addEventListener('pointerleave', leave);
    wrap.addEventListener('focusin', focus); wrap.addEventListener('focusout', blur);
    document.addEventListener('visibilitychange', sync); reduce.addEventListener('change', sync);
    current = { sync, dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); clear(); cursor.remove();
      wrap.removeEventListener('pointerenter', enter); wrap.removeEventListener('pointerleave', leave);
      wrap.removeEventListener('focusin', focus); wrap.removeEventListener('focusout', blur);
      document.removeEventListener('visibilitychange', sync); reduce.removeEventListener('change', sync);
    } };
    sync();
  }
  topologyFlowService = { start, stop, sync: () => current?.sync() };

}
