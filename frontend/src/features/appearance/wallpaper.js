import { appearanceRepository } from '../../core/persistence/appearance-repository';
import { assetHttp } from '../../core/api/network.ts';
import { preferences } from '../../core/persistence/preferences.ts';
export let wallpaperService;
export function initialize() {

  'use strict';
  const FALLBACK_KEY='localdns-wallpaper-v4';
  const readLocal=key=>{try{return preferences.getItem(key);}catch{return null;}};

  function database(mode,value){return mode==='readonly' ? appearanceRepository.read(['wallpaper','wallpaper-library-v1']).then(values=>({record:values.wallpaper,library:values['wallpaper-library-v1']})) : appearanceRepository.write('wallpaper',value);}
  function asDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法读取图片文件'));r.readAsDataURL(blob);});}
  async function save(record){
    try{await database('readwrite',record);try{preferences.removeItem(FALLBACK_KEY);}catch{}}
    catch{
      const fallback=record.type==='image'?{version:1,type:'image',dataUrl:await asDataUrl(record.blob),name:record.name,savedAt:record.savedAt}:record;
      try{preferences.setItem(FALLBACK_KEY,JSON.stringify(fallback));}
      catch{throw new Error('壁纸未保存：浏览器存储空间不足或权限受限，请使用较小图片、图片 URL，或允许此站点保存数据。');}
    }
    // Preserve the old wallpaper until the new one is durably committed.
    try{preferences.removeItem('localdns-wallpaper-v3');preferences.removeItem('localdns_bg_custom');preferences.removeItem('localdns_bg_preset');}catch{}
  }
  async function normalize(record){
    if(!record||record.version!==1)return null;
    if(record.type==='image'&&!record.blob&&typeof record.dataUrl==='string'){
      if(!record.dataUrl.startsWith('data:image/'))return null;
      record={...record,blob:await(await assetHttp.fetch(record.dataUrl)).blob()};
    }
    if(record.type==='image'&&record.blob instanceof Blob)return record;
    if(record.type==='url'&&typeof record.url==='string')return record;
    if(record.type==='preset'&&typeof record.preset==='string')return record;
    return null;
  }
  // Read only the selected wallpaper from the retired gallery. Keep its source data intact.
  async function selectedWallpaper(library){
    if(library?.version!==1||!Array.isArray(library.items))throw new Error('旧版壁纸数据无法读取，原数据已保留。');
    const selected=library.selected;
    if(selected?.type==='preset')return normalize({version:1,type:'preset',preset:selected.preset});
    const item=selected?.type==='asset'?library.items.find(item=>item.id===selected.id):null;
    const record=await normalize(item?{...item,version:1}:null);
    if(!record)throw new Error('旧版当前壁纸无法读取，原数据已保留。');
    return record;
  }
  function loadImage(url){return new Promise((resolve,reject)=>{
    const image=new Image(),timer=setTimeout(()=>{image.src='';reject(new Error('图片加载超时，请检查地址或换一张图片。'));},12000);
    image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('无法加载图片，请确认地址可直接打开图片，或重新选择图片文件。'));};image.src=url;
  });}

  function setup({notify=()=>{}}={}){
    const wall=document.querySelector('#wallpaper-layer');if(!wall)return Promise.resolve();
    const input=document.querySelector('#bg-url-input'),fileInput=document.querySelector('#bg-file-input'),applyButton=document.querySelector('#btn-apply-bg-url'),resetButton=document.querySelector('#btn-clear-custom-bg'),status=document.querySelector('#wallpaper-save-status');
    const presets=[...document.querySelectorAll('[data-bg-preset]')],allowed=new Set(presets.map(b=>b.dataset.bgPreset));
    const selectButton=document.querySelector('#btn-select-bg-file');
    const controls=[...presets,input,fileInput,applyButton,resetButton,selectButton].filter(Boolean);
    let busy=false,objectUrl=null,currentRecord=null;
    function message(text,state=''){if(status){status.textContent=text;status.dataset.state=state;}}
    function setBusy(value){busy=value;controls.forEach(c=>{c.disabled=value;});if(applyButton){applyButton.textContent=value?'保存中…':'应用';applyButton.setAttribute('aria-busy',String(value));}}
    async function prepare(record){
      if(record.type==='preset')return null;
      const owned=record.type==='image',url=owned?URL.createObjectURL(record.blob):record.url;
      try{await loadImage(url);return{url,owned};}catch(error){if(owned)URL.revokeObjectURL(url);throw error;}
    }
    function render(record,prepared){
      const preset=record.type==='preset'?(allowed.has(record.preset)?record.preset:'cosmos'):'custom';
      wall.dataset.preset=preset;wall.style.backgroundImage=prepared?`url(${JSON.stringify(prepared.url)})`:'';
      presets.forEach(b=>{b.classList.toggle('active',b.dataset.bgPreset===preset);b.setAttribute('aria-pressed',String(b.dataset.bgPreset===preset));});
      if(input)input.value=record.type==='url'?record.url:'';
      currentRecord=record;
      if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=prepared?.owned?prepared.url:null;
    }
    function savedMessage(record){return record.type==='image'?`已保存到当前浏览器：${record.name||'本地壁纸'}`:record.type==='url'?'图片 URL 已保存到当前浏览器':'背景预设已保存到当前浏览器';}
    async function apply(record){
      if(busy)return;setBusy(true);message('正在验证并保存壁纸…');let prepared;
      try{prepared=await prepare(record);await save(record);render(record,prepared);prepared=null;message(savedMessage(record),'saved');notify('壁纸已保存');}
      catch(error){if(prepared?.owned)URL.revokeObjectURL(prepared.url);message(error.message,'error');notify('壁纸未保存','error',error.message);}
      finally{setBusy(false);}
    }
    presets.forEach(b=>{b.onclick=()=>apply({version:1,type:'preset',preset:b.dataset.bgPreset,savedAt:Date.now()});});
    if(resetButton)resetButton.onclick=()=>apply({version:1,type:'preset',preset:'cosmos',savedAt:Date.now()});
    if(selectButton)selectButton.onclick=()=>fileInput.click();
    if(fileInput)fileInput.onchange=async()=>{
      const file=fileInput.files?.[0];if(!file)return;
      if(file.type&&!file.type.startsWith('image/')){message('请选择图片文件','error');fileInput.value='';return;}
      await apply({version:1,type:'image',blob:file,name:file.name,savedAt:Date.now()});fileInput.value='';
    };
    if(applyButton)applyButton.onclick=()=>{
      const value=input?.value.trim();if(!value){if(currentRecord?.type==='image'){message(savedMessage(currentRecord),'saved');notify('本地壁纸已保存');}else message('请输入在线图片 URL；本地图片在选择后会自动保存。','error');return;}
      let url;try{url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();}catch{message('请输入以 http:// 或 https:// 开头的有效图片 URL。','error');return;}
      return apply({version:1,type:'url',url:url.href,savedAt:Date.now()});
    };
    if(input)input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!busy)applyButton.click();}});

    async function restore(){
      setBusy(true);message('正在读取已保存壁纸…');
      try{
        let record,legacy=false,readError;
        try{record=await normalize(JSON.parse(readLocal(FALLBACK_KEY)||'null'));}catch{}
        if(!record){
          let snapshot;
          try{snapshot=await database('readonly');}catch(error){readError=error;}
          if(snapshot?.record)record=await normalize(snapshot.record);
          else if(snapshot?.library){record=await selectedWallpaper(snapshot.library);legacy=true;}
          if(!record){
            const library=readLocal('localdns-wallpaper-library-v1');
            if(library){record=await selectedWallpaper(JSON.parse(library));legacy=true;}
          }
        }
        if(!record){try{record=await normalize(JSON.parse(readLocal('localdns-wallpaper-v3')||'null'));legacy=!!record;}catch{}}
        if(!record){
          const custom=readLocal('localdns_bg_custom'),preset=readLocal('localdns_bg_preset');
          if(custom)record=await normalize(custom.startsWith('data:image/')?{version:1,type:'image',dataUrl:custom,name:'本地壁纸',savedAt:Date.now()}:{version:1,type:'url',url:custom,savedAt:Date.now()});
          else if(allowed.has(preset))record={version:1,type:'preset',preset,savedAt:Date.now()};
          legacy=!!record;
        }
        if(record){
          if(record.type==='url'&&input)input.value=record.url;
          render(record,await prepare(record));
          if(legacy){try{await save(record);}catch{message('已恢复旧版壁纸；浏览器暂时无法保存新图片，请检查站点存储权限。','error');return;}}
          message(savedMessage(record),'saved');
        }else if(readError)message('浏览器暂时无法读取壁纸存储，请检查此站点的存储权限。','error');
        else message('壁纸保存在当前浏览器，选择图片后自动保存。');
      }catch(error){message(`已保存的壁纸暂时无法加载：${error.message}`,'error');}
      finally{setBusy(false);}
    }
    wallpaperService.ready=restore();return wallpaperService.ready;
  }
  wallpaperService ={setup};

}
