import { sharedUIService } from '../../core/persistence/shared-ui.js';
import { preferences } from '../../core/persistence/preferences.ts';
export let identityService;
export function initialize() {

  'use strict';
  const key = 'localdns-identity-v1';
  const defaultProxyLogo = 'assets/img/proxy-panel.svg';
  function name(value, fallback) {
    const text = String(value ?? '').trim();
    if (text.length > 32 || [...text].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('名称最多 32 个字符，请勿使用换行或控制字符。');
    return text || fallback;
  }
  function logo(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (text.startsWith('custom/assets/')) return sharedUIService.asset(text);
    if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(text) && text.length <= 500000) return text;
    if (text.length > 4096) throw new Error('Logo 地址过长，请上传图片。');
    let url;
    try { url = new URL(text); } catch { throw new Error('Logo 请使用完整的 http:// 或 https:// 图片地址，或上传图片。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Logo 请使用不含账号密码的 HTTP(S) 图片地址。');
    return url.href;
  }
  function image(source) {
    return new Promise((resolve, reject) => {
      const img = new Image(), timer = setTimeout(() => { img.src = ''; reject(new Error('Logo 加载超时，请检查图片地址。')); }, 10000);
      img.onload = () => { clearTimeout(timer); if (!img.naturalWidth || !img.naturalHeight) reject(new Error('图片没有有效尺寸。')); else resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Logo 无法读取，请选择有效图片或检查图片地址。')); };
      img.src = source;
    });
  }
  async function upload(file) {
    if (!file || file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MB 的 PNG、JPG、WebP、GIF 或 SVG 图片。');
    const url = URL.createObjectURL(file);
    try {
      const img = await image(url), scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return logo(canvas.toDataURL('image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
  function setImage(element, source, fallback) {
    if (!element) return;
    if (element.getAttribute('src') !== source) element.src = source;
    element.onerror = () => { element.onerror = null; element.src = fallback; };
  }
  async function loadSection(section) {
    return {value:await sharedUIService.section(section),revision:'browser'};
  }
  async function saveSection(section,value) {
    sharedUIService.save(section,value);
    return {value,revision:'browser',saved:true};
  }
  const defaults = {name:'LocalDNS', logo:''};
  function read() {
    try { const value = JSON.parse(preferences.getItem(key)); return {name:name(value?.name, defaults.name), logo:logo(value?.logo)}; }
    catch { return {...defaults}; }
  }
  let current = read();
  const defaultLogo = () => 'assets/img/' + (document.documentElement.dataset.theme === 'light-glass' ? 'logo-04-light' : 'logo-08-dark') + '.png?v=20261015-2';
  function apply() {
    const fallback = defaultLogo();
    setImage(document.querySelector('#brand-mark'), current.logo || fallback, fallback);
    for (const element of document.querySelectorAll('.brand-name,[data-localdns-name]')) {
      if (element.textContent !== current.name) element.textContent = current.name;
      element.title = current.name;
    }
    document.title = current.name + ' 控制台';
    const favicon = document.querySelector('#dynamic-favicon');
    if (favicon) { favicon.removeAttribute('type'); const source = current.logo || fallback; if(favicon.getAttribute('href') !== source)favicon.href=source; }
    const restart = document.querySelector('#restart-button');
    if (restart) { restart.title='重启 '+current.name;restart.setAttribute('aria-label',restart.title); }
    const sidebar = document.querySelector('#sidebar-status strong');
    if(sidebar)sidebar.textContent=current.name+(document.querySelector('#sidebar-status .offline')?' 连接异常':' 运行正常');
  }
  function setup() {
    const field = document.querySelector('#identity-name'), url = document.querySelector('#identity-logo-url'), file = document.querySelector('#identity-logo-file');
    if (!field) return;
    const status = document.querySelector('#identity-status'), preview = document.querySelector('#identity-preview');
    let uploaded = '', loading = false, generation = 0;
    const show = (message, error=false) => { status.textContent=message;status.dataset.state=error?'error':'saved'; };
    function syncFields() { field.value=current.name;url.value=current.logo.startsWith('data:')?'':current.logo;uploaded=current.logo.startsWith('data:')?current.logo:'';file.value='';setImage(preview,current.logo||defaultLogo(),defaultLogo()); }
    let revision='', ready=false;
    const saveButton=document.querySelector('#identity-save'),resetButton=document.querySelector('#identity-reset'),retryButton=document.querySelector('#identity-retry');
    const enable=value=>{for(const item of [field,url,file,saveButton,resetButton])item.disabled=!value;};
    let legacy=null;try{const raw=JSON.parse(preferences.getItem(key)||'null');if(raw)legacy={name:name(raw.name,defaults.name),logo:logo(raw.logo)};}catch{}
    async function refresh(){
      enable(false);show('正在读取共享配置…');retryButton.hidden=true;
      try{const result=await loadSection('localdns',legacy,key);current=result.value?{name:name(result.value.name,defaults.name),logo:logo(result.value.logo)}:{...defaults};revision=result.revision;ready=true;apply();syncFields();show(sharedUIService.hasOverride('localdns')?'正在使用本机设置；导出后可共享到其他设备。':'正在跟随服务器共享配置。');}
      catch(error){ready=false;show(error.message,true);retryButton.hidden=false;}finally{enable(ready);}
    }
    syncFields(); apply();refresh();retryButton.onclick=refresh;
    file.onchange = async () => {
      const selected=file.files[0];if(!selected)return;const id=++generation;loading=true;show('正在读取 Logo…');
      try { const result=await upload(selected);if(id!==generation)return;uploaded=result;url.value='';setImage(preview,result,defaultLogo());show('Logo 已选取，点击保存名称与 Logo。'); }
      catch(error){if(id===generation)show(error.message,true);}finally{if(id===generation)loading=false;}
    };
    url.oninput=()=>{++generation;loading=false;uploaded='';file.value='';};
    saveButton.onclick=async()=>{
      if(!ready)return;
      if(loading){show('Logo 正在读取，请稍候。');return;}enable(false);const version=generation;
      try { const next={name:name(field.value,defaults.name),logo:logo(uploaded||url.value)};if(next.logo)await image(next.logo);if(version!==generation)return;const result=await saveSection('localdns',next,revision);current=result.value;revision=result.revision;apply();syncFields();show('已应用到当前浏览器；点击下方“导出共享配置”同步到服务器。'); }
      catch(error){show(error.message,true);retryButton.hidden=false;}finally{enable(ready);}
    };
    resetButton.onclick=async()=>{
      if(!ready)return;enable(false);++generation;loading=false;
      try {const result=await saveSection('localdns',{...defaults},revision);current=result.value;revision=result.revision;apply();syncFields();show('默认名称与 Logo 已应用到当前浏览器。');}
      catch(error){show(error.message,true);retryButton.hidden=false;}finally{enable(ready);}
    };
  }
  identityService ={apply,name,logo,upload,image,setImage,defaultProxyLogo,loadSection,saveSection,getValue:()=>({...current}),getName:()=>current.name};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();

}
