/* A local preference for the external proxy dashboard; no backend API writes. */
(() => {
  'use strict';
  const STORAGE_KEY = 'localdns-proxy-panel-v1';
  const DEFAULT = { type: 'mihomo', url: 'http://192.168.1.7:9090/ui' };
  const brands = {
    mihomo: { label: 'Mihomo', logo: 'assets/img/mihomo.png' },
    'sing-box': { label: 'sing-box', logo: 'assets/img/sing-box.svg' }
  };
  function validUrl(value) {
    const text = String(value ?? '').trim();
    if (!/^https?:\/\//i.test(text)) throw new Error('请输入以 http:// 或 https:// 开头的完整地址。');
    let url;
    try { url = new URL(text); } catch { throw new Error('面板地址格式不正确，请检查主机和端口。'); }
    if (!url.hostname || url.username || url.password) throw new Error('请使用不含用户名和密码的面板地址。');
    return url.href;
  }
  function configFrom(value) {
    if (!value || !Object.hasOwn(brands, value.type)) throw new Error('请选择面板类型。');
    return { type: value.type, url: validUrl(value.url) };
  }
  let config = { ...DEFAULT };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) config = configFrom(JSON.parse(saved));
  } catch {}

  let initialized = false;
  function setup({ notify = () => {} } = {}) {
    if (initialized) return;
    const launcher = document.querySelector('#proxy-launcher');
    const panel = document.querySelector('#proxy-panel-popover');
    if (!launcher || !panel) return;
    initialized = true;
    const opener = launcher.querySelector('button');
    const form = panel.querySelector('form');
    const field = panel.querySelector('#proxy-panel-url');
    const error = panel.querySelector('#proxy-panel-error');
    let returnFocus = opener;

    function sync() {
      const brand = brands[config.type];
      for (const item of document.querySelectorAll('[data-proxy-panel-link]')) {
        item.href = config.url;
        item.title = '打开 ' + brand.label + ' 面板 · ' + config.url;
        item.setAttribute('aria-label', '打开 ' + brand.label + ' 面板（新标签页）');
        const image = item.querySelector('img');
        if (image) image.src = brand.logo;
      }
      for (const item of document.querySelectorAll('[data-proxy-panel-name]')) item.textContent = brand.label + ' 面板';
      for (const item of document.querySelectorAll('[data-proxy-panel-address]')) item.textContent = config.url;
    }
    function place() {
      if (panel.hidden) return;
      const rect = launcher.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
      const width = viewport?.width || document.documentElement.clientWidth;
      const height = viewport?.height || innerHeight;
      panel.style.maxHeight = Math.max(120, height - 24) + 'px';
      panel.style.left = Math.max(left + 12, Math.min(left + width - panel.offsetWidth - 12, rect.right - panel.offsetWidth)) + 'px';
      panel.style.top = Math.max(top + 12, Math.min(rect.bottom + 12, top + height - panel.offsetHeight - 12)) + 'px';
    }
    function close(restore = true) {
      if (panel.hidden) return;
      panel.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
      if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    }
    function open(origin = opener) {
      if (document.querySelector('#bg-customizer-popover')?.classList.contains('open')) {
        document.querySelector('#btn-close-bg-popover')?.click();
        queueMicrotask(() => open(origin));
        return;
      }
      returnFocus = origin;
      error.hidden = true;
      field.removeAttribute('aria-invalid');
      field.value = config.url;
      for (const input of form.elements['proxy-panel-type']) input.checked = input.value === config.type;
      panel.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      place();
      panel.querySelector('input:checked').focus({ preventScroll: true });
    }
    opener.addEventListener('click', () => panel.hidden ? open() : close());
    panel.querySelectorAll('[data-proxy-panel-close]').forEach(button => button.addEventListener('click', () => close()));
    form.addEventListener('submit', event => {
      event.preventDefault();
      error.hidden = true;
      field.removeAttribute('aria-invalid');
      let next;
      try { next = configFrom({ type: form.elements['proxy-panel-type'].value, url: field.value }); }
      catch (failure) {
        error.textContent = failure.message;
        error.hidden = false;
        field.setAttribute('aria-invalid', 'true');
        field.focus();
        place();
        return;
      }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch {
        error.textContent = '设置未保存，请允许浏览器保存此站点的数据后重试。';
        error.hidden = false;
        place();
        return;
      }
      config = next;
      sync();
      close();
      notify('代理面板设置已保存');
    });
    field.addEventListener('input', () => { error.hidden = true; field.removeAttribute('aria-invalid'); });
    document.addEventListener('click', event => {
      const settings = event.target.closest('[data-proxy-panel-settings]');
      if (settings) { open(settings); return; }
      if (!panel.hidden && !panel.contains(event.target) && !launcher.contains(event.target)) close(false);
    });
    document.addEventListener('keydown', event => {
      if (!panel.hidden && event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      }
    }, true);
    document.addEventListener('focusin', event => {
      if (!panel.hidden && !panel.contains(event.target) && !launcher.contains(event.target)) close(false);
    });
    window.addEventListener('resize', place, { passive: true });
    window.addEventListener('scroll', place, { passive: true });
    window.visualViewport?.addEventListener('resize', place, { passive: true });
    window.visualViewport?.addEventListener('scroll', place, { passive: true });
    window.addEventListener('hashchange', () => close(false));
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try { config = event.newValue ? configFrom(JSON.parse(event.newValue)) : { ...DEFAULT }; }
      catch { return; }
      sync(); close(false);
    });
    window.LocalDNSProxyPanel.sync = sync;
    sync();
  }
  window.LocalDNSProxyPanel = { setup, sync() {} };
})();
