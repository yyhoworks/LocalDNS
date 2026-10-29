import { currentScope } from '../../core/router/route-lifetime';
export let mountToolbar;
import { setHTML } from '../../core/security/safe-dom.ts';
export function initialize() {

  'use strict';
  const $=(s,r=document)=>r.querySelector(s);
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names={whitelist:'白名单',blocklist:'黑名单',greylist:'灰名单',force_realip:'强制 RealIP',ddns_domains:'DDNS 域名',pcdn_domains:'PCDN 域名',pcdn_regex_v4:'PCDN IPv4 规则',pcdn_regex_v6:'PCDN IPv6 规则',direct_ip:'直连 IP',rewrite:'重定向'};
  const notes={
    whitelist:'强制走国内直连解析，最高优先级放行 · 修改先保留为草稿，点击右侧“保存”后生效',
    greylist:'强制走代理解析组（FakeIP / 远程无污染解析）· 修改先保留为草稿，保存后生效',
    blocklist:'直接拦截并拒绝解析请求 · 修改先保留为草稿，保存后生效',
    force_realip:'匹配域名禁用 FakeIP，强制返回真实 IP 地址 · 修改先保留为草稿，保存后生效',
    ddns_domains:'动态域名直连解析并缩短缓存生存周期 · 修改先保留为草稿，保存后生效',
    direct_ip:'指定目的 IP 或 CIDR 网段强制直连 · 修改先保留为草稿，保存后生效',
    rewrite:'自定义域名重定向或 A/AAAA/CNAME 静态映射 · 修改先保留为草稿，保存后生效',
    pcdn_domains:'匹配常见 PCDN 节点域名并抑制解析 · 修改先保留为草稿，保存后生效',
    pcdn_regex_v4:'按正则表达式识别并过滤 PCDN IPv4 节点请求 · 修改先保留为草稿，保存后生效',
    pcdn_regex_v6:'按正则表达式识别并过滤 PCDN IPv6 节点请求 · 修改先保留为草稿，保存后生效'
  };
  function syncMode(){
    const host=$('#rv-root');
    if(!host){
      document.body.classList.remove('has-rules-workbench');
      return;
    }
    const raw=host.classList.contains('raw');
    for(const b of host.querySelectorAll('[data-wb-mode]'))b.setAttribute('aria-pressed',String((b.dataset.wbMode==='raw')===raw));
  }
  function enhance(){
    const main=$('#page-content');if(!main)return;
    if(document.body.dataset.consoleRoute!=='rules'){document.body.classList.remove('has-rules-workbench');return;}
    const host=$('#rv-root');
    if(!host){
      document.body.classList.remove('has-rules-workbench');
    }
    if(!host||host.dataset.workbench)return;
    host.dataset.workbench='1';
    document.body.classList.add('has-rules-workbench');
    const bar=$('.rv-toolbar',host),actions=$('.section-header-actions',bar);
    const activeTag=$('.rule-menu button.active')?.dataset.ruleTag;
    const heading=document.createElement('div');heading.className='wb-list-heading';
    setHTML(heading, `<div><h2>${esc(names[activeTag]||'名单管理')}</h2><p>${esc(notes[activeTag]||'启停与编辑先保留为草稿，保存后生效。')}</p></div><div class="wb-list-tools"><button type="button" class="workspace-text-button" data-route="devices">客户端 IP 与分流模式已移至「设备」›</button></div>`);
    bar.before(heading);
    const modes=document.createElement('div');modes.className='wb-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','名单编辑方式');
    setHTML(modes, '<button type="button" data-wb-mode="list" aria-pressed="true">列表</button><button type="button" data-wb-mode="raw" aria-pressed="false">原文</button>');
    for(const button of modes.querySelectorAll('button'))button.onclick=()=>{
      const isRaw=host.classList.contains('raw');if((button.dataset.wbMode==='raw')!==isRaw)$('#rv-mode').click();syncMode();
    };
    if(actions)bar.insertBefore(modes,actions);else bar.append(modes);
    const save=$('#rule-save');if(save){setHTML(save, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3h14l2 2v16H4zM8 3v7h8V3M8 21v-8h8v8"/></svg>保存');save.title='保存到 DNS 核心';}
    const list=$('.rv-list',host);if(list)list.setAttribute('aria-label','规则列表');
    const search=$('#rv-q');if(search)search.setAttribute('aria-label','搜索内容或类型');
    const raw=$('#rule-text');if(raw)raw.setAttribute('aria-label','名单原文');
    syncMode();
  }
  let active;
  mountToolbar = () => {
    const scope=currentScope();if(active===scope)return;active=scope;
    let queued=false,frame;
    const observer=new MutationObserver(()=>{if(queued)return;queued=true;frame=requestAnimationFrame(()=>{queued=false;if(!scope.signal.aborted)enhance();});});
    observer.observe($('#page-content'),{subtree:true,childList:true});
    scope.add(()=>{observer.disconnect();cancelAnimationFrame(frame);document.body.classList.remove('has-rules-workbench');});
    enhance();
  };
}
