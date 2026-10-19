(() => {
  'use strict';
  const $=(s,r=document)=>r.querySelector(s);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={whitelist:'白名单',blocklist:'黑名单',greylist:'灰名单',force_realip:'强制 RealIP',ddns_domains:'DDNS 域名',pcdn_domains:'PCDN 域名',pcdn_regex_v4:'PCDN IPv4',pcdn_regex_v6:'PCDN IPv6',client_ip:'客户端 IP',direct_ip:'直连 IP',rewrite:'重定向'};
  function syncMode(){
    const host=$('#rv-root');
    if(!host){
      document.body.classList.remove('has-rules-workbench');
      const heading=$('.view-title-row h1');if(heading&&heading.textContent==='清单工作台')heading.textContent='规则管理';
      const note=$('.view-title-row .gc-sub');if(note&&note.textContent==='逐条编辑名单，随时切换原文。')note.textContent='维护本地名单、广告拦截与在线分流规则。';
    }if(!host)return;
    const raw=host.classList.contains('raw');
    for(const b of host.querySelectorAll('[data-wb-mode]'))b.setAttribute('aria-pressed',String((b.dataset.wbMode==='raw')===raw));
  }
  function enhance(){
    const main=$('#page-content');if(!main)return;
    if(document.body.dataset.consoleRoute!=='rules'){document.body.classList.remove('has-rules-workbench');return;}
    const host=$('#rv-root');
    if(!host){
      document.body.classList.remove('has-rules-workbench');
      const heading=$('.view-title-row h1');if(heading&&heading.textContent==='清单工作台')heading.textContent='规则管理';
      const note=$('.view-title-row .gc-sub');if(note&&note.textContent==='逐条编辑名单，随时切换原文。')note.textContent='维护本地名单、广告拦截与在线分流规则。';
    }
    const titleArea=$('.view-title-row>div:first-child');
    if(host&&titleArea&&!$('h1',titleArea))titleArea.insertAdjacentHTML('afterbegin','<h1>清单工作台</h1><span class="gc-sub">逐条编辑名单，随时切换原文。</span>');
    if(!host||host.dataset.workbench)return;
    host.dataset.workbench='1';
    document.body.classList.add('has-rules-workbench');
    const title=$('.view-title-row h1');if(title)title.textContent='清单工作台';
    const sub=$('.view-title-row .gc-sub');if(sub)sub.textContent='逐条编辑名单，随时切换原文。';
    const bar=$('.rv-toolbar',host),actions=$('.section-header-actions',bar);
    const heading=document.createElement('div');heading.className='wb-list-heading';
    heading.innerHTML=`<div><h2>${esc(names[$('.rule-menu button.active')?.dataset.ruleTag]||'名单管理')}</h2><p>启停与编辑先保留为草稿，保存后生效。</p></div><div class="wb-list-tools"><span class="wb-author">名单视图由 clone-fan 贡献</span></div>`;
    bar.before(heading);
    const modes=document.createElement('div');modes.className='wb-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','名单编辑方式');
    modes.innerHTML='<button type="button" data-wb-mode="list" aria-pressed="true">列表</button><button type="button" data-wb-mode="raw" aria-pressed="false">原文</button>';
    for(const button of modes.querySelectorAll('button'))button.onclick=()=>{
      const isRaw=host.classList.contains('raw');if((button.dataset.wbMode==='raw')!==isRaw)$('#rv-mode').click();syncMode();
    };
    if(actions)bar.insertBefore(modes,actions);else bar.append(modes);
    const save=$('#rule-save');if(save){save.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3h14l2 2v16H4zM8 3v7h8V3M8 21v-8h8v8"/></svg>保存';save.title='保存到 DNS 核心';}
    const list=$('.rv-list',host);if(list)list.setAttribute('aria-label','规则列表');
    const search=$('#rv-q');if(search)search.setAttribute('aria-label','搜索内容或类型');
    const raw=$('#rule-text');if(raw)raw.setAttribute('aria-label','名单原文');
    syncMode();
  }
  let queued=false;
  new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}).observe($('#page-content'),{subtree:true,childList:true});
  enhance();
})();
