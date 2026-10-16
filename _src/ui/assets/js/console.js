(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const drafts=new Map(),series=[];
  let connected=null,lastSuccess=null,lastFocus=null,historyKey='',draftKey='',observer=null,scheduled=false,shortcutsOpen=false;
  const route=()=>location.hash.replace(/^#\/?/,'')||'overview';
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={r1:'国内域名',r2:'白名单与自定义',r3:'海外域名',r4:'FakeIP 与灰名单',r5:'广告与追踪拦截',r6:'黑名单与类型过滤',g1:'国内解析组',g2:'海外解析组',g3:'海外 ECS 组',g4:'代理解析组',g5:'本地拦截'};
  const activeTag=()=>$('.rule-menu button.active')?.dataset.ruleTag;
  function persistDrafts(){try{sessionStorage.setItem(draftKey,JSON.stringify([...drafts]));}catch{}}
  function rememberDraft(){const text=$('#rule-text'),tag=activeTag();if(text&&tag&&text.dataset.original!==undefined){if(text.value!==text.dataset.original)drafts.set(tag,text.value);else drafts.delete(tag);persistDrafts();}}
  function updateBrand(){
    const light=document.documentElement.dataset.theme==='light-glass';
    const base=light?'logo-04-light':'logo-08-dark';
    const img=$('#brand-mark');if(img)img.src=`assets/img/${base}.png?v=20261015-2`;
    const favicon=$('#dynamic-favicon');if(favicon){favicon.type='image/png';favicon.href=`assets/img/${base}-64.png?v=20261015-2`;}
  }
  function connection(ok,text=''){
    if(typeof ok==='boolean'){connected=ok;if(ok)lastSuccess=new Date();}
    const status=$('#connection-status');if(!status)return;
    status.classList.toggle('offline',connected===false);
    $('.console-connection-text',status).textContent=connected===null?'连接中':connected?'已连接':'连接已断开';
    const time=lastSuccess?lastSuccess.toLocaleTimeString('zh-CN',{hour12:false}):null;
    $('small',status).textContent=connected===false?(time?`最后更新 ${time}`:'当前数据不可用'):(time?`更新于 ${time}`:'正在读取运行数据');
    status.title=connected===false?String(text||'连接异常'):('API '+(window.LOCALDNS_UI_CONFIG?.apiBase||location.host));
    const mobile=$('.console-mobile-status');if(mobile){mobile.classList.toggle('offline',connected===false);mobile.textContent=(connected===null?'连接中':connected?'已连接':'连接已断开')+(time?` · ${connected===false?'最后更新':'更新于'} ${time}`:'');}
    const health=$('.console-service-health');if(health){health.classList.toggle('offline',connected===false);$('#service-summary-title',health).textContent=connected===false?'DNS 服务连接已断开':connected===true?'DNS 服务运行中':'正在读取服务状态';$('.service-connection',health).textContent=connected===null?'连接中':connected?'已连接':'已断开';$('[data-service-check]',health).setAttribute('d',connected===false?'m8 8 8 8m0-8-8 8':'m7 12 3 3 7-7');}
  }
  function recordMetrics(sample){
    const now=Date.now(),previous=series.at(-1);
    const total=Number(sample.total);
    if(!Number.isFinite(total)||total<0)return;
    if(previous&&((sample.start&&previous.start&&sample.start!==previous.start)||total<previous.total))series.length=0;
    const last=series.at(-1);
    if(last&&now-last.time<1500)return;
    const gap=last?(now-last.time)/1000:null;
    const qps=last&&gap>0&&gap<=120?Math.max(0,(total-last.total)/gap):null;
    series.push({time:now,start:Number(sample.start)||0,total,qps,latency:Number.isFinite(+sample.latency)?+sample.latency:null,cache:sample.cacheEnabled&&Number.isFinite(+sample.cache)?+sample.cache:null,clients:+sample.clients||0,domains:+sample.domains||0,blocked:+sample.blocked||0});
    while(series.length>240||series[0]?.time<now-7200000)series.shift();
    try{sessionStorage.setItem(historyKey,JSON.stringify(series));}catch{}
  }
  function tinyPath(values,width=100,height=32){const min=Math.min(...values),max=Math.max(...values),span=max-min||1;return values.map((v,i)=>`${i?'L':'M'}${(i/(values.length-1)*(width-4)+2).toFixed(1)},${(height-4-(v-min)/span*(height-10)).toFixed(1)}`).join(' ');}
  function chartSVG(points){
    const w=660,h=164,left=36,right=10,top=12,bottom=25;
    const times=points.map(p=>p.time),first=Math.min(...times),last=Math.max(...times),timeSpan=last-first||1;
    const max=Math.max(1,Math.ceil(Math.max(...points.map(p=>p.qps))/5)*5),innerH=h-top-bottom;
    const parts=[];let part=[];
    for(const sample of points){if(sample.qps===null){if(part.length)parts.push(part);part=[];continue;}part.push([left+(sample.time-first)/timeSpan*(w-left-right),top+(1-sample.qps/max)*innerH]);}if(part.length)parts.push(part);
    const paths=parts.filter(p=>p.length).map(ps=>`<path d="${ps.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}" fill="none" stroke="var(--console-line)" stroke-width="2" stroke-linejoin="round"/>`).join('');
    const grids=[0,max/2,max].map(v=>{const y=top+(1-v/max)*innerH;return `<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="var(--border-glass)" stroke-dasharray="3 5"/><text x="${left-8}" y="${y+3}" text-anchor="end" fill="var(--text-3)" font-size="10">${v>=10?Math.round(v):v.toFixed(1)}</text>`;}).join('');
    const time=v=>new Date(v).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});
    return `<svg class="console-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="DNS 查询吞吐量，从 ${time(first)} 到 ${time(last)}，单位每秒请求数"><title>当前浏览器会话采样 · QPS</title>${grids}${paths}<text x="${left}" y="${h-5}" fill="var(--text-3)" font-size="10">${time(first)}</text><text x="${(w+left)/2}" y="${h-5}" text-anchor="middle" fill="var(--text-3)" font-size="10">${time((first+last)/2)}</text><text x="${w-right}" y="${h-5}" text-anchor="end" fill="var(--text-3)" font-size="10">${time(last)}</text></svg>`;
  }
  function drawTraffic(container,minutes=30){
    const points=series.filter(p=>p.time>=Date.now()-minutes*60000);
    const valid=points.filter(p=>Number.isFinite(p.qps));
    container.innerHTML=valid.length>=2?chartSVG(points):'<div class="console-chart-empty">正在积累趋势数据，至少需要三次采样。<br>切换页面不会清除本次会话的数据。</div>';
  }
  function overview(){
    const main=$('#page-content');if($('.console-kpi',main)||!$('.spark-kpi-card',main))return;
    $('#btn-overview-custom-bg')?.remove();
    const title=$('.view-title-row'),short=document.createElement('details');short.className='console-shortcuts';short.open=shortcutsOpen;short.innerHTML='<summary><strong>快捷控制</strong><span>客户端分流 / 缓存 / 广告屏蔽</span></summary><div class="console-shortcut-grid"></div>';short.addEventListener('toggle',()=>shortcutsOpen=short.open);
    $$('.control-bar-card',main).forEach(card=>{const old=card.parentElement;$('.console-shortcut-grid',short).append(card);old.remove();});title.after(short);
    $$('.spark-kpi-card',main).forEach((card,i)=>{card.parentElement.classList.add('console-kpi');const key=['total','cache','clients','blocked','latency','domains'][i];const values=series.slice(-60).map(p=>p[key]).filter(Number.isFinite);const svg=$('.sk-chart',card);if(svg){if(values.length<2){svg.remove();}else{svg.innerHTML=`<path d="${tinyPath(values)}" fill="none" stroke="var(--console-line)" stroke-width="1.8"/>`;svg.setAttribute('aria-label','当前会话采样趋势');}}});
    const service=$('.console-service-summary',main);if(service){$$('.console-kpi',main).forEach(kpi=>service.append(kpi));$('.view-title-row>div:first-child>.mono',main)?.remove();}
    const topo=$('.topology-glass-card');topo.parentElement.classList.add('console-topology');if(!$('.console-topology-heading',topo))topo.insertAdjacentHTML('afterbegin','<div class="console-topology-heading"><h2>DNS 解析路径</h2><span>选择节点查看详情 · 连线为解析路径示意</span></div>');
    const trend=$('.traffic-chart-body');trend.closest('.col-8').classList.add('console-trend');
    const head=$('.gc-head',trend.closest('.glass-card'));$('.gc-title',head).innerHTML='查询吞吐趋势<span class="console-chart-sub">QPS · 当前浏览器会话采样</span>';
    const range=head.lastElementChild;range.className='console-range';range.removeAttribute('style');range.innerHTML='<button type="button" data-chart-range="15" aria-pressed="false">15 分钟</button><button type="button" data-chart-range="30" aria-pressed="true">30 分钟</button>';
    drawTraffic(trend);$$('[data-chart-range]',head).forEach(b=>b.onclick=()=>{$$('[data-chart-range]',head).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));drawTraffic(trend,+b.dataset.chartRange);});
    $('.outbound-donut-body')?.closest('.col-4').classList.add('console-donut');$$('.uniform-4rows').forEach(e=>e.closest('.col-4')?.classList.add('console-lower'));
    $$('.t-node').forEach(node=>{const name=$('.tn-name',node),sub=$('.tn-sub',node);if(!node.title)node.title=[name?.textContent,sub?.textContent].filter(Boolean).join(' · ');if(labels[node.dataset.nodeId]&&!$('.tn-proto-tag',name))name.textContent=labels[node.dataset.nodeId];if(node.dataset.nodeId==='e_core')node.setAttribute('aria-label','查看多级缓存管理');});
    const names={whitelist:'白名单',greylist:'灰名单',blocklist:'黑名单'};$$('.rl-name').forEach(e=>{const t=e.lastChild;if(t?.nodeType===3)t.textContent=names[t.textContent.trim()]||t.textContent;});requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  function semantics(root=document){
    $$('input:not([type=file]),select,textarea',root).forEach(input=>{const field=input.closest('.field'),label=field&&$('label',field);if(label&&input.id)label.htmlFor=input.id;if(input.type==='checkbox'&&!input.getAttribute('aria-label'))input.setAttribute('aria-label',input.closest('.feature-card')?.querySelector('h3')?.textContent||input.closest('tr')?.querySelector('strong')?.textContent||input.closest('label')?.textContent.trim()||'启用');});
    $$('.t-node,.spark-kpi-card,[data-route]',root).forEach(el=>{if(!['BUTTON','A'].includes(el.tagName)){el.tabIndex=0;el.setAttribute('role','button');if(!el.dataset.consoleKeyboard){el.dataset.consoleKeyboard='1';el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});}}});
    $$('[data-route]',root).forEach(el=>{if(el.classList.contains('active'))el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});$$('.seg-item',root).forEach(el=>el.setAttribute('aria-pressed',String(el.classList.contains('active'))));
    $$('table',root).forEach(table=>{const heads=$$('thead th',table).map(x=>x.textContent.trim());if(!heads.length)return;table.classList.add('mobile-records');$$('tbody tr',table).forEach(tr=>$$('td',tr).forEach((td,i)=>{if(!td.dataset.label)td.dataset.label=heads[i]||'';}));});
    $$('label',root).forEach(label=>{if(label.querySelector('input[type=file]')){label.tabIndex=0;label.setAttribute('role','button');if(!label.dataset.consoleKeyboard){label.dataset.consoleKeyboard='1';label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();label.querySelector('input').click();}};}}});
  }
  function ruleState(){const el=$('.console-rule-state'),tag=activeTag();if(!el)return;const dirty=drafts.has(tag);el.classList.toggle('dirty',dirty);el.textContent=dirty?'有未保存修改 · 切换名单将保留草稿':'当前内容已保存';}
  function rules(){const text=$('#rule-text'),tag=activeTag();if(!text||!tag)return;if(!text.dataset.consoleDraft){text.dataset.consoleDraft='1';text.dataset.original=text.value;if(drafts.has(tag)&&drafts.get(tag)===text.value){drafts.delete(tag);persistDrafts();}if(drafts.has(tag))text.value=drafts.get(tag);text.addEventListener('input',()=>{rememberDraft();ruleState();});$('.section-header>div')?.insertAdjacentHTML('beforeend','<div class="console-rule-state" role="status"></div>');if(!$('.console-rule-select')){const select=document.createElement('div');select.className='console-rule-select';select.innerHTML='<label for="console-list-select">名单类别</label><select id="console-list-select">'+$$('.rule-menu button').map(b=>`<option value="${escape(b.dataset.ruleTag)}" ${b.dataset.ruleTag===tag?'selected':''}>${escape(b.querySelector('span').textContent)}</option>`).join('')+'</select>';$('.rule-editor').prepend(select);$('select',select).onchange=e=>{rememberDraft();$(`.rule-menu [data-rule-tag="${e.target.value}"]`)?.click();};}}ruleState();}
  function ruleSaved(tag,value){if(drafts.get(tag)===value||!drafts.has(tag))drafts.delete(tag);persistDrafts();if(activeTag()===tag){const text=$('#rule-text');if(text)text.dataset.original=value;ruleState();}}
  function displayNumerals(){
    $$('.console-kpi .sk-val,.tec-big,.ring-center,.service-value[data-display-number]').forEach(el=>{
      if(el.classList.contains('has-display-number')){
        if(el.querySelector('.display-number'))return;
        el.classList.remove('has-display-number');
      }
      const value=el.textContent.trim(),match=value.match(/^([+\-]?\d[\d,.]*)(\s*(?:%|ms|s|KB|MB|GB|TB|万|亿))?$/);
      if(!match)return;
      el.classList.add('has-display-number');
      el.style.setProperty('--numeral-size',`${Math.min(38,260/match[1].length).toFixed(2)}px`);
      const number=document.createElement('span');number.className='display-number';number.textContent=match[1];el.replaceChildren(number);
      if(match[2]){const unit=document.createElement('span');unit.className='display-unit';unit.textContent=match[2];el.append(unit);}
    });
  }
  function apply(){
    observer?.disconnect();
    try{document.body.dataset.consoleRoute=route();updateBrand();if(!$('.console-mobile-status')&&$('.view-title-row>div:first-child')){const mobile=document.createElement('span');mobile.className='console-mobile-status';mobile.setAttribute('role','status');$('.view-title-row>div:first-child').append(mobile);}connection();if(route()==='overview'){overview();displayNumerals();}if(route()==='rules')rules();semantics();if(route()==='management'&&!$('.console-restart')){const b=document.createElement('button');b.className='glass-btn console-restart';b.textContent='重启服务';b.onclick=()=>$('#restart-button').click();$('.view-title-row')?.append(b);}}
    finally{observer?.observe($('#page-content'),{childList:true,subtree:true});}
  }
  function drawerOpened(){lastFocus=document.activeElement;$('.master-container').inert=true;$('#drawer-close').focus();}
  function drawerClosed(){$('.master-container').inert=false;if(lastFocus?.isConnected)lastFocus.focus();lastFocus=null;}
  function formError(message){let error=$('#modal-error');if(!error){error=document.createElement('div');error.id='modal-error';error.className='form-error';error.setAttribute('role','alert');$('#modal-content').prepend(error);}error.textContent=message;}
  function setup(options={}){
    historyKey='localdns-trends-v1:'+(options.apiBase||location.host);draftKey='localdns-drafts-v1:'+(options.apiBase||location.host);
    try{const data=JSON.parse(sessionStorage.getItem(historyKey)||'[]');if(Array.isArray(data))series.push(...data.filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.total)&&x.time>Date.now()-7200000).slice(-240));}catch{}
    try{for(const item of JSON.parse(sessionStorage.getItem(draftKey)||'[]'))if(Array.isArray(item)&&typeof item[0]==='string'&&typeof item[1]==='string')drafts.set(...item);}catch{}
    const mobileSearch=document.createElement('button');mobileSearch.type='button';mobileSearch.className='icon-action-btn console-search-button';mobileSearch.style.display='none';mobileSearch.setAttribute('aria-label','搜索域名、客户端或页面');mobileSearch.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';mobileSearch.onclick=()=>{const bar=$('.cmd-search-bar');bar.classList.toggle('console-search-open');if(bar.classList.contains('console-search-open'))$('#global-search-input').focus();};$('.top-actions-dock').prepend(mobileSearch);
    const optionsBox=document.createElement('div');optionsBox.className='console-appearance-options';const particles=$('#btn-toggle-particles');if(particles){particles.insertAdjacentHTML('beforeend','<span>拓扑粒子</span>');optionsBox.append(particles);$('.bcp-title').after(optionsBox);}
    const status=document.createElement('div');status.id='connection-status';status.className='console-status';status.setAttribute('role','status');status.innerHTML='<span class="status-dot"></span><span class="console-status-text"><span class="console-connection-text">连接中</span><small>正在读取运行数据</small></span>';$('#btn-open-bg-customizer').closest('.glass-action-capsule').before(status);
    const drawer=$('#drawer');drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-labelledby','drawer-title');
    document.addEventListener('click',e=>{if(e.target.closest('[data-rule-tag],[data-route],#theme-toggle,#refresh-button'))rememberDraft();if(e.target.closest('[data-route]'))$('.cmd-search-bar').classList.remove('console-search-open');},true);
    window.addEventListener('beforeunload',e=>{rememberDraft();if(drafts.size){e.preventDefault();e.returnValue='';}});
    document.addEventListener('keydown',e=>{if(!drawer.classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();$('#drawer-close').click();}if(e.key==='Tab'){const items=$$('button,a,input,select,textarea,[tabindex="0"]',drawer).filter(x=>x.getClientRects().length);if(!items.length)return;if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}});
    observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;observer.disconnect();try{semantics($('#page-content'));if(route()==='overview')displayNumerals();if(route()==='rules')rules();}finally{observer.observe($('#page-content'),{childList:true,subtree:true});}});});observer.observe($('#page-content'),{childList:true,subtree:true});updateBrand();connection();semantics();
  }
  window.LocalDNSInterface={setup,apply,rememberDraft,recordMetrics,connection,updateBrand,ruleSaved,drawerOpened,drawerClosed,semantics,formError,displayNumerals};
})();
