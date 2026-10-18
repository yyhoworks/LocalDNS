/* Shared rule saves: read again, preserve the server content, then use the DNS API. */
(() => {
  'use strict';
  const running=new Set();
  const labels={whitelist:'白名单',blocklist:'黑名单',greylist:'灰名单',force_realip:'强制 RealIP',ddns_domains:'DDNS 域名',pcdn_domains:'PCDN 域名',pcdn_regex_v4:'PCDN IPv4',pcdn_regex_v6:'PCDN IPv6',client_ip:'客户端 IP',direct_ip:'直连 IP',rewrite:'重定向'};
  const normalize=value=>String(value).split('\n').map(line=>line.trim()).filter(Boolean).join('\n');
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(query={},body){
    const url=new URL(window.LOCALDNS_UI_CONFIG?.proxyConfigBase||location.origin);
    if(!window.LOCALDNS_UI_CONFIG?.proxyConfigBase)url.port='9098';
    url.pathname='/api/proxy-config/rule-backups';url.search=new URLSearchParams(query);url.hash='';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(url,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      const result=await response.json();
      if(response.status===404||response.status===405)throw new Error('名单备份需要配置管理服务 1.5.0 或更新版本，请先安装或升级配套服务。');
      if(!response.ok)throw new Error(result.error||'无法读取或保存名单备份。');
      return result;
    }catch(error){
      if(error.name==='AbortError')throw new Error('名单备份服务读取超时，请稍后重试。');
      if(error instanceof TypeError)throw new Error('无法连接名单备份服务，请检查配置管理服务。');
      throw error;
    }finally{clearTimeout(timer);}
  }
  async function save(tag,value,baseline,read,write){
    if(running.has(tag))throw new Error('这份名单正在保存，请稍候。');
    if(typeof baseline!=='string')throw new Error('名单尚未完整读取，请重新打开后保存。');
    running.add(tag);
    try{
      const current=String(await read());
      if(normalize(current)!==normalize(baseline))throw new Error('服务器上的名单已有变化。当前编辑已保留为草稿，请重新读取后核对，避免覆盖其他修改。');
      const result=await api({}, {tag,content:current});
      if(result.saved!==true||!result.backup?.id)throw new Error('服务器未确认备份成功，名单未保存。');
      const latest=String(await read());
      if(normalize(latest)!==normalize(current))throw new Error('备份期间名单已有变化，已停止覆盖。当前编辑仍在草稿中。');
      await write(normalize(value).split('\n').filter(Boolean));
      return result.backup;
    }finally{running.delete(tag);}
  }
  async function show(tag){
    let dialog=document.querySelector('#rule-backups-dialog');
    if(dialog)dialog.remove();
    dialog=document.createElement('dialog');dialog.id='rule-backups-dialog';dialog.className='wb-backups';
    dialog.innerHTML=`<header><div><h2>${esc(labels[tag]||tag)}备份</h2><p>保留最近 20 份；恢复后先载入草稿，核对并保存才生效。</p></div><button type="button" class="button small" data-close>关闭</button></header><div class="wb-backup-items" role="status">正在读取服务器备份…</div>`;
    document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
    const body=dialog.querySelector('.wb-backup-items');
    async function load(){
      try{
        const result=await api({tag});if(!dialog.isConnected)return;
        if(!Array.isArray(result.backups))throw new Error('备份列表格式无效，请重试。');
        body.innerHTML=result.backups.length?result.backups.map(backup=>`<article><div><strong>${esc(new Date(backup.time).toLocaleString('zh-CN',{hour12:false}))}</strong><span>${Math.ceil(backup.bytes/1024)} KB · 服务器备份</span></div><button type="button" class="button small" data-restore="${esc(backup.id)}">载入草稿</button></article>`).join(''):'<p class="wb-no-backup">还没有备份。首次保存时，会先在服务器备份原有内容。</p>';
        for(const button of body.querySelectorAll('[data-restore]'))button.onclick=async()=>{
          const text=document.querySelector('#rule-text'),active=document.querySelector('.rule-menu button.active')?.dataset.ruleTag;
          if(!text||active!==tag){error('当前名单已切换，请关闭后重新打开对应名单的备份。');return;}
          if(text.value!==text.dataset.original&&!confirm('载入备份将替换当前未保存的草稿，继续吗？'))return;
          const before=text.value;button.disabled=true;
          try{
            const backup=await api({tag,id:button.dataset.restore});
            if(!text.isConnected||document.querySelector('.rule-menu button.active')?.dataset.ruleTag!==tag||text.value!==before)throw new Error('读取期间编辑内容已变化，未替换草稿。');
            if(typeof backup.content!=='string'||backup.tag!==tag)throw new Error('备份内容无效，未替换草稿。');
            text.value=backup.content.trim();text.dispatchEvent(new Event('input',{bubbles:true}));window.LocalDNSRules?.refreshText();dialog.close();
          }catch(e){error(e.message);button.disabled=false;}
        };
      }catch(e){if(dialog.isConnected){body.innerHTML=`<p class="wb-error" role="alert">${esc(e.message)}</p><button type="button" class="button small" data-retry>重试</button>`;body.querySelector('[data-retry]').onclick=load;}}
    }
    function error(message){let p=dialog.querySelector('.wb-error');if(!p){p=document.createElement('p');p.className='wb-error';p.setAttribute('role','alert');dialog.append(p);}p.textContent=message;}
    await load();
  }
  window.LocalDNSRuleBackups={save,show,isSaving:tag=>running.has(tag)};
})();
