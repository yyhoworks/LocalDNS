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
  function normalize(value){return Object.fromEntries(Object.keys(defaults).map(role=>[role,Object.hasOwn(families[role],value?.[role])?value[role]:defaults[role]]));}
  function read(){try{return normalize(JSON.parse(localStorage.getItem(key)||'null'));}catch{return {...defaults};}}
  let current=read(),bound=false;
  function apply(value){current=normalize(value);root.style.setProperty('--font-heading',families.heading[current.heading]);root.style.setProperty('--font-numeral',families.numeral[current.numeral]);root.style.setProperty('--font-sans',families.body[current.body]);root.dataset.numeral=current.numeral;sync();}
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
      try{localStorage.setItem(key,JSON.stringify(current));if(status){status.textContent='字体已保存到当前浏览器';status.dataset.state='saved';}}
      catch{if(status){status.textContent='字体已预览，但浏览器禁止保存；刷新后将恢复原设置。';status.dataset.state='error';}}
    }
    document.querySelectorAll('[data-font-preset]').forEach(button=>button.addEventListener('click',()=>choose(presets[button.dataset.fontPreset])));
    for(const role of Object.keys(defaults))document.querySelector('#font-'+role)?.addEventListener('change',event=>choose({...current,[role]:event.target.value}));
    window.addEventListener('storage',event=>{if(event.key===key)apply(read());});
  }
  window.LocalDNSTypography={setup};
})();
