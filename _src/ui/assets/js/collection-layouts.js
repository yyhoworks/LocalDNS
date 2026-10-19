/* Local presentation preferences. Existing elements and business handlers are retained. */
(() => {
  'use strict';
  const definitions = [
    { key:'diversion', name:'在线分流规则', selector:'.workspace-rule-filter', fallback:'cards' },
    { key:'adguard', name:'广告订阅', selector:'.adguard-rules-table', fallback:'list' },
    { key:'logs', name:'查询日志', selector:'.workspace-log-table', fallback:'list' },
    { key:'upstreams', name:'DNS 上游', selector:'.workspace-upstream-groups', fallback:'list' },
    { key:'caches', name:'缓存管理', selector:'.management-cache-grid,.data-cache-grid', fallback:'cards' },
    { key:'features', name:'功能开关', selector:'.management-feature-grid', fallback:'cards' }
  ];
  const paths = {cards:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>'};
  const mobile = window.matchMedia('(max-width:600px)');
  let preferences = {}, storageKey, toast, observer, scheduled = false;
  function apply(root, definition, controls) {
    const layout = preferences[definition.key] || (mobile.matches ? 'cards' : definition.fallback);
    root.dataset.collectionLayout = layout;
    root.querySelectorAll('[data-collection-view]').forEach(view => {
      view.hidden = view.dataset.collectionView !== layout;
    });
    controls.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.layout === layout));
    });
  }
  function scan() {
    const page = document.querySelector('#page-content');
    if (!page) return;
    definitions.forEach(definition => {
      const target = page.querySelector(definition.selector);
      if (!target) return;
      const root = definition.key === 'upstreams' ? target.parentElement : target.closest('.card');
      if (!root || root.dataset.collectionKind) return;
      const header = definition.key === 'upstreams' ? page.querySelector('.view-title-row') : root.querySelector('.card-header');
      if (!header) return;
      root.classList.add('collection-surface');
      root.dataset.collectionKind = definition.key;
      const controls = document.createElement('div');
      controls.className = 'collection-switch';
      controls.dataset.collectionControl = definition.key;
      controls.setAttribute('role', 'group');
      controls.setAttribute('aria-label', definition.name + '排列');
      controls.innerHTML = ['cards','list'].map(layout => '<button type="button" data-layout="' + layout + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[layout] + '</svg><span>' + (definition.key === 'diversion' ? (layout === 'cards' ? '分组卡片' : '表格列表') : (layout === 'cards' ? '卡片' : '列表')) + '</span></button>').join('');
      let actions = header.querySelector('.card-actions,.cache-header-actions');
      if (!actions && definition.key !== 'upstreams') {
        actions = document.createElement('div');
        actions.className = 'card-actions';
        header.append(actions);
      }
      if (actions) actions.prepend(controls); else header.prepend(controls);
      root.querySelectorAll('table').forEach(table => {
        table.classList.add('collection-table');
        table.setAttribute('role', 'table');
        const labels = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(row => {
          row.setAttribute('role', 'row');
          if (row.children.length === 1 && row.firstElementChild.colSpan > 1) row.classList.add('collection-empty-row');
          [...row.children].forEach((cell,index) => {
            cell.dataset.label = labels[index] || '';
            cell.setAttribute('role', 'cell');
          });
        });
      });
      controls.addEventListener('click', event => {
        const button = event.target.closest('button[data-layout]');
        if (!button || !controls.contains(button)) return;
        preferences[definition.key] = button.dataset.layout;
        apply(root, definition, controls);
        try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
        catch { toast?.('排列已切换，浏览器无法保存偏好','error'); }
        window.dispatchEvent(new Event('localdns:collectionlayoutchange'));
      });
      apply(root, definition, controls);
    });
  }
  function setup(options) {
    storageKey = 'localdns-collection-layouts-v1:' + (options.apiBase || location.host);
    toast = options.toast;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      definitions.forEach(({key}) => { if (saved && ['cards','list'].includes(saved[key])) preferences[key] = saved[key]; });
    } catch {}
    const page = document.querySelector('#page-content');
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; scan(); });
    });
    observer.observe(page, { childList:true, subtree:true });
    mobile.addEventListener('change', () => definitions.forEach(definition => {
      if (preferences[definition.key]) return;
      const root = page.querySelector('[data-collection-kind="' + definition.key + '"]');
      const controls = page.querySelector('[data-collection-control="' + definition.key + '"]');
      if (root && controls) apply(root, definition, controls);
    }));
    scan();
  }
  window.LocalDNSCollections = { setup };
})();
