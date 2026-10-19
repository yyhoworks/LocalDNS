import { topologyFlowService } from './flow.js';
import { setHTML } from '../../../core/security/safe-dom.ts';
import { state } from '../../../core/context.js';

  function getNodeIcon(type, color = 'currentColor') {
    const map = {
      monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
      server: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="${color}"/><circle cx="7" cy="17" r="1" fill="${color}"/></svg>`,
      dots: `<svg viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`,
      globe: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
      split: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5V12a6 6 0 0 0 6 6h3.5"/></svg>`,
      spark: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/></svg>`,
      shield: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
      shieldRed: `<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
      sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M4 8h9m4 0h3M13 6v4M4 16h3m4 0h9M7 14v4"/></svg>`
    };
    return map[type] || map.monitor;
  }

  function drawTopoCurves(edges) {
    const wrap = document.getElementById('topo-stage-wrap');
    const svg = document.getElementById('topo-svg');
    if (!wrap || !svg) return;
    topologyFlowService?.stop();

    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;
    svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

    let pathsHtml = '', dotsHtml = '';
    const dotSet = new Set();
    const addDot = (x, y, color) => {
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (dotSet.has(key)) return;
      dotSet.add(key);
      dotsHtml += `<circle class="topo-dot-halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" /><circle class="topo-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${color}" />`;
    };

    // Keep the release's center-to-center geometry; the glow is a separate visual layer.
    edges.forEach((edge, i) => {
      const fromEl = wrap.querySelector(`[data-node-id="${edge.from}"]`);
      const toEl = wrap.querySelector(`[data-node-id="${edge.to}"]`);
      if (!fromEl || !toEl) return;
      const r1 = fromEl.getBoundingClientRect(), r2 = toEl.getBoundingClientRect();
      const x1 = r1.right - wrapRect.left, y1 = r1.top + r1.height / 2 - wrapRect.top;
      const x2 = r2.left - wrapRect.left, y2 = r2.top + r2.height / 2 - wrapRect.top;
      const dx = (x2 - x1) * 0.54;
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (!edge.muted) {
        pathsHtml += `<path class="topo-halo" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" /><path class="topo-glow" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
        pathsHtml += `<path class="topo-particle" data-part-idx="${i}" d="${d}" stroke="${edge.color}" />`;
      }
      pathsHtml += `<path class="topo-edge ${edge.muted ? 'is-muted' : ''}" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
      addDot(x1, y1, edge.color);
      addDot(x2, y2, edge.color);
    });
    setHTML(svg, pathsHtml + dotsHtml);

    const nodes = wrap.querySelectorAll('.t-node');
    const applyTraceState = (startId = null) => {
      startId = state.overviewTopoLock || startId;
      const activeNodes = new Set(startId ? [startId] : []);
      const activeEdges = new Set();
      // Walk each direction independently so a selected branch doesn't light up its siblings.
      for (const upstream of [true, false]) {
        const queue = startId ? [startId] : [];
        while (queue.length) {
          const cur = queue.shift();
          edges.forEach((edge, idx) => {
            if ((upstream ? edge.to : edge.from) !== cur) return;
            const next = upstream ? edge.from : edge.to;
            activeEdges.add(idx);
            if (!activeNodes.has(next)) { activeNodes.add(next); queue.push(next); }
          });
        }
      }
      wrap.classList.toggle('has-hover', Boolean(startId));
      nodes.forEach(n => n.classList.toggle('is-active', activeNodes.has(n.dataset.nodeId)));
      svg.querySelectorAll('[data-edge-idx]').forEach(el => el.classList.toggle('is-active', activeEdges.has(+el.dataset.edgeIdx)));
      svg.querySelectorAll('[data-part-idx]').forEach(el => el.classList.toggle('is-active', activeEdges.has(+el.dataset.partIdx)));
    };
    const focusedId = () => wrap.contains(document.activeElement) ? document.activeElement.closest('.t-node')?.dataset.nodeId : null;
    nodes.forEach(node => {
      node.onmouseenter = () => applyTraceState(node.dataset.nodeId);
      node.onmouseleave = () => applyTraceState(focusedId());
      node.onfocus = () => applyTraceState(node.dataset.nodeId);
      node.onblur = event => applyTraceState(event.relatedTarget?.closest('.t-node')?.dataset.nodeId || wrap.querySelector('.t-node:hover')?.dataset.nodeId);
    });
    applyTraceState(focusedId() || wrap.querySelector('.t-node:hover')?.dataset.nodeId);
    topologyFlowService?.start(wrap, svg, edges);
  }
export { getNodeIcon, drawTopoCurves };
