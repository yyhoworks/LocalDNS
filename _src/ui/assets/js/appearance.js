(() => {
  'use strict';
  const key='localdns-typography-v1',root=document.documentElement;
  const defaults={heading:'serif',numeral:'serif',body:'plex'};
  const families={
    heading:{serif:"'Noto Serif SC','Songti SC','SimSun',serif",sans:"'Noto Sans SC','IBM Plex Sans','Microsoft YaHei',sans-serif",system:"system-ui,'Microsoft YaHei',sans-serif"},
    numeral:{serif:"'Instrument Serif','Times New Roman',serif",sans:"'IBM Plex Sans',sans-serif",mono:"'IBM Plex Mono',Consolas,monospace"},
    body:{plex:"'IBM Plex Sans','Noto Sans SC',-apple-system,BlinkMacSystemFont,sans-serif",noto:"'Noto Sans SC','IBM Plex Sans',sans-serif",system:"system-ui,'Microsoft YaHei',sans-serif"}
  };
  const presets={classic:{...defaults},clear:{heading:'sans',numeral:'sans',body:'noto'},technical:{heading:'sans',numeral:'mono',body:'plex'}};
  const isUploaded=key=>typeof key==='string'&&/^up[a-z0-9_-]+$/i.test(key);
  function normalize(value){return Object.fromEntries(Object.keys(defaults).map(role=>[role,Object.hasOwn(families[role],value?.[role])||isUploaded(value?.[role])?value[role]:defaults[role]]));}
  function read(){try{return normalize(JSON.parse(localStorage.getItem(key)||'null'));}catch{return {...defaults};}}
  let current=read(),bound=false;
  const family=role=>families[role][current[role]]||families[role][defaults[role]];
  function apply(value){
    current=normalize(value);
    root.style.setProperty('--font-heading',family('heading'));
    root.style.setProperty('--font-numeral',family('numeral'));
    root.style.setProperty('--font-sans',family('body'));
    root.dataset.numeral=current.numeral;
    if(window.Chart){
      Chart.defaults.font.family=family('body');
      Object.values(Chart.instances||{}).forEach(chart=>chart.update('none'));
    }
    sync();
  }
  function save(){
    const status=document.querySelector('#typography-save-status');
    try{localStorage.setItem(key,JSON.stringify(current));if(status){status.textContent='字体已保存到当前浏览器';status.dataset.state='saved';}}
    catch{if(status){status.textContent='字体已预览，但浏览器禁止保存；刷新后将恢复原设置。';status.dataset.state='error';}}
  }
  function registerFonts(fonts){
    for(const role of Object.keys(defaults)){
      for(const id of Object.keys(families[role]))if(isUploaded(id))delete families[role][id];
      const input=document.querySelector('#font-'+role);
      input?.querySelector('[data-uploaded-fonts]')?.remove();
      const group=document.createElement('optgroup');group.label='已上传字体';group.dataset.uploadedFonts='';
      for(const font of fonts){
        if(!isUploaded(font.id))continue;
        families[role][font.id]=`'LocalDNSUploaded_${font.id}', ${families[role][defaults[role]]}`;
        const option=document.createElement('option');option.value=font.id;option.textContent=font.name;group.append(option);
      }
      if(group.children.length)input?.append(group);
    }
    for(const role of Object.keys(defaults))if(isUploaded(current[role])&&!Object.hasOwn(families[role],current[role]))current[role]=defaults[role];
    apply(current);
  }
  function forgetFont(id){
    const next={...current};let changed=false;
    for(const role of Object.keys(defaults))if(next[role]===id){next[role]=defaults[role];changed=true;}
    if(changed){apply(next);save();}
  }
  function sync(){
    for(const role of Object.keys(defaults)){const input=document.querySelector('#font-'+role);if(input)input.value=current[role];}
    document.querySelectorAll('[data-font-preset]').forEach(button=>{const preset=presets[button.dataset.fontPreset];button.setAttribute('aria-pressed',String(Object.keys(defaults).every(role=>current[role]===preset?.[role])));});
  }
  // Restore before first paint. Technical content keeps its separate monospace role.
  apply(current);
  document.addEventListener('keydown',event=>{if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))root.dataset.inputModality='keyboard';},true);
  document.addEventListener('pointerdown',()=>{root.dataset.inputModality='pointer';},true);
  function setup(){
    if(bound)return;bound=true;sync();const status=document.querySelector('#typography-save-status');
    function choose(value){
      apply(value);
      save();
    }
    document.querySelectorAll('[data-font-preset]').forEach(button=>button.addEventListener('click',()=>choose(presets[button.dataset.fontPreset])));
    for(const role of Object.keys(defaults))document.querySelector('#font-'+role)?.addEventListener('change',event=>choose({...current,[role]:event.target.value}));
    window.addEventListener('storage',event=>{if(event.key===key)apply(read());});
  }
  window.LocalDNSTypography={setup,registerFonts,forgetFont};
})();
