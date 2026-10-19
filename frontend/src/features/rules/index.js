import { LatestView } from '../../core/lifecycle/latest-view';
import { mountToolbar } from './toolbar.js';
import { currentScope } from '../../core/router/route-lifetime';
import { ruleConversionService } from './conversion.js';
import { shellInterfaceService } from '../shell/interface.js';
import { workspaceService } from '../../shared/workspace.js';
import { ruleSaveService } from './save.js';
import { rulesWorkbenchService } from './workbench.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { page, $$, $, state } from '../../core/context.js';
import { loadingPage, card } from '../../shared/components/templates.js';
import { api } from '../../core/api/api.js';
import { icon } from '../../shared/components/icons.js';
import { esc, num, fmtDate } from '../../shared/format/number.js';
import { fitRuleLayoutHeight } from '../shell/controller.js';
import { toast } from '../../shared/components/toast.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { downloadText } from '../../shared/downloads.js';
import { safeResult } from '../../shared/async.js';

  const ruleProfiles=[['whitelist','白名单'],['blocklist','黑名单'],['greylist','灰名单'],['force_realip','强制 RealIP'],['ddns_domains','DDNS 域名'],['pcdn_domains','PCDN 域名'],['pcdn_regex_v4','PCDN IPv4 规则'],['pcdn_regex_v6','PCDN IPv6 规则'],['client_ip','客户端 IP'],['direct_ip','直连 IP'],['rewrite','重定向']];

  let ruleViews, activeTab='lists';

  async function renderRules(container, context){
 const renderScope = context.scope, page = container;
 ruleViews=new LatestView(renderScope);
 activeTab='lists';
 rulesWorkbenchService.mount();
 mountToolbar();

    setHTML(page, `
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>规则管理</h1><span class="gc-sub">统一维护本地名单、AdGuard 广告拦截与 SRS 在线分流规则</span></div>
      <div class="seg-group" id="rule-top-tabs">
        <button type="button" class="seg-item active" data-rule-tab="lists">名单管理</button>
        <button type="button" class="seg-item" data-rule-tab="adguard">广告拦截 (AdGuard)</button>
        <button type="button" class="seg-item" data-rule-tab="diversion">在线分流 (SRS)</button>
      </div>
    </div>
    <div id="rule-tab-body" class="col-12"></div>`);
    $$('[data-rule-tab]').forEach(x=>x.onclick=()=>renderRuleTab(x.dataset.ruleTab));
    await renderScope.guard(renderRuleTab('lists'));
  }

  async function renderRuleTab(tab,approved=false){
 const renderScope = currentScope();
if(!approved&&rulesWorkbenchService?.canLeave(()=>renderRuleTab(tab,true))===false)return;activeTab=tab;$$('[data-rule-tab]').forEach(y=>y.classList.toggle('active',y.dataset.ruleTab===tab));const body=$('#rule-tab-body');setHTML(body, loadingPage());if(tab==='lists')return renderListRules(body);if(tab==='adguard')return renderAdguard(body);return renderDiversion(body);}

  async function renderListRules(body){
 if(activeTab!=='lists'||!body?.isConnected||currentScope().signal.aborted)return;
 const renderScope = ruleViews.begin();

    if(!ruleProfiles.some(x=>x[0]===state.ruleTag))state.ruleTag=ruleProfiles[0][0];
    const tag=state.ruleTag,profile=ruleProfiles.find(x=>x[0]===tag)||ruleProfiles[0];
    let text='',loadError=null;
    try{text=await renderScope.guard(api.request(`/plugins/${tag}/show?all=1`,{signal:renderScope.signal}))}catch(e){if(renderScope.signal.aborted)return;loadError=e}
    const menu=`<div class="rule-menu">${ruleProfiles.map(([t,n])=>`<button data-rule-tag="${t}" class="${t===tag?'active':''}"><span>${n}</span><span class="rule-count"></span></button>`).join('')}</div>`;
    if(loadError){
      setHTML(body, `<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>读取失败时禁止保存，现有规则不会被覆盖。</p></div><button class="button" id="rule-retry">${icon('refresh')}重试</button></div><div class="error-panel"><strong>规则列表加载失败</strong><p>${esc(loadError.message)}</p></div></div></div></section>`);
      $$('[data-rule-tag]').forEach(x=>x.onclick=()=>{const go=()=>{state.ruleTag=x.dataset.ruleTag;renderListRules(body)};if(rulesWorkbenchService?.canLeave(go)!==false)go();});$('#rule-retry').onclick=()=>renderListRules(body);requestAnimationFrame(fitRuleLayoutHeight);return;
    }
    const trimmed=String(text).trim();
    setHTML(body, `<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>一行一条；完整读取后才允许保存</p></div><div class="section-header-actions"><button class="button small" id="rule-download">${icon('download')}下载列表</button><button class="button primary" id="rule-save">${icon('save')}保存</button></div></div><textarea id="rule-text" class="rule-textarea" spellcheck="false">${esc(trimmed)}</textarea><div class="rule-editor-footer"><span id="rule-lines">共 ${trimmed?trimmed.split('\n').length:0} 行</span></div></div></div></section>`);
    $$('[data-rule-tag]').forEach(x=>x.onclick=()=>{const go=()=>{state.ruleTag=x.dataset.ruleTag;renderListRules(body)};if(rulesWorkbenchService?.canLeave(go)!==false)go();});
    $('#rule-text').oninput=()=>$('#rule-lines').textContent=`共 ${$('#rule-text').value.split('\n').filter(Boolean).length} 行`;
    $('#rule-save').onclick=async()=>{
      const button=$('#rule-save'),text=$('#rule-text'),value=text.value,baseline=text.dataset.original;
      button.disabled=true;
      try{
        await ruleSaveService.save(tag,value,baseline,()=>api.request(`/plugins/${tag}/show?all=1`),values=>api.json(`/plugins/${tag}/post`,'POST',{values}));
        shellInterfaceService?.ruleSaved(tag,value);toast(`${profile[1]}已保存`);
      }catch(e){toast('保存失败','error',e.message)}finally{if(button.isConnected)button.disabled=false}
    };
    $('#rule-download').onclick=()=>downloadText(`${tag}.txt`,$('#rule-text').value);requestAnimationFrame(fitRuleLayoutHeight);
  }

  async function renderAdguard(body){
 if(activeTab!=='adguard'||!body?.isConnected||currentScope().signal.aborted)return;
 const renderScope = ruleViews.begin();

    let rules=[];
    try{rules=(await renderScope.guard(api.request('/plugins/adguard/rules',{signal:renderScope.signal}))).slice()}catch(e){if(renderScope.signal.aborted)return;setHTML(body, `<div class="error-panel"><strong>广告规则读取失败</strong><p>${esc(e.message)}</p></div>`);return}
    rules.sort((a,b)=>Number(Boolean(b.enabled))-Number(Boolean(a.enabled)));
    const sourceErrors=rules.filter(r=>r.last_error);
    setHTML(body, card('广告拦截规则',`${sourceErrors.length?`<div class="error-panel">${sourceErrors.map(r=>`${esc(r.name)}：${esc(r.last_error)}`).join('；')}</div>`:''}<div class="table-wrap adguard-table-wrap mobile-card-table"><table class="adguard-rules-table adguard-card-table"><colgroup><col class="col-enabled"><col class="col-name"><col class="col-url"><col class="col-count"><col class="col-auto"><col class="col-updated"><col class="col-actions"></colgroup><thead><tr><th>启用</th><th>名称</th><th>订阅地址</th><th>规则数</th><th>自动更新</th><th>上次更新</th><th>操作</th></tr></thead><tbody>${rules.length?rules.map(r=>`<tr data-id="${esc(r.id)}"><td class="ad-enabled-cell mobile-toggle-cell"><label class="switch"><input class="ad-enable" type="checkbox" ${r.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td class="ad-name-cell mobile-name-cell" title="${esc(r.name)}"><strong>${esc(r.name)}</strong></td><td class="ad-url-cell mobile-url-cell" data-label="订阅地址" title="${esc(r.url)}"><span class="table-ellipsis mobile-ellipsis">${esc(r.url)}</span></td><td class="ad-count-cell mobile-count-cell" data-label="规则数">${num(r.rule_count)}</td><td class="ad-auto-cell mobile-auto-cell" data-label="自动更新">${r.auto_update?'是':'否'}</td><td class="ad-updated-cell mobile-updated-cell" data-label="上次更新">${fmtDate(r.last_updated)}</td><td class="ad-actions-cell mobile-actions-cell"><div class="table-row-actions card-actions"><button class="button small ad-update">更新</button><button class="button small ad-edit">编辑</button><button class="button small danger ad-delete">删除</button></div></td></tr>`).join(''):`<tr><td colspan="7" class="table-empty">暂无规则</td></tr>`}</tbody></table></div>`,{iconName:'rules',actions:'<button class="button" id="ad-update-all">更新全部</button><button class="button primary" id="ad-add">'+icon('plus')+'添加订阅</button>'}));
    const findRule=tr=>rules.find(r=>String(r.id)===tr.dataset.id);
    $$('.ad-enable').forEach(x=>x.onchange=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{await updateAdguard(rule,{enabled:x.checked});toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}`);await renderAdguard(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.ad-update').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{const r=await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}/update`,{method:'POST'});toast(`广告规则“${rule.name}”更新完成`,'success',`规则数：${num(r?.rule_count||0)}`);await renderAdguard(body)}catch(e){toast(`“${rule.name}”更新失败`,'error',e.message)}finally{x.disabled=false}});
    $$('.ad-edit').forEach(x=>x.onclick=()=>openAdguardModal(findRule(x.closest('tr')),body));
    $$('.ad-delete').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule||!confirm(`确定删除广告规则“${rule.name}”？`))return;x.disabled=true;try{await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}`,{method:'DELETE'});toast('广告规则已删除');await renderAdguard(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#ad-update-all').onclick=async()=>{const btn=$('#ad-update-all');btn.disabled=true;try{const r=await api.request('/plugins/adguard/update',{method:'POST'});const errors=Array.isArray(r?.errors)?r.errors:[];if(errors.length){toast(`广告规则更新完成，失败 ${errors.length} 条`,'error',errors.map(x=>`${x.name}：${x.error}`).join('；'))}else toast(`广告规则更新完成：${Number(r?.updated_sources||0)} 条`);await renderAdguard(body)}catch(e){toast('广告规则更新失败','error',e.message)}finally{btn.disabled=false}};
    $('#ad-add').onclick=()=>openAdguardModal(null,body);
  }

  async function updateAdguard(rule,patch){
    const next=Object.assign({},rule,patch);
    delete next.last_error;
    await api.json(`/plugins/adguard/rules/${rule.id}`,'PUT',next);
  }

  function openAdguardModal(rule,body){
    rule=rule||{name:'',url:'',files:'',enabled:true,auto_update:true,update_interval_hours:24};
    modalOpen(rule.id?'编辑广告规则':'添加广告规则','订阅下载后保存为 TXT（保留 AdGuard 语法），所有启用的订阅合并为 rules/compiled/adguard.txt。',`<div class="stack"><div class="field"><label>名称</label><input id="ad-name" value="${esc(rule.name)}"></div><div class="field"><label>订阅地址</label><input id="ad-url" value="${esc(rule.url)}" placeholder="https://example.com/adblock.txt"></div><div class="field"><label>源缓存文件（可选）</label><input id="ad-files" value="${esc(rule.files||'')}" placeholder="留空时从 URL 自动生成"><p class="form-note">统一保存到 rules/online/adguard/，后缀固定为 .txt；留空时从 URL 路径提取文件名，query/fragment 不会写入文件名。</p></div><div class="grid grid-2"><label class="switch"><input id="ad-enabled" type="checkbox" ${rule.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="ad-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="ad-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div></div>`,async()=>{
      const payload={name:$('#ad-name').value.trim(),url:$('#ad-url').value.trim(),files:$('#ad-files').value.trim(),enabled:$('#ad-enabled').checked,auto_update:$('#ad-auto').checked,update_interval_hours:+$('#ad-hours').value||24};
      if(!payload.name||!payload.url)throw new Error('名称和地址不能为空');
      if(rule.rule_count!==undefined)payload.rule_count=rule.rule_count;
      if(rule.last_updated)payload.last_updated=rule.last_updated;
      if(rule.id)await api.json(`/plugins/adguard/rules/${rule.id}`,'PUT',Object.assign({},rule,payload,{last_error:undefined}));else await api.json('/plugins/adguard/rules','POST',payload);
      toast(`广告规则已${rule.id?'更新':'添加'}`);
      await renderAdguard(body);
    });
  }

  const diversionDefs=[
    {tag:'custom_cn',type:'custom_cn',label:'国内规则',domainRules:true},
    {tag:'custom_non_cn',type:'custom_non_cn',label:'国外规则',domainRules:true},
    {tag:'geoip_cn',type:'geoip_cn',label:'GeoIP CN',domainRules:false},
    {tag:'geosite_cn',type:'geosite_cn',label:'Geosite CN',domainRules:true},
    {tag:'geosite_non_cn',type:'geosite_non_cn',label:'Geosite 非 CN',domainRules:true}
  ];

  const diversionDefByTag=tag=>diversionDefs.find(x=>x.tag===tag);

  const diversionDefByType=type=>diversionDefs.find(x=>x.type===type);

  const diversionFormatLabel=r=>ruleConversionService.label(r);

  function diversionPayload(rule){
    const target=diversionDefByType(rule.type);
    const payload={
      name:String(rule.name||'').trim(), type:String(rule.type||'').trim(),
      files:String(rule.files||'').trim(), url:String(rule.url||'').trim(),
      dataset:String(rule.dataset||'').trim(),
      auto_update:Boolean(rule.auto_update), update_interval_hours:+rule.update_interval_hours||24,
      enabled:rule.enabled!==false
    };
    if(target&&target.domainRules!==false)payload.enable_regexp=true;
    if(!payload.dataset)delete payload.dataset;
    if(rule.rule_count!==undefined&&rule.rule_count!==null)payload.rule_count=+rule.rule_count||0;
    if(rule.last_updated)payload.last_updated=rule.last_updated;
    if(rule.detected_format)payload.detected_format=rule.detected_format;
    return payload;
  }

  async function saveDiversionRule(rule,original=null){
    const target=diversionDefByType(rule.type);if(!target)throw new Error('请选择有效的规则类型');
    const payload=diversionPayload(ruleConversionService.withMetadata(rule,original));if(!payload.name)throw new Error('名称不能为空');if(!payload.url)throw new Error('订阅地址不能为空');
    const response=await api.json(`/plugins/${target.tag}/config/${encodeURIComponent(payload.name)}`,'PUT',payload);
    const saved=await ruleConversionService.finishSave(response,()=>api.request(`/plugins/${target.tag}/update/${encodeURIComponent(payload.name)}`,{method:'POST'}));
    if(original&&(original.tag!==target.tag||original.name!==payload.name)){
      await api.request(`/plugins/${original.tag}/config/${encodeURIComponent(original.name)}`,{method:'DELETE'});
    }
    return saved;
  }

  function openDiversionDatasetPrompt(rule,datasets,body,original=rule){
    const options=(Array.isArray(datasets)?datasets:[]).map(x=>String(x||'').trim()).filter(Boolean);
    if(!options.length){toast('更新失败','error','数据源要求选择数据集，但没有返回可用数据集');return;}
    modalOpen('请选择数据集 / Tag','检测到多数据集 DAT。选择一次后会作为隐藏元数据保存，后续自动更新将直接复用。',`<div class="stack"><div class="field"><label>数据集 / Tag</label><select id="div-dataset-choice">${options.map(x=>`<option value="${esc(x)}" ${x===rule.dataset?'selected':''}>${esc(x)}</option>`).join('')}</select></div><p class="form-note">此选择只在多数据集 DAT 需要时出现，不会重新加入常驻的格式或匹配设置。</p></div>`,async()=>{
      const dataset=$('#div-dataset-choice').value;
      const saved=await saveDiversionRule({...rule,dataset},original);
      workspaceService.clearRuleDraft(original);
      toast('识别与转换完成','success',ruleConversionService.message(saved));
      await renderDiversion(body);
    });
  }

  async function updateDiversionRule(rule,body){
    try{
      const result=await api.request(`/plugins/${rule.tag}/update/${encodeURIComponent(rule.name)}`,{method:'POST'});
      const source=ruleConversionService.updated(result);if(source)Object.assign(rule,source);
      toast('规则更新完成','success',ruleConversionService.message(result));
      await renderDiversion(body);
      return result;
    }catch(err){
      if(err.body?.code==='dataset_required'&&Array.isArray(err.body.datasets)){
        openDiversionDatasetPrompt(rule,err.body.datasets,body);
        return null;
      }
      throw err;
    }
  }

  async function renderDiversion(body){
 if(activeTab!=='diversion'||!body?.isConnected||currentScope().signal.aborted)return;
 const renderScope = ruleViews.begin();

    let all;try{all=await renderScope.guard(Promise.all(diversionDefs.map(async def=>{const result=await safeResult(()=>api.request(`/plugins/${def.tag}/config`,{signal:renderScope.signal}));return result.ok?{def,items:result.data,error:null}:{def,items:[],error:result.error}})));}catch(error){if(renderScope.signal.aborted)return;throw error}
    const errors=all.filter(x=>x.error);
    const rows=all.flatMap(({def,items})=>(Array.isArray(items)?items:[]).map(i=>({
      ...i,tag:def.tag,group:def.label,type:i.type||def.type,enabled:i.enabled!==false,
      dataset:String(i.dataset||''),detected_format:String(i.detected_format||''),
      auto_update:Boolean(i.auto_update),update_interval_hours:+i.update_interval_hours||24
    })));
    rows.sort((a,b)=>Number(b.enabled)-Number(a.enabled));
    setHTML(body, card('在线分流规则',workspaceService.diversion(rows,errors,diversionFormatLabel),{iconName:'rules',actions:'<button class="button" id="div-update-all">更新全部</button><button class="button primary" id="div-add">'+icon('plus')+'添加规则</button>'}));
    workspaceService.bindDiversion(body);
    $$('.div-detail',body).forEach(button=>button.onclick=()=>{const el=button.closest('[data-tag][data-name]'),r=rows.find(r=>r.tag===el.dataset.tag&&String(r.name)===el.dataset.name);if(r)workspaceService.ruleDetails(r,()=>openDiversionModal(r,body),diversionFormatLabel);});
    const findRow=tr=>rows.find(r=>r.tag===tr.dataset.tag&&String(r.name)===tr.dataset.name);
    $$('.div-enable').forEach(x=>x.onchange=async()=>{const tr=x.closest('[data-tag][data-name]'),rule=findRow(tr);if(!rule)return;x.disabled=true;try{const next={...rule,enabled:x.checked};await saveDiversionRule(next,rule);rule.enabled=x.checked;toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}，配置已保存`);await renderDiversion(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.div-update').forEach(x=>x.onclick=async()=>{const rule=findRow(x.closest('[data-tag][data-name]'));if(!rule)return;x.disabled=true;try{await updateDiversionRule(rule,body)}catch(e){toast('更新失败','error',e.message)}finally{x.disabled=false}});
    $$('.div-edit').forEach(x=>x.onclick=()=>{const rule=findRow(x.closest('[data-tag][data-name]'));if(rule)openDiversionModal(rule,body)});
    $$('.div-delete').forEach(x=>x.onclick=async()=>{if(!confirm('确定删除此在线规则？配置文件中的对应项目也会被删除。'))return;const tr=x.closest('[data-tag][data-name]');x.disabled=true;try{await api.request(`/plugins/${tr.dataset.tag}/config/${encodeURIComponent(tr.dataset.name)}`,{method:'DELETE'});toast('规则及对应配置已删除');await renderDiversion(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#div-add').onclick=()=>openDiversionModal(null,body);
    $('#div-update-all').onclick=async()=>{
      const targets=rows.filter(r=>r.enabled&&r.url);
      if(!targets.length){toast('没有可更新的已启用规则','info');return}
      const btn=$('#div-update-all');btn.disabled=true;
      try{
        const byTag=new Map();
        targets.forEach(r=>{if(!byTag.has(r.tag))byTag.set(r.tag,[]);byTag.get(r.tag).push(r)});
        const jobs=[];
        for(const [tag,group] of byTag){
          const def=diversionDefByTag(tag);
          if(def){
            jobs.push(api.request(`/plugins/${tag}/update-all`,{method:'POST'}).then(data=>({kind:'batch',count:group.length,data}),error=>({kind:'failed',count:group.length,error})));
          }else{
            group.forEach(r=>jobs.push(api.request(`/plugins/${r.tag}/update/${encodeURIComponent(r.name)}`,{method:'POST'}).then(data=>({kind:'single',count:1,data}))));
          }
        }
        const result=await Promise.allSettled(jobs);
        let failed=0,datasetNeeded=0,completed=0,details=[];
        result.forEach(x=>{
          if(x.status==='rejected'){
            failed++;
            if(x.reason?.body?.code==='dataset_required')datasetNeeded++;
            details.push(x.reason?.message||'未知错误');
            return;
          }
          const item=x.value;if(item.kind==='failed'){failed+=item.count;details.push(item.error?.message||'更新失败');return;}
          completed+=item.kind==='batch'?Number(item.data?.updated||0):item.count;
          if(item.kind==='batch'){
            failed+=Number(item.data?.failed||0);
            datasetNeeded+=Number(item.data?.dataset_required||0);
            if(Array.isArray(item.data?.errors))details.push(...item.data.errors.map(e=>`${e.name}：${e.error}`));
          }
        });
        const detailText=details.join('；');
        if(datasetNeeded)toast(`更新完成 ${completed} 条；${datasetNeeded} 条需要单独选择数据集`,'error',detailText);
        else if(failed)toast(`更新任务完成，失败 ${failed} 条`,'error',detailText);
        else toast(`已更新 ${completed} 条在线分流规则`);
        await renderDiversion(body);
      }finally{btn.disabled=false}
    };
  }

  function openDiversionModal(rule,body){
    const original=rule?{...rule}:null;
    rule=rule||{name:'',type:'custom_cn',url:'',files:'',enabled:true,dataset:'',auto_update:true,update_interval_hours:24};
    rule.dataset=String(rule.dataset||'');
    modalOpen(original?'编辑在线分流规则':'添加在线分流规则','远程规则由后端按内容自动识别，并统一转换为 SRS；无需手工选择源格式或匹配方式。',`<div class="stack"><div class="grid grid-2"><div class="field"><label>名称</label><input id="div-name" value="${esc(rule.name)}" placeholder="例如：direct_tld_cn"></div><div class="field"><label>规则类型</label><select id="div-type">${diversionDefs.map(d=>`<option value="${d.type}" ${d.type===rule.type?'selected':''}>${esc(d.label)}</option>`).join('')}</select></div></div><div class="field"><label>订阅地址</label><input id="div-url" value="${esc(rule.url||'')}" placeholder="https://example.com/rules"></div><div class="field"><label>源缓存文件（可选）</label><input id="div-files" value="${esc(rule.files||'')}" placeholder="留空时自动生成"><p class="form-note">每个订阅源下载后统一转换为 SRS，存放在 rules/online/规则组/；同组来源合并去重后生成 rules/compiled/规则组.srs，运行时只加载这个文件。</p></div><div class="grid grid-2"><label class="switch"><input id="div-enabled" type="checkbox" ${rule.enabled!==false?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="div-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="div-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div><p class="form-note">支持的来源按内容自动识别；只有多数据集 DAT 才会在更新时要求选择一次数据集。所有成功识别的来源最终统一转换为 SRS 后加载。</p></div>`,async()=>{const payload={name:$('#div-name').value.trim(),type:$('#div-type').value,url:$('#div-url').value.trim(),files:$('#div-files').value.trim(),dataset:rule.dataset,enabled:$('#div-enabled').checked,auto_update:$('#div-auto').checked,update_interval_hours:+$('#div-hours').value||24};let saved;try{saved=await saveDiversionRule(payload,original);}catch(err){if(err.body?.code==='dataset_required'&&Array.isArray(err.body.datasets)){return ()=>openDiversionDatasetPrompt({...payload,tag:payload.type},err.body.datasets,body,original);}throw err;}workspaceService.clearRuleDraft(original);toast('保存与转换完成','success',ruleConversionService.message(saved));await renderDiversion(body);});
    workspaceService.trackRuleDraft(original);
  }
export { ruleProfiles, renderRules, renderRuleTab, renderListRules, renderAdguard, updateAdguard, openAdguardModal, diversionDefs, diversionDefByTag, diversionDefByType, diversionFormatLabel, diversionPayload, saveDiversionRule, openDiversionDatasetPrompt, updateDiversionRule, renderDiversion, openDiversionModal };
