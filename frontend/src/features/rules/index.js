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
import { modalOpen, confirmDialog } from '../../shared/components/dialog.js';
import { downloadText } from '../../shared/downloads.js';
import { safeResult } from '../../shared/async.js';

  const ruleGroups=[
    ['核心分流',[['whitelist','白名单'],['greylist','灰名单'],['blocklist','黑名单']]],
    ['解析控制',[['force_realip','强制 RealIP'],['ddns_domains','DDNS 域名'],['direct_ip','直连 IP'],['rewrite','重定向']]],
    ['PCDN 抑制',[['pcdn_domains','PCDN 域名'],['pcdn_regex_v4','PCDN IPv4 规则'],['pcdn_regex_v6','PCDN IPv6 规则']]]
  ];
  const ruleProfiles=ruleGroups.flatMap(([,items])=>items);

  let ruleViews, activeTab='lists', diversionUpdating=false;
  const updateRule=path=>api.request(path,{method:'POST',timeout:300000});
  const updateUncertain=error=>['timeout','network','invalid-json'].includes(error?.code);
  function updateError(error,label='更新失败'){
    if(updateUncertain(error))toast('更新结果待确认','info','未能收到完整更新结果，服务器可能仍在处理。请稍后刷新，查看更新时间和来源错误；请勿重复提交。');
    else toast(label,'error',error.message);
  }
  function syncDiversionUpdateState(body){
    $$('.div-update,#div-update-all,[data-div-update-group]',body).forEach(button=>{button.disabled=diversionUpdating});
    const button=$('#div-update-all',body);if(button)button.textContent=diversionUpdating?'更新中…':'更新全部';
  }

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
    const activeGroup=ruleGroups.find(([,items])=>items.some(([t])=>t===tag))||ruleGroups[0];
    const menuOptions=esc(JSON.stringify(ruleProfiles.map(([t,n])=>({tag:t,label:n,group:(ruleGroups.find(([,items])=>items.some(([x])=>x===t))||[''])[0]}))));
    /* 分组分段控件放在卡片头（方案 D）：.rule-menu 里只留名单胶囊一行，
       一级分组按钮带 .active 但不在 .rule-menu 内，当前名单的选择器不会命中它 */
    const cardHead=`<div class="card-header rule-card-header"><div class="card-title"><span class="icon">${icon('rules')}</span><div><h2>名单管理</h2><p>本地名单 · 启停与编辑先保留为草稿</p></div></div><div class="card-actions"><div class="rule-menu-level1" role="group" aria-label="规则分组">${ruleGroups.map(([gLabel])=>`<button type="button" class="rule-group-btn${gLabel===activeGroup[0]?' active':''}" data-rule-group="${esc(gLabel)}">${esc(gLabel)}</button>`).join('')}</div></div></div>`;
    const menu=`<div class="rule-menu" data-rule-options="${menuOptions}"><div class="rule-menu-items" role="group" aria-label="${esc(activeGroup[0])}名单">${activeGroup[1].map(([t,n])=>`<button type="button" data-rule-tag="${t}" class="${t===tag?'active':''}"><span>${n}</span><span class="rule-count"></span></button>`).join('')}</div></div>`;
    const bindMenu=()=>{
      $$('[data-rule-tag]').forEach(x=>x.onclick=()=>{const go=()=>{state.ruleTag=x.dataset.ruleTag;renderListRules(body)};if(rulesWorkbenchService?.canLeave(go)!==false)go();});
      $$('[data-rule-group]').forEach(x=>x.onclick=()=>{const entry=ruleGroups.find(([g])=>g===x.dataset.ruleGroup);if(!entry||!entry[1].length)return;const go=()=>{state.ruleTag=entry[1][0][0];renderListRules(body)};if(rulesWorkbenchService?.canLeave(go)!==false)go();});
    };
    if(loadError){
      setHTML(body, `<section class="card">${cardHead}<div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>读取失败时禁止保存，现有规则不会被覆盖。</p></div><button class="button" id="rule-retry">${icon('refresh')}重试</button></div><div class="error-panel"><strong>规则列表加载失败</strong><p>${esc(loadError.message)}</p></div></div></div></section>`);
      bindMenu();$('#rule-retry').onclick=()=>renderListRules(body);requestAnimationFrame(fitRuleLayoutHeight);return;
    }
    const trimmed=String(text).trim();
    setHTML(body, `<section class="card">${cardHead}<div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>一行一条；完整读取后才允许保存</p></div><div class="section-header-actions"><button class="button small" id="rule-download">${icon('download')}下载列表</button><button class="button primary" id="rule-save">${icon('save')}保存</button></div></div><textarea id="rule-text" class="rule-textarea" spellcheck="false">${esc(trimmed)}</textarea><div class="rule-editor-footer"><span id="rule-lines">共 ${trimmed?trimmed.split('\n').filter(line=>line.trim()).length:0} 行</span></div></div></div></section>`);
    bindMenu();
    $('#rule-text').oninput=()=>$('#rule-lines').textContent=`共 ${$('#rule-text').value.split('\n').filter(line=>line.trim()).length} 行`;
    $('#rule-save').onclick=async()=>{
      const button=$('#rule-save'),text=$('#rule-text'),value=text.value,baseline=text.dataset.original;
      if(!value.trim()&&!await confirmDialog({message:'确定要清空这份名单吗？', danger:true}))return;
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
    setHTML(body, card('广告拦截规则',`${sourceErrors.length?`<div class="error-panel">${sourceErrors.map(r=>`${esc(r.name)}：${esc(r.last_error)}`).join('；')}</div>`:''}<div class="table-wrap adguard-table-wrap mobile-card-table"><table class="adguard-rules-table adguard-card-table"><colgroup><col class="col-enabled"><col class="col-name"><col class="col-url"><col class="col-count"><col class="col-auto"><col class="col-updated"><col class="col-actions"></colgroup><thead><tr><th>启用</th><th>名称</th><th>订阅地址</th><th>规则数</th><th>自动更新</th><th>上次更新</th><th>操作</th></tr></thead><tbody>${rules.length?rules.map(r=>`<tr data-id="${esc(r.id)}"><td class="ad-enabled-cell mobile-toggle-cell"><label class="switch"><input class="ad-enable" type="checkbox" ${r.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td class="ad-name-cell mobile-name-cell" title="${esc(r.name)}"><strong>${esc(r.name)}</strong></td><td class="ad-url-cell mobile-url-cell" data-label="订阅地址" title="${esc(r.url)}"><span class="table-ellipsis mobile-ellipsis">${esc(r.url)}</span></td><td class="ad-count-cell mobile-count-cell" data-label="规则数">${num(r.rule_count)}</td><td class="ad-auto-cell mobile-auto-cell" data-label="自动更新">${r.auto_update?'是':'否'}</td><td class="ad-updated-cell mobile-updated-cell" data-label="上次更新">${fmtDate(r.last_updated)}</td><td class="ad-actions-cell mobile-actions-cell"><div class="table-row-actions card-actions"><button class="button small ad-update">更新</button><button class="button small ad-edit">编辑</button><button class="button small danger ad-delete">删除</button></div></td></tr>`).join(''):`<tr><td colspan="7" class="table-empty">暂无订阅，点右上「添加订阅」从 URL 添加一条</td></tr>`}</tbody></table></div>`,{iconName:'rules',actions:'<button class="button" id="ad-update-all">更新全部</button><button class="button primary" id="ad-add">'+icon('plus')+'添加订阅</button>'}));
    const findRule=tr=>rules.find(r=>String(r.id)===tr.dataset.id);
    $$('.ad-enable').forEach(x=>x.onchange=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{await updateAdguard(rule,{enabled:x.checked});toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}`);await renderAdguard(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.ad-update').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{const r=await updateRule(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}/update`);toast(`广告规则“${rule.name}”更新完成`,'success',`规则数：${num(r?.rule_count||0)}`);await renderAdguard(body)}catch(e){updateError(e,`“${rule.name}”更新失败`)}finally{x.disabled=false}});
    $$('.ad-edit').forEach(x=>x.onclick=()=>openAdguardModal(findRule(x.closest('tr')),body));
    $$('.ad-delete').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule||!await confirmDialog({message:`确定删除广告规则“${rule.name}”？`, danger:true}))return;x.disabled=true;try{await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}`,{method:'DELETE'});toast('广告规则已删除');await renderAdguard(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#ad-update-all').onclick=async()=>{const btn=$('#ad-update-all');btn.disabled=true;btn.textContent='更新中…';try{const r=await updateRule('/plugins/adguard/update');const errors=Array.isArray(r?.errors)?r.errors:[];if(errors.length){toast(`广告规则更新完成，失败 ${errors.length} 条`,'error',errors.map(x=>`${x.name}：${x.error}`).join('；'))}else toast(`广告规则更新完成：${Number(r?.updated_sources||0)} 条`);await renderAdguard(body)}catch(e){updateError(e,'广告规则更新失败')}finally{btn.disabled=false;btn.textContent='更新全部'}};
    $('#ad-add').onclick=()=>openAdguardModal(null,body);
  }

  async function updateAdguard(rule,patch){
    const next=Object.assign({},rule,patch);
    delete next.last_error;delete next.line_report;
    await api.json(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}`,'PUT',next);
  }

  function openAdguardModal(rule,body){
    rule=rule||{name:'',url:'',files:'',enabled:true,auto_update:true,update_interval_hours:24};
    modalOpen(rule.id?'编辑广告规则':'添加广告规则','支持 AdGuard DNS 过滤规则；订阅下载与合并由内核完成。',`<div class="stack"><div class="field"><label>名称</label><input id="ad-name" value="${esc(rule.name)}"></div><div class="field"><label>订阅地址</label><input id="ad-url" value="${esc(rule.url)}" placeholder="https://example.com/adblock.txt"></div><div class="field"><label>源缓存文件（可选）</label><input id="ad-files" value="${esc(rule.files||'')}" placeholder="留空时从 URL 自动生成"><p class="form-note">统一保存到 rules/online/adguard/，后缀固定为 .txt；留空时从 URL 路径提取文件名，query/fragment 不会写入文件名。</p></div><div class="grid grid-2"><label class="switch"><input id="ad-enabled" type="checkbox" ${rule.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="ad-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="ad-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div></div>`,async()=>{
      const hours=normalizeUpdateHours($('#ad-hours').value);if(hours.note)toast(hours.note,'info');
      const payload={name:$('#ad-name').value.trim(),url:$('#ad-url').value.trim(),files:$('#ad-files').value.trim(),enabled:$('#ad-enabled').checked,auto_update:$('#ad-auto').checked,update_interval_hours:hours.hours};
      if(!payload.name||!payload.url)throw new Error('名称和地址不能为空');
      if(rule.rule_count!==undefined)payload.rule_count=rule.rule_count;
      if(rule.last_updated)payload.last_updated=rule.last_updated;
      if(rule.id)await updateAdguard(rule,payload);else await api.json('/plugins/adguard/rules','POST',payload);
      toast(`广告规则已${rule.id?'更新':'添加'}`);
      await renderAdguard(body);
    });
  }

  const diversionDefs=[
    {tag:'custom_cn',type:'custom_cn',label:'国内规则',domainRules:true},
    {tag:'custom_non_cn',type:'custom_non_cn',label:'海外规则',domainRules:true},
    {tag:'geoip_cn',type:'geoip_cn',label:'GeoIP CN',domainRules:false},
    {tag:'geoip_non_cn',type:'geoip_non_cn',label:'GeoIP 非 CN',domainRules:false},
    {tag:'geosite_cn',type:'geosite_cn',label:'Geosite CN',domainRules:true},
    {tag:'geosite_non_cn',type:'geosite_non_cn',label:'Geosite 非 CN',domainRules:true}
  ];

  const diversionDefByTag=tag=>diversionDefs.find(x=>x.tag===tag);

  const diversionDefByType=type=>diversionDefs.find(x=>x.type===type);

  const diversionFormatLabel=r=>ruleConversionService.label(r);

  // 更新间隔：非法（空 / 非数字）回落 24，负数与 0 钳制为最小 1；note 为空表示无需提示。
  function normalizeUpdateHours(raw){
    const n=Number(raw);
    if(raw===''||raw===null||raw===undefined||!Number.isFinite(n))return {hours:24,note:'更新间隔无效，已恢复为 24 小时'};
    if(n<1)return {hours:1,note:'更新间隔不能小于 1 小时，已调整为 1 小时'};
    return {hours:n,note:null};
  }

  function diversionPayload(rule){
    const target=diversionDefByType(rule.type);
    const payload={
      name:String(rule.name||'').trim(), type:String(rule.type||'').trim(),
      files:String(rule.files||'').trim(), url:String(rule.url||'').trim(),
      dataset:String(rule.dataset||'').trim(),
      auto_update:Boolean(rule.auto_update), update_interval_hours:normalizeUpdateHours(rule.update_interval_hours).hours,
      enabled:rule.enabled!==false
    };
    if(target&&target.domainRules!==false)payload.enable_regexp=true;
    if(!payload.dataset)delete payload.dataset;
    if(rule.rule_count!==undefined&&rule.rule_count!==null)payload.rule_count=+rule.rule_count||0;
    if(rule.last_updated)payload.last_updated=rule.last_updated;
    if(rule.detected_format)payload.detected_format=rule.detected_format;
    return payload;
  }

  // PUT 新配置成功、但删除改名/换组前的旧配置失败时，新旧两份会并存。
  // 这里记录待清理的旧配置，renderDiversion 会渲染带重试按钮的提示条，
  // 而不是把整个保存误报为「操作失败」。
  let staleOriginal=null;
  async function deleteOriginalConfig(ref){
    const path=`/plugins/${ref.tag}/config/${encodeURIComponent(ref.name)}`;
    return ruleConversionService.deleteOriginalWithRetry(()=>api.request(path,{method:'DELETE'}));
  }

  async function saveDiversionRule(rule,original=null,options={}){
    const target=diversionDefByType(rule.type);if(!target)throw new Error('请选择有效的规则类型');
    const payload=diversionPayload(ruleConversionService.withMetadata(rule,original));if(!payload.name)throw new Error('名称不能为空');if(!payload.url)throw new Error('订阅地址不能为空');
    // 改名前重名拦截：比对目标组内已有名称（排除自身原名），只做前端拦截，不动后端行为。
    try{
      const existing=await api.request(`/plugins/${target.tag}/config`);
      const clash=Array.isArray(existing)&&existing.some(item=>String(item?.name||'')===payload.name&&!(original&&original.tag===target.tag&&String(original.name||'')===payload.name));
      if(clash)throw new Error('该名称已存在');
    }catch(e){
      if(e.message==='该名称已存在')throw e;
      // 组列表读不到时不拦截保存（PUT 本身仍是事实来源），避免一次读失败拖垮正常保存。
    }
    const response=await api.json(`/plugins/${target.tag}/config/${encodeURIComponent(payload.name)}`,'PUT',payload);
    const saved=await ruleConversionService.finishSave(response,()=>updateRule(`/plugins/${target.tag}/update/${encodeURIComponent(payload.name)}`),options);
    if(original&&(original.tag!==target.tag||original.name!==payload.name)){
      if(await deleteOriginalConfig(original)){
        if(staleOriginal&&staleOriginal.tag===original.tag&&staleOriginal.name===original.name)staleOriginal=null;
      }else{
        staleOriginal={tag:original.tag,name:original.name};
        toast('新配置已保存，旧配置未能删除','error',`旧配置「${original.name}」仍保留在列表中，可在分流规则页顶部重试删除。`);
      }
    }
    return saved;
  }

  function openDiversionDatasetPrompt(rule,datasets,body,original=rule){
    const options=(Array.isArray(datasets)?datasets:[]).map(x=>String(x||'').trim()).filter(Boolean);
    const typed=!options.length;
    const field=typed?`<input id="div-dataset-choice" value="${esc(rule.dataset||'')}" placeholder="例如 AS13335，多个用逗号分隔">`:`<select id="div-dataset-choice">${options.map(x=>`<option value="${esc(x)}" ${x===rule.dataset?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
    modalOpen(typed?'请填写 AS 号':'请选择数据集 / Tag','选择后保存到此订阅，后续自动更新直接复用。',`<div class="stack"><div class="field"><label>${typed?'AS 号':'数据集 / Tag'}</label>${field}</div><p class="form-note">${typed?'ASN 数据库需要填写要提取的 AS 号。':'多数据集来源需要选择对应的国家或分类。'}</p></div>`,async()=>{
      const dataset=$('#div-dataset-choice').value.trim();
      if(!dataset)throw new Error(typed?'请填写 AS 号':'请选择数据集');
      const saved=await saveDiversionRule({...rule,dataset},original);
      workspaceService.clearRuleDraft(original);
      if(saved&&saved.savedButUnrecognized)toast('配置已保存，但来源尚未识别','warning','请检查订阅地址后重试更新。');
      else toast('识别与转换完成','success',ruleConversionService.message(saved));
      await renderDiversion(body);
    });
  }

  async function updateDiversionRule(rule,body){
    try{
      const result=await updateRule(`/plugins/${rule.tag}/update/${encodeURIComponent(rule.name)}`);
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
    setHTML(body, card('在线分流规则',workspaceService.diversion(rows,errors,diversionFormatLabel,diversionDefs.map(({tag,label,domainRules})=>({tag,label,domainRules}))),{iconName:'rules',actions:'<button class="button" id="div-update-all">更新全部</button><button class="button primary" id="div-add">'+icon('plus')+'添加规则</button>'}));
    workspaceService.bindDiversion(body);
    $$('[data-div-update-group]',body).forEach(button=>button.onclick=async()=>{
      if(diversionUpdating)return;
      const tag=button.dataset.divUpdateGroup,label=diversionDefByTag(tag)?.label||tag;
      if(!rows.some(r=>r.tag===tag&&r.enabled&&r.url)){toast(`${label}没有可更新的已启用规则`,'info');return}
      diversionUpdating=true;syncDiversionUpdateState(body);
      try{
        const result=await updateRule(`/plugins/${tag}/update-all`);
        const failed=Number(result?.failed||0);
        if(failed)toast(`${label}：${Number(result?.updated||0)} 个来源已更新，${failed} 个失败`,'error',(result.errors||[]).map(x=>`${x.name}：${x.error}`).join('；'));
        else toast(`${label}：${Number(result?.updated||0)} 个来源已更新`);
        await renderDiversion(body);
      }catch(e){updateError(e,`${label} 更新失败`)}
      finally{diversionUpdating=false;syncDiversionUpdateState(body)}
    });
    if(staleOriginal){
      const notice=document.createElement('div');
      notice.className='error-panel';
      setHTML(notice,`<div><strong>新配置已保存，旧配置未能删除。</strong><p>旧配置「${esc(staleOriginal.name)}」仍保留，新旧两份会同时生效。</p></div><button class="button" id="div-stale-retry">重试删除旧配置</button>`);
      body.prepend(notice);
      notice.querySelector('#div-stale-retry').onclick=async event=>{const button=event.currentTarget;button.disabled=true;if(await deleteOriginalConfig(staleOriginal)){staleOriginal=null;toast('旧配置已删除');await renderDiversion(body)}else{toast('旧配置仍删除失败','error','请稍后重试，或检查配置服务状态。');button.disabled=false}};
    }
    syncDiversionUpdateState(body);
    $$('.div-detail',body).forEach(button=>button.onclick=()=>{const el=button.closest('[data-tag][data-name]'),r=rows.find(r=>r.tag===el.dataset.tag&&String(r.name)===el.dataset.name);if(r)workspaceService.ruleDetails(r,()=>openDiversionModal(r,body),diversionFormatLabel);});
    const findRow=tr=>rows.find(r=>r.tag===tr.dataset.tag&&String(r.name)===tr.dataset.name);
    $$('.div-enable').forEach(x=>x.onchange=async()=>{const tr=x.closest('[data-tag][data-name]'),rule=findRow(tr);if(!rule)return;x.disabled=true;try{const next={...rule,enabled:x.checked};await saveDiversionRule(next,rule,{configOnly:true});rule.enabled=x.checked;toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}，配置已保存`);await renderDiversion(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.div-update').forEach(x=>x.onclick=async()=>{if(diversionUpdating)return;const rule=findRow(x.closest('[data-tag][data-name]'));if(!rule)return;x.disabled=true;try{await updateDiversionRule(rule,body)}catch(e){updateError(e)}finally{x.disabled=false}});
    $$('.div-edit').forEach(x=>x.onclick=()=>{const rule=findRow(x.closest('[data-tag][data-name]'));if(rule)openDiversionModal(rule,body)});
    $$('.div-delete').forEach(x=>x.onclick=async()=>{if(!await confirmDialog({message:'确定删除此在线规则？配置文件中的对应项目也会被删除。', danger:true}))return;const tr=x.closest('[data-tag][data-name]');x.disabled=true;try{await api.request(`/plugins/${tr.dataset.tag}/config/${encodeURIComponent(tr.dataset.name)}`,{method:'DELETE'});toast('规则及对应配置已删除');await renderDiversion(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#div-add').onclick=()=>openDiversionModal(null,body);
    $('#div-update-all').onclick=async()=>{
      if(diversionUpdating)return;
      const targets=rows.filter(r=>r.enabled&&r.url);
      if(!targets.length){toast('没有可更新的已启用规则','info');return}
      diversionUpdating=true;syncDiversionUpdateState(body);
      try{
        const byTag=new Map();
        targets.forEach(r=>{if(!byTag.has(r.tag))byTag.set(r.tag,[]);byTag.get(r.tag).push(r)});
        const jobs=[];
        for(const [tag,group] of byTag){
          const def=diversionDefByTag(tag);
          if(def){
            jobs.push(updateRule(`/plugins/${tag}/update-all`).then(data=>({kind:'batch',count:group.length,data}),error=>({kind:'failed',count:group.length,error,label:def.label})));
          }else{
            group.forEach(r=>jobs.push(updateRule(`/plugins/${r.tag}/update/${encodeURIComponent(r.name)}`).then(data=>({kind:'single',count:1,data}),error=>({kind:'failed',count:1,error,label:r.name}))));
          }
        }
        const result=await Promise.allSettled(jobs);
        let failed=0,uncertain=0,datasetNeeded=0,completed=0,details=[];
        result.forEach(x=>{
          if(x.status==='rejected'){
            failed++;
            if(x.reason?.body?.code==='dataset_required')datasetNeeded++;
            details.push(x.reason?.message||'未知错误');
            return;
          }
          const item=x.value;if(item.kind==='failed'){
            if(updateUncertain(item.error)){uncertain+=item.count;details.push(`${item.label}：未收到更新结果，服务器可能仍在处理，请稍后刷新查看更新时间`)}
            else{failed+=item.count;details.push(`${item.label}：${item.error?.message||'更新失败'}`)}
            return;
          }
          completed+=item.kind==='batch'?Number(item.data?.updated||0):item.count;
          if(item.kind==='batch'){
            // 部分结果里的 transport 失败（传输失败、结果未知）不再计为失败：
            // 计入 uncertain，走已有的“结果待确认”toast 分支；data.failed 若已含
            // 这些项则相应扣减，避免同一条规则在失败与待确认中重复计数。
            const batchErrors=Array.isArray(item.data?.errors)?item.data.errors:[];
            const transportErrors=batchErrors.filter(e=>e?.transport===true);
            failed+=Math.max(0,Number(item.data?.failed||0)-transportErrors.length);
            uncertain+=transportErrors.length;
            datasetNeeded+=Number(item.data?.dataset_required||0);
            details.push(...batchErrors.map(e=>e?.transport===true?`${e.name}：未收到更新结果，服务器可能仍在处理，请稍后刷新查看更新时间`:`${e.name}：${e.error}`));
          }
        });
        const detailText=details.join('；');
        // dataset_required 是 failed 的子集（需要选数据集的规则同时计入失败数），
        // 展示时相减，避免同一条规则在「失败」与「需要数据集」中被重复计数。
        const failedOther=Math.max(0,failed-datasetNeeded);
        if(uncertain)toast(`已更新 ${completed} 条；${uncertain} 条结果待确认${failedOther?`；失败 ${failedOther} 条`:''}${datasetNeeded?`；${datasetNeeded} 条需要选择数据集`:''}`,failedOther||datasetNeeded?'error':'info',detailText+'；请勿重复提交更新任务。');
        else if(datasetNeeded&&failedOther)toast(`更新完成 ${completed} 条；失败 ${failedOther} 条；${datasetNeeded} 条需要单独选择数据集`,'error',detailText);
        else if(datasetNeeded)toast(`更新完成 ${completed} 条；${datasetNeeded} 条需要单独选择数据集`,'error',detailText);
        else if(failed)toast(`更新任务完成，失败 ${failed} 条`,'error',detailText);
        else toast(`已更新 ${completed} 条在线分流规则`);
        await renderDiversion(body);
      }finally{diversionUpdating=false;syncDiversionUpdateState(body)}
    };
  }

  function openDiversionModal(rule,body){
    const original=rule?{...rule}:null;
    rule=rule||{name:'',type:'custom_cn',url:'',files:'',enabled:true,dataset:'',auto_update:true,update_interval_hours:24};
    rule.dataset=String(rule.dataset||'');
    modalOpen(original?'编辑在线分流规则':'添加在线分流规则','远程规则由后端按内容自动识别，并统一转换为 SRS；无需手工选择源格式或匹配方式。',`<div class="stack"><div class="grid grid-2"><div class="field"><label>名称</label><input id="div-name" value="${esc(rule.name)}" placeholder="例如：direct_tld_cn"></div><div class="field"><label>规则类型</label><select id="div-type">${diversionDefs.map(d=>`<option value="${d.type}" ${d.type===rule.type?'selected':''}>${esc(d.label)}</option>`).join('')}</select></div></div><div class="field"><label>订阅地址</label><input id="div-url" value="${esc(rule.url||'')}" placeholder="https://example.com/rules"></div><div class="field"><label>源缓存文件（可选）</label><input id="div-files" value="${esc(rule.files||'')}" placeholder="留空时自动生成"><p class="form-note">每个订阅源下载后统一转换为 SRS，存放在 rules/online/规则组/；同组来源合并去重后生成 rules/compiled/规则组.srs，运行时只加载这个文件。</p></div><div class="grid grid-2"><label class="switch"><input id="div-enabled" type="checkbox" ${rule.enabled!==false?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="div-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="div-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div><p class="form-note">支持的来源按内容自动识别；只有多数据集 DAT 才会在更新时要求选择一次数据集。所有成功识别的来源最终统一转换为 SRS 后加载。</p></div>`,async()=>{const hours=normalizeUpdateHours($('#div-hours').value);if(hours.note)toast(hours.note,'info');const payload={name:$('#div-name').value.trim(),type:$('#div-type').value,url:$('#div-url').value.trim(),files:$('#div-files').value.trim(),dataset:rule.dataset,enabled:$('#div-enabled').checked,auto_update:$('#div-auto').checked,update_interval_hours:hours.hours};let saved;try{saved=await saveDiversionRule(payload,original);}catch(err){if(err.body?.code==='dataset_required'&&Array.isArray(err.body.datasets)){return ()=>openDiversionDatasetPrompt({...payload,tag:payload.type},err.body.datasets,body,original);}throw err;}workspaceService.clearRuleDraft(original);if(saved&&saved.savedButUnrecognized)toast('配置已保存，但来源尚未识别','warning','请检查订阅地址后重试更新。');else toast('保存与转换完成','success',ruleConversionService.message(saved));await renderDiversion(body);});
    workspaceService.trackRuleDraft(original);
  }
export { ruleProfiles, renderRules, renderRuleTab, renderListRules, renderAdguard, updateAdguard, openAdguardModal, diversionDefs, diversionDefByTag, diversionDefByType, diversionFormatLabel, diversionPayload, saveDiversionRule, openDiversionDatasetPrompt, updateDiversionRule, renderDiversion, openDiversionModal };
