/* Shared external dashboard settings, persisted on the LocalDNS server. */
(() => {
  'use strict';
  const STORAGE_KEY = 'localdns-proxy-panel-v1';
  const identity = window.LocalDNSIdentity;
  const DEFAULT = { name: '代理面板', logo: '', url: 'http://192.168.1.7:9090/ui' };
  function validUrl(value) {
    const text = String(value ?? '').trim();
    if (!/^https?:\/\//i.test(text)) throw new Error('请输入以 http:// 或 https:// 开头的完整地址。');
    let url;
    try { url = new URL(text); } catch { throw new Error('面板地址格式不正确，请检查主机和端口。'); }
    if (!url.hostname || url.username || url.password) throw new Error('请使用不含用户名和密码的面板地址。');
    return url.href;
  }
  function configFrom(value) {
    if (!value || typeof value !== 'object') throw new Error('面板设置无效。');
    return { name: identity.name(value.name, DEFAULT.name), logo: identity.logo(value.logo), url: validUrl(value.url) };
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
    const nameField = panel.querySelector('#proxy-panel-name'), logoField = panel.querySelector('#proxy-panel-logo-url'), logoFile = panel.querySelector('#proxy-panel-logo-file'), preview = panel.querySelector('#proxy-panel-preview');
    let returnFocus = opener, uploaded = '', uploading = false, sequence = 0, revision = '', ready = false, loadError = '';
    const submit = form.querySelector('[type=submit]'), retry = panel.querySelector('#proxy-panel-retry');
    const enable = value => { for(const item of [nameField,logoField,logoFile,field,submit,panel.querySelector('#proxy-panel-logo-reset')])item.disabled=!value; };
    let legacy = null;try { const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(raw)legacy=configFrom(raw); }catch{}
    async function refresh() {
      enable(false);retry.hidden=true;
      try{const result=await identity.loadSection('proxy',legacy,STORAGE_KEY);config=configFrom(result.value||DEFAULT);revision=result.revision;ready=true;loadError='';sync();if(!panel.hidden)open(returnFocus);}
      catch(failure){ready=false;loadError=failure.message;error.textContent=loadError;error.hidden=false;retry.hidden=false;}finally{enable(ready);}
    }
    retry.onclick=refresh;
    const previewLogo = () => identity.setImage(preview, uploaded || logoField.value || identity.defaultProxyLogo, identity.defaultProxyLogo);

    function sync() {
      const label = config.name, logo = config.logo || identity.defaultProxyLogo;
      for (const item of document.querySelectorAll('[data-proxy-panel-link]')) {
        item.href = config.url;
        item.title = '打开 ' + label + ' · ' + config.url;
        item.setAttribute('aria-label', '打开 ' + label + '（新标签页）');
        const image = item.querySelector('img');
        identity.setImage(image, logo, identity.defaultProxyLogo);
      }
      for (const item of document.querySelectorAll('[data-proxy-panel-name]')) item.textContent = label;
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
      ++sequence; uploading = false;
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
      error.hidden = ready;error.textContent=loadError||'正在读取服务器设置…';retry.hidden=ready||!loadError;
      field.removeAttribute('aria-invalid');
      field.value = config.url;
      nameField.value = config.name; logoField.value = config.logo.startsWith('data:') ? '' : config.logo;
      uploaded = config.logo.startsWith('data:') ? config.logo : ''; logoFile.value = ''; previewLogo();
      panel.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      place();
      nameField.focus({ preventScroll: true });
    }
    opener.addEventListener('click', () => panel.hidden ? open() : close());
    panel.querySelectorAll('[data-proxy-panel-close]').forEach(button => button.addEventListener('click', () => close()));
    logoFile.addEventListener('change', async () => {
      const file = logoFile.files[0]; if (!file) return;
      const generation = ++sequence; uploading = true; error.hidden = true;
      try { const data = await identity.upload(file); if (generation !== sequence) return; uploaded = data; logoField.value = ''; previewLogo(); }
      catch (failure) { if(generation === sequence) { error.textContent = failure.message; error.hidden = false; } }
      finally { if(generation === sequence)uploading = false; place(); }
    });
    logoField.addEventListener('input', () => { ++sequence; uploading = false; uploaded = ''; logoFile.value = ''; error.hidden = true; });
    panel.querySelector('#proxy-panel-logo-reset').addEventListener('click', () => { ++sequence; uploading = false; uploaded = ''; logoField.value = ''; logoFile.value = ''; previewLogo(); });
    form.addEventListener('submit', async event => {
      event.preventDefault(); error.hidden = true; field.removeAttribute('aria-invalid');
      if (!ready) return;
      if (uploading) { error.textContent = 'Logo 正在读取，请稍候。'; error.hidden = false; return; }
      const generation = sequence;enable(false);
      try {
        const next = configFrom({ name: nameField.value, logo: uploaded || logoField.value, url: field.value });
        if(next.logo)await identity.image(next.logo);
        if (generation !== sequence || panel.hidden) return;
        const result = await identity.saveSection('proxy',next,revision);
        config = configFrom(result.value); revision = result.revision; sync(); close(); notify('代理面板设置已保存到服务器');
      } catch (failure) {
        if(generation !== sequence || panel.hidden)return;
        error.textContent = failure.message;error.hidden = false;retry.hidden=false;place();
      } finally { enable(ready); }
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
    window.LocalDNSProxyPanel.sync = sync;
    sync();refresh();
  }
  window.LocalDNSProxyPanel = { setup, sync() {} };
})();
