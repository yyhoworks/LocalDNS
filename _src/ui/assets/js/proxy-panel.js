/* Shared external dashboard settings, persisted on the LocalDNS server. */
(() => {
  'use strict';
  const STORAGE_KEY = 'localdns-proxy-panel-v1';
  const identity = window.LocalDNSIdentity;
  const defaultURL=new URL('/ui/',location.origin);defaultURL.port='9090';
  const DEFAULT = { name: '代理面板', url: defaultURL.href };
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
    return { name: identity.name(value.name, DEFAULT.name), url: validUrl(value.url||DEFAULT.url) };
  }
  function candidates(value){
    const url=new URL(validUrl(value));url.search='';url.hash='';
    if(/\.[a-z0-9]+$/i.test(url.pathname))url.pathname=url.pathname.slice(0,url.pathname.lastIndexOf('/')+1);
    else if(!url.pathname.endsWith('/'))url.pathname+='/';
    const dark=document.documentElement.dataset.theme!=='light-glass';
    const names=dark?['favicon-dark.svg','favicon.svg','apple-touch-icon.png','favicon.ico']:['favicon.svg','apple-touch-icon.png','favicon.ico'];
    return [...new Set([...names.map(name=>new URL(name,url).href),new URL('/favicon.ico',url).href])];
  }
  const attempts=new WeakMap();
  function loadLogo(element,value,status){
    if(!element)return;
    const token={};attempts.set(element,token);element.referrerPolicy='no-referrer';element.onerror=null;
    element.src=identity.defaultProxyLogo;if(status)status.textContent='正在读取面板图标…';
    let urls;try{urls=candidates(value);}catch{if(status)status.textContent='填写有效面板地址后自动读取图标';return;}
    (async()=>{
      for(const url of urls){
        if(attempts.get(element)!==token)return;
        try{
          await new Promise((resolve,reject)=>{const image=new Image();image.referrerPolicy='no-referrer';const timer=setTimeout(()=>{image.src='';reject(new Error('timeout'));},2500);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('image'));};image.src=url;});
          if(attempts.get(element)!==token)return;
          element.src=url;if(status)status.textContent='已读取面板图标';return;
        }catch{}
      }
      if(attempts.get(element)===token&&status)status.textContent='未找到面板图标，使用默认图标';
    })();
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
    const nameField=panel.querySelector('#proxy-panel-name'), preview=panel.querySelector('#proxy-panel-preview'),logoStatus=panel.querySelector('#proxy-logo-status');
    let returnFocus=opener, sequence=0, revision='', ready=false, loadError='';
    const submit = form.querySelector('[type=submit]'), retry = panel.querySelector('#proxy-panel-retry');
    const enable = value => { for(const item of [nameField,field,submit])item.disabled=!value; };
    let legacy = null;try { const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(raw)legacy=configFrom(raw); }catch{}
    async function refresh() {
      enable(false);retry.hidden=true;
      try{const result=await identity.loadSection('proxy',legacy,STORAGE_KEY);config=configFrom(result.value||DEFAULT);revision=result.revision;ready=true;loadError='';sync();if(!panel.hidden)open(returnFocus);}
      catch(failure){ready=false;loadError=failure.message;error.textContent=loadError;error.hidden=false;retry.hidden=false;}finally{enable(ready);}
    }
    retry.onclick=refresh;
    const previewLogo=()=>loadLogo(preview,field.value||config.url,logoStatus);

    function sync() {
      const label=config.name;
      for (const item of document.querySelectorAll('[data-proxy-panel-link]')) {
        item.href = config.url;
        item.title = '打开 ' + label + ' · ' + config.url;
        item.setAttribute('aria-label', '打开 ' + label + '（新标签页）');
        const image = item.querySelector('img');
        loadLogo(image,config.url);
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
      ++sequence;
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
      nameField.value=config.name;previewLogo();
      panel.hidden = false;
      opener.setAttribute('aria-expanded', 'true');
      place();
      nameField.focus({ preventScroll: true });
    }
    opener.addEventListener('click', () => panel.hidden ? open() : close());
    panel.querySelectorAll('[data-proxy-panel-close]').forEach(button => button.addEventListener('click', () => close()));
    form.addEventListener('submit', async event => {
      event.preventDefault(); error.hidden = true; field.removeAttribute('aria-invalid');
      if (!ready) return;
      const generation = sequence;enable(false);
      try {
        const next = configFrom({name:nameField.value,url:field.value});
        if (generation !== sequence || panel.hidden) return;
        const result = await identity.saveSection('proxy',next,revision);
        config = configFrom(result.value); revision = result.revision; sync(); close(); notify('面板地址已应用到当前浏览器');
      } catch (failure) {
        if(generation !== sequence || panel.hidden)return;
        error.textContent = failure.message;error.hidden = false;retry.hidden=false;place();
      } finally { enable(ready); }
    });
    field.addEventListener('input',()=>{++sequence;error.hidden=true;field.removeAttribute('aria-invalid');});
    field.addEventListener('change',previewLogo);
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
    new MutationObserver(()=>{sync();if(!panel.hidden)previewLogo();}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    sync();refresh();
  }
  window.LocalDNSProxyPanel={setup,sync(){},getValue:()=>({...config}),candidates};
})();
