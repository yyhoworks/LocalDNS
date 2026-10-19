import { typographyService } from '../../features/appearance/typography.js';
import { identityService } from '../../features/identity/index.js';
import { fontsService } from '../../features/appearance/fonts.js';
import { proxyPanelService } from '../../features/proxy-panel/index.js';
import { assetHttp } from '../api/network.ts';
import { preferences } from './preferences.ts';
export let sharedUIService;
export function initialize() {

  'use strict';
  const base = new URL('./', document.baseURI);
  const keys = {localdns:'localdns-identity-v1', proxy:'localdns-proxy-panel-v1', typography:'localdns-typography-v1'};
  const defaults = {version:1, localdns:{name:'LocalDNS',logo:''}, proxy:{name:'代理面板',url:''}, typography:{heading:'serif',numeral:'serif',body:'plex'}, fonts:[]};
  let config = structuredClone(defaults), error = '';
  const read = key => {try{return JSON.parse(preferences.getItem(key)||'null');}catch{return null;}};
  const asset = path => {
    if(typeof path!=='string'||!/^custom\/(assets|fonts)\/[a-zA-Z0-9._-]+$/.test(path))throw new Error('共享资源路径无效');
    return new URL(path,base).href;
  };
  try{for(const key of ['localdns-proxy-config-file-v1','localdns-proxy-config-workspace-v1'])preferences.removeItem(key);const old=read(keys.proxy);if(old&&Object.hasOwn(old,'logo')){delete old.logo;preferences.setItem(keys.proxy,JSON.stringify(old));}}catch{}
  const ready = (async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try{
      const response=await assetHttp.fetch(new URL('custom/settings.json',base), {cache:'no-store',signal:controller.signal});
      if(response.status===404)return config;
      if(!response.ok)throw new Error('共享配置读取失败');
      const value=await response.json();
      if(value.version!==1||!Array.isArray(value.fonts)||value.fonts.length>128)throw new Error('共享配置格式无效');
      const fonts=value.fonts.map(font=>{
        if(!/^up[a-z0-9_-]+$/i.test(font.id)||typeof font.name!=='string'||!Number.isFinite(font.size)||font.size<=0||font.size>67108864)throw new Error('共享字体清单无效');
        asset(font.path);return {...font,name:font.name.slice(0,200),shared:true};
      });
      if(new Set(fonts.map(f=>f.id)).size!==fonts.length||fonts.reduce((sum,f)=>sum+f.size,0)>134217728)throw new Error('共享字体数量或容量无效');
      config={version:1,localdns:value.localdns||defaults.localdns,proxy:value.proxy||defaults.proxy,typography:value.typography||defaults.typography,fonts};
      return config;
    }catch(failure){error=failure.name==='AbortError'?'服务器共享配置读取超时':failure.message;return config;}
    finally{clearTimeout(timer);}
  })();
  async function section(name){await ready;return read(keys[name])||config[name];}
  function hasOverride(name){try{return preferences.getItem(keys[name])!==null;}catch{return false;}}
  function save(name,value){try{preferences.setItem(keys[name],JSON.stringify(value));}catch{throw new Error('当前浏览器禁止保存设置，请允许站点存储后重试。');}}
  function follow(){try{for(const key of Object.values(keys))preferences.removeItem(key);location.reload();}catch{const status=document.querySelector('#shared-ui-status');status.textContent='浏览器禁止修改站点存储，无法清除本机设置。';status.dataset.state='error';}}

  // Uncompressed ZIP keeps large font exports bounded, without a third-party dependency.
  const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
  function zip(files){
    const parts=[],central=[];let offset=0,centralSize=0;
    for(const [path,data]of files){
      const name=new TextEncoder().encode(path),bytes=data instanceof Uint8Array?data:new Uint8Array(data),sum=crc(bytes);
      const head=new Uint8Array(30+name.length),h=new DataView(head.buffer);
      h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,sum,true);h.setUint32(18,bytes.length,true);h.setUint32(22,bytes.length,true);h.setUint16(26,name.length,true);head.set(name,30);
      const index=new Uint8Array(46+name.length),v=new DataView(index.buffer);
      v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint16(14,33,true);v.setUint32(16,sum,true);v.setUint32(20,bytes.length,true);v.setUint32(24,bytes.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);index.set(name,46);
      parts.push(head,bytes);central.push(index);centralSize+=index.length;offset+=head.length+bytes.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...parts,...central,end],{type:'application/zip'});
  }
  async function exportBundle(){
    await ready;const files=[];
    const identity=identityService.getValue(),proxy=proxyPanelService?.getValue()||await section('proxy');
    const value={version:1,localdns:{...identity},proxy:{name:proxy.name,url:proxy.url},typography:typographyService.getSelection(),fonts:[]};
    if(identity.logo.startsWith('data:')||identity.logo.startsWith(new URL('custom/assets/',base).href)||identity.logo.startsWith('custom/assets/')){
      const blob=await(await assetHttp.fetch(identity.logo.startsWith('custom/')?new URL(identity.logo,base):identity.logo)).blob();
      const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'})[blob.type];
      if(!ext)throw new Error('共享 Logo 请使用 PNG、JPG、WebP 或 GIF');
      files.push(['assets/logo.'+ext,await blob.arrayBuffer()]);value.localdns.logo='custom/assets/logo.'+ext;
    }
    const fonts=await fontsService.exportRecords();
    for(const font of fonts){const ext=font.name.split('.').pop().toLowerCase(),path='fonts/'+font.id+'.'+ext;files.push([path,font.data]);value.fonts.push({id:font.id,name:font.name,size:font.data.byteLength,path:'custom/'+path});}
    files.unshift(['settings.json',new TextEncoder().encode(JSON.stringify(value,null,2)+'\n')]);
    const url=URL.createObjectURL(zip(files)),a=document.createElement('a');a.href=url;a.download='localdns-ui-settings.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  function setup(){
    const button=document.querySelector('#export-shared-ui'),status=document.querySelector('#shared-ui-status');
    button?.addEventListener('click',async()=>{button.disabled=true;status.textContent='正在打包名称、Logo 与字体…';try{await exportBundle();status.textContent='配置包已导出；导入服务器后，其他设备刷新即可同步。';status.dataset.state='saved';}catch(failure){status.textContent='导出失败：'+failure.message;status.dataset.state='error';}finally{button.disabled=false;}});
    document.querySelector('#use-shared-ui')?.addEventListener('click',follow);
    ready.then(()=>{if(error){status.textContent=error+'，当前使用默认值或本机设置；可刷新重试。';status.dataset.state='error';}});
  }
  sharedUIService ={ready,section,save,asset,follow,hasOverride,get config(){return config;},get error(){return error;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();

}
