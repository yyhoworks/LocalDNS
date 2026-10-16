(() => {
  'use strict';
  /* 玻璃、圆角、版本标签沿用 localdns-material-v2；字体由 appearance.js 独立管理。 */
  let saved={};try{saved=JSON.parse(localStorage.getItem('localdns-material-v2')||'{}');}catch{}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
  const store=patch=>{saved={...saved,...patch};try{localStorage.setItem('localdns-material-v2',JSON.stringify(saved));}catch{};};

  /* 版本标签：品牌区保留原有后端版本显示；隐藏或自定义由用户选择。
     app.js 会在状态轮询里把后端版本写进 #brand-version-tag，所以这里用 html[data-brand-ver-mode] 标记模式。 */
  const BRAND_VER_MODES=['hidden','version','custom'];
  const BRAND_VER_LABELS={hidden:'隐藏',version:'跟随版本',custom:'自定义'};
  const brandVerMode=()=>BRAND_VER_MODES.includes(saved.brandVer)?saved.brandVer:'version';
  function applyBrand(){
    const mode=brandVerMode();
    const custom=String(saved.brandVerText||'').trim();
    document.documentElement.dataset.brandVerMode=mode;
    const tag=document.querySelector('#brand-version-tag');
    if(tag){
      const visible=mode==='version'||(mode==='custom'&&!!custom);
      tag.style.display=visible?'':'none';
      if(mode==='custom')tag.textContent=custom;
      else if(mode==='version')tag.textContent=tag.dataset.backendVersion || '—';
    }
    const verVal=document.querySelector('#val-brand-ver');if(verVal)verVal.textContent=BRAND_VER_LABELS[mode];
    const sel=document.querySelector('#select-brand-ver');if(sel&&sel.value!==mode)sel.value=mode;
    const verInput=document.querySelector('#input-brand-ver');
    if(verInput){verInput.hidden=mode!=='custom';if(verInput.value!==custom)verInput.value=custom;}
  }
  function initBrand(){
    const verSel=document.querySelector('#select-brand-ver');
    if(verSel)verSel.addEventListener('change',()=>{store({brandVer:verSel.value});applyBrand();});
    const verInput=document.querySelector('#input-brand-ver');
    if(verInput)verInput.addEventListener('input',()=>{store({brandVerText:verInput.value});applyBrand();});
    applyBrand();
  }

  /* 外观面板「预设光影主题」右侧显示当前预设名（.wallpaper-layer[data-preset] 由 wallpaper.js 维护） */
  function syncPresetLabel(){
    const el=document.querySelector('#val-preset');if(!el)return;
    const wall=document.querySelector('#wallpaper-layer');
    const preset=wall&&wall.dataset.preset?wall.dataset.preset:'cosmos';
    const btn=document.querySelector(`[data-bg-preset="${preset}"]`);
    el.textContent=btn?String(btn.getAttribute('aria-label')||preset).replace(/\s*[（(].*$/,''):'自定义壁纸';
  }
  {
    const wall=document.querySelector('#wallpaper-layer');
    if(wall)new MutationObserver(syncPresetLabel).observe(wall,{attributes:true,attributeFilter:['data-preset']});
    syncPresetLabel();
  }

  applyBrand(); // 解析阶段先落地版本标签状态，避免闪烁

  const init=()=>{
    const wall=document.querySelector('#wallpaper-layer');if(!wall)return;
    const canvas=document.createElement('canvas');canvas.id='ambient-orbit';canvas.setAttribute('aria-hidden','true');wall.append(canvas);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    let scheduled=false;
    function draw(){
      scheduled=false;
      const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio||1,1.5);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      const light=document.documentElement.dataset.theme==='light-glass';
      const cx=w*.54,cy=h*1.10,r=Math.max(h*.88,w*.45);
      let seed=91353;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      const atmosphere=ctx.createRadialGradient(cx-r*.34,cy-r*.72,r*.08,cx,cy,r*1.13);
      atmosphere.addColorStop(0,light?'rgba(154,119,72,.12)':'rgba(173,132,80,.14)');atmosphere.addColorStop(.65,light?'rgba(148,112,69,.04)':'rgba(139,102,57,.06)');atmosphere.addColorStop(1,'rgba(100,74,42,0)');
      ctx.fillStyle=atmosphere;ctx.fillRect(0,0,w,h);
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
      const body=ctx.createRadialGradient(cx-r*.43,cy-r*.85,r*.03,cx+r*.15,cy+r*.15,r*1.3);
      body.addColorStop(0,light?'rgba(124,96,60,.13)':'rgba(166,126,73,.24)');body.addColorStop(.28,light?'rgba(155,137,112,.06)':'rgba(83,65,42,.11)');body.addColorStop(.7,light?'rgba(230,235,244,.02)':'rgba(8,10,12,.05)');body.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=body;ctx.fillRect(0,0,w,h);ctx.restore();
      for(let i=0;i<7200;i++){
        const angle=-Math.PI+rand()*Math.PI,spread=(rand()-.5)*r*.105;
        const radius=r+spread,x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;
        if(x<0||x>w||y<0||y>h)continue;
        const rim=Math.exp(-Math.abs(spread)/(r*.023)),upper=Math.max(.05,(-Math.sin(angle))*.85-Math.cos(angle)*.24);
        const a=(.025+rim*upper*.34)*(light?.4:1),size=.35+rand()*1.10;
        ctx.fillStyle=light?`rgba(112,83,45,${a})`:`rgba(209,172,111,${a})`;ctx.fillRect(x,y,size,size);
      }
      for(let i=0;i<2600;i++){
        const x=(rand()*2-1)*r,y=-rand()*r,dist=(x*x+y*y)/(r*r);if(dist>1)continue;
        const px=cx+x,py=cy+y;if(px<0||px>w||py<0||py>h)continue;
        const edge=Math.pow(dist,4),bright=Math.max(.01,-y/r-x/r*.28);
        ctx.fillStyle=light?`rgba(126,93,51,${edge*bright*.055})`:`rgba(170,135,81,${edge*bright*.13})`;ctx.fillRect(px,py,.5+rand()*.7,.5+rand()*.7);
      }
    }
    const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(draw);}};
    window.addEventListener('resize',schedule,{passive:true});new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});draw();
    function applyMaterial(name,value){
      const root=document.documentElement.style;
      if(name==='dimmer')root.setProperty('--bg-dimmer',(value/100).toFixed(2));
      else if(name==='radius')root.setProperty('--radius-scale',(value/100).toFixed(2));
      else root.setProperty('--glass-'+name,name==='blur'?value+'px':(value/100).toFixed(2));
    }
    const defaults={blur:14,alpha:48,dimmer:22,radius:100},units={blur:'px',alpha:'%',dimmer:'%',radius:'%'};
    for(const name of ['blur','alpha','dimmer','radius']){
      const input=document.querySelector('#slider-'+name),label=document.querySelector('#val-'+name);if(!input)continue;
      const value=Math.min(+input.max,Math.max(+input.min,Number.isFinite(+saved[name])?+saved[name]:defaults[name]));input.value=value;
      applyMaterial(name,value);if(label)label.textContent=value+units[name];
      input.addEventListener('input',()=>{const v=+input.value;applyMaterial(name,v);if(label)label.textContent=v+units[name];store({[name]:v});});
    }

  };
  // initBrand 需在 app.js 初始化之后再落地一次（app.js 会在 init 里写 document.title 与侧栏状态行）
  const initAll=()=>{initBrand();syncPresetLabel();};
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init,{once:true});document.addEventListener('DOMContentLoaded',initAll,{once:true});}
  else{init();initAll();}
})();
