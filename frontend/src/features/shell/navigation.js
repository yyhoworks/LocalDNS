import { setHTML } from '../../core/security/safe-dom.ts';
import { preferences } from '../../core/persistence/preferences.ts';
export function initialize() {

  'use strict';
  const root = document.documentElement;
  const storageKey = 'localdns-navigation-v1';
  let prefs = { mode: 'left', collapsed: false };
  try {
    const saved = JSON.parse(preferences.getItem(storageKey) || 'null');
    if (saved && typeof saved === 'object') {
      prefs.mode = saved.mode === 'top' ? 'top' : 'left';
      prefs.collapsed = saved.collapsed === true;
    }
  } catch {}
  const applyPreference = () => {
    root.dataset.nav = prefs.mode === 'top' ? 'top' : prefs.collapsed ? 'collapsed' : 'left';
  };
  applyPreference();

  function setup() {
    const sidebar = document.querySelector('#sidebar');
    const nav = document.querySelector('#side-nav');
    const bar = document.querySelector('.navbar-content');
    const shell = document.querySelector('.shell-grid');
    const panel = document.querySelector('#bg-customizer-popover');
    if (!sidebar || !nav || !bar || !shell || !panel) return;
    const desktop = matchMedia('(min-width: 901px)');
    const collapseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m5-10-2 2 2 2"/></svg>';
    const tools = document.createElement('div');
    tools.className = 'navigation-tools';
    setHTML(tools, `<span>控制台</span><button type="button" id="navigation-collapse" aria-controls="side-nav">${collapseIcon}</button>`);
    sidebar.prepend(tools);
    const collapseButton = tools.querySelector('button');
    const picker = document.querySelector('#navigation-layout-options');
    const entries = [...nav.querySelectorAll('[data-route]')];
    entries.forEach(button => {
      const label = button.textContent.trim();
      button.setAttribute('aria-label', label);
      button.title = label;
    });

    function syncSelection() {
      entries.forEach(button => {
        if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }

    function syncLayout() {
      const horizontal = desktop.matches && prefs.mode === 'top';
      if (horizontal) {
        if (sidebar.parentElement !== bar) bar.insertBefore(sidebar, bar.querySelector('.top-main-bar'));
      } else if (sidebar.parentElement !== shell) shell.prepend(sidebar);
      const collapsed = prefs.mode === 'left' && prefs.collapsed;
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
      collapseButton.setAttribute('aria-label', collapsed ? '展开左侧导航' : '折叠左侧导航');
      collapseButton.title = collapseButton.getAttribute('aria-label');
      picker?.querySelectorAll('[data-navigation-layout]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.navigationLayout === prefs.mode));
      });
      // Layout changes do not rerender the page or discard rule drafts.
      window.dispatchEvent(new CustomEvent('localdns:layoutchange'));
    }

    function chooseLayout(mode, collapsed = prefs.collapsed) {
      if (!['left', 'top'].includes(mode)) return;
      prefs = { mode, collapsed };
      applyPreference();
      try { preferences.setItem(storageKey, JSON.stringify(prefs)); } catch {}
      syncLayout();
    }
    collapseButton.onclick = () => chooseLayout('left', !prefs.collapsed);
    picker?.querySelectorAll('[data-navigation-layout]').forEach(button => {
      button.onclick = () => chooseLayout(button.dataset.navigationLayout, false);
    });
    new MutationObserver(syncSelection).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    desktop.addEventListener('change', syncLayout);

    // A body-level panel stays reachable outside both the floating and fixed header.
    document.body.append(panel);
    panel.classList.add('navigation-appearance-panel');
    const appearanceButton = document.querySelector('#btn-open-bg-customizer');
    let wasOpen = false;
    function syncPanel() {
      const open = panel.classList.contains('open');
      panel.inert = !open;
      appearanceButton?.setAttribute('aria-expanded', String(open));
      if (open && !wasOpen) document.querySelector('#btn-close-bg-popover')?.focus({ preventScroll: true });
      else if (!open && wasOpen && !document.querySelector('dialog[open],#drawer.open')) appearanceButton?.focus({ preventScroll: true });
      wasOpen = open;
    }
    new MutationObserver(syncPanel).observe(panel, { attributes: true, attributeFilter: ['class'] });
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        panel.classList.remove('open');
        event.preventDefault();
        event.stopPropagation();
      }
    });
    syncLayout();
    syncSelection();
    syncPanel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();

}
