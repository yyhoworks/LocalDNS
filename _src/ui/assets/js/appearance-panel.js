/* Organize the existing controls without replacing their values or handlers. */
(() => {
  'use strict';
  function setup() {
    const panel = document.querySelector('#bg-customizer-popover');
    if (!panel || panel.querySelector('.appearance-tabs')) return;
    panel.classList.add('appearance-panel');
    const title = panel.querySelector('.bcp-title');
    title.id = 'appearance-title';
    panel.setAttribute('aria-labelledby', title.id);
    const tabs = document.createElement('div');
    tabs.className = 'appearance-tabs'; tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '外观设置分栏');
    const content = document.createElement('div'); content.className = 'appearance-content';
    const definitions = [['theme', '主题背景'], ['material', '材质与布局'], ['brand', '品牌与字体']];
    const panes = new Map();
    for (const [key, label] of definitions) {
      const button = document.createElement('button');
      button.type = 'button'; button.id = 'appearance-tab-' + key;
      button.className = 'appearance-tab'; button.dataset.appearanceTab = key;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'appearance-pane-' + key);
      button.textContent = label; tabs.append(button);
      const pane = document.createElement('section');
      pane.id = 'appearance-pane-' + key; pane.className = 'appearance-pane';
      pane.setAttribute('role', 'tabpanel'); pane.setAttribute('aria-labelledby', button.id);
      panes.set(key, pane); content.append(pane);
    }
    title.after(tabs, content);
    const move = (selector, key) => { const element = panel.querySelector(selector); if (element) panes.get(key).append(element); };
    const group = (id, name, key) => {
      const element = document.createElement('div'); element.className = 'bcp-group'; element.id = id;
      const heading = document.createElement('div'); heading.className = 'bcp-group-title'; heading.textContent = name;
      element.append(heading); panes.get(key).append(element); return element;
    };
    move('#bcp-group-skin', 'theme');
    move('#bcp-group-claude', 'theme');
    move('#bcp-group-glass-bg', 'theme');
    move('#bcp-group-navigation', 'material');
    move('#bcp-group-glass-material', 'material');
    const paper = group('bcp-group-paper-material', '纸张质感', 'material');
    paper.dataset.appearanceSkin = 'claude';
    for (const id of ['slider-paper-grain', 'slider-paper-warmth']) {
      const row = panel.querySelector('#' + id)?.closest('.bcp-row'); if (row) paper.append(row);
    }
    const geometry = group('bcp-group-geometry', '界面形态', 'material');
    const radius = panel.querySelector('#slider-radius')?.closest('.bcp-row'); if (radius) geometry.append(radius);
    move('#bcp-group-interface', 'brand');
    move('.bcp-fonts', 'brand');
    move('.shared-ui-settings','brand');

    panel.querySelectorAll('.bcp-row:has(input[type=range])').forEach(row => {
      const label = row.querySelector('label'), slider = row.querySelector('input[type=range]'), value = row.querySelector('strong');
      if (!label || !slider || !value) return;
      row.classList.add('appearance-slider'); row.replaceChildren(label, slider, value);
    });
    for (const [id, text] of [['slider-blur','模糊半径'],['slider-alpha','面板遮盖度'],['slider-dimmer','背景暗化'],['slider-paper-grain','纸张肌理'],['slider-paper-warmth','温润层次']]) {
      const label = panel.querySelector(`label[for="${id}"]`);
      if (label) { label.title = label.textContent; label.textContent = text; }
    }
    panel.querySelector('label[for="bg-url-input"]')?.parentElement.classList.add('appearance-visually-hidden');
    panel.querySelector('#bg-url-input')?.setAttribute('placeholder', '在线图片 URL（https://…）');
    const verRow = panel.querySelector('#select-brand-ver')?.closest('.bcp-row');
    if (verRow) {
      verRow.classList.add('appearance-select');
      const label = verRow.querySelector('label'), select = verRow.querySelector('select');
      const value = verRow.querySelector('#val-brand-ver'), input = verRow.querySelector('#input-brand-ver');
      const fields = document.createElement('div'); fields.className = 'appearance-select-fields';
      fields.append(select, input);
      input.setAttribute('aria-label', '自定义版本标签文字');
      value.classList.add('appearance-visually-hidden'); verRow.replaceChildren(label, fields, value);
    }
    const uploadRow = panel.querySelector('#btn-font-upload')?.closest('.bcp-row');
    if (uploadRow) {
      uploadRow.classList.add('appearance-upload');
      const heading = uploadRow.querySelector('.bcp-row-head'), actions = uploadRow.querySelector('.bcp-inline');
      const status = heading.querySelector('#val-font-upload');
      heading.querySelector('span').textContent = '自定义字体';
      heading.append(status, actions);
    }
    const fonts = panel.querySelector('.bcp-fonts');
    if (fonts) {
      const notes = [...fonts.querySelectorAll('.font-note')];
      const help = document.createElement('details'); help.className = 'appearance-font-help';
      const summary = document.createElement('summary'); summary.textContent = '字体说明与上传限制';
      help.append(summary, ...notes); fonts.querySelector('#typography-save-status')?.before(help);
    }
    panel.querySelectorAll('#bcp-group-glass-bg .bcp-inline').forEach(row => row.classList.add('appearance-inline'));
    panel.querySelector('.identity-settings')?.addEventListener('toggle', () => { content.scrollTop = 0; });
    let selected = 'theme';
    function select(key, focus = false) {
      if (!panes.has(key)) return;
      selected = key; content.scrollTop = 0;
      for (const [id, pane] of panes) { pane.hidden = id !== key; pane.inert = id !== key; }
      tabs.querySelectorAll('button').forEach(button => {
        const active = button.dataset.appearanceTab === key;
        button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
        if (active && focus) button.focus();
      });
    }
    tabs.addEventListener('click', event => { const button = event.target.closest('[data-appearance-tab]'); if (button) select(button.dataset.appearanceTab); });
    tabs.addEventListener('keydown', event => {
      const keys = definitions.map(([key]) => key), index = keys.indexOf(selected);
      let next;
      if (event.key === 'ArrowRight') next = keys[(index + 1) % keys.length];
      if (event.key === 'ArrowLeft') next = keys[(index + keys.length - 1) % keys.length];
      if (event.key === 'Home') next = keys[0]; if (event.key === 'End') next = keys.at(-1);
      if (next) { event.preventDefault(); event.stopPropagation(); select(next, true); }
    });
    select('theme');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
