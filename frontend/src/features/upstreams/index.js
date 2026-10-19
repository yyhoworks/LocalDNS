import { workspaceService } from '../../shared/workspace.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { readUpstreams, writeUpstreamGroup } from './api.js';
import { $$, $ } from '../../core/context.js';
import { openUpstreamErrorPopover, closeUpstreamErrorPopover } from './errors.js';
import { toast } from '../../shared/components/toast.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { renderRoute } from '../../core/router/router.js';
import { esc } from '../../shared/format/number.js';
import { groupName } from './groups.js';

  async function renderUpstreams(container, context){
 const renderScope = context.scope, page = container;

    const {config, ecs, groups, rows} = await readUpstreams(renderScope);
    const model = {config, ecs};
    setHTML(page, `<div class="view-title-row"><div><h1>DNS 管理</h1></div><button type="button" class="glass-btn primary" id="up-add">添加上游节点</button></div><div class="col-12">${workspaceService.upstreams(rows,groups)}</div>`);
    $$('.up-toggle',page).forEach(x=>x.onchange=()=>toggleUpstream(x.closest('tr'),x.checked));
    $$('.up-edit',page).forEach(x=>x.onclick=()=>openUpstreamModal(x.closest('tr')));
    $$('.up-delete',page).forEach(x=>x.onclick=()=>deleteUpstream(x.closest('tr')));
    $$('.up-error-detail-trigger',page).forEach(x=>x.onclick=e=>{e.stopPropagation();const row=rows.find(r=>r.g===x.dataset.group&&String(r.i)===x.dataset.index);if(row)openUpstreamErrorPopover(x,row);});
    $$('.workspace-upstream-group .table-wrap',page).forEach(w=>w.addEventListener('scroll',closeUpstreamErrorPopover,{passive:true}));
    $('#up-add').onclick=()=>openUpstreamModal();

  async function saveUpstreamCandidate(group,candidate,ecs){return renderScope.guard(writeUpstreamGroup(group,candidate,ecs));}

  async function saveUpstreamGroup(group){return saveUpstreamCandidate(group,model.config[group]||[]);}

  async function toggleUpstream(row,enabled){const g=row.dataset.group,i=+row.dataset.index,old=model.config[g][i].enabled;model.config[g][i].enabled=enabled;try{await saveUpstreamGroup(g);toast('上游状态已保存');renderRoute(true)}catch(e){if(renderScope.signal.aborted)return;model.config[g][i].enabled=old;toast('保存失败','error',e.message);renderRoute(true)}}

  async function deleteUpstream(row){if(!confirm('确定删除这个上游 DNS 吗？'))return;const g=row.dataset.group,i=+row.dataset.index,old=model.config[g].slice();model.config[g].splice(i,1);try{await saveUpstreamGroup(g);toast('上游已删除');renderRoute(true)}catch(e){if(renderScope.signal.aborted)return;model.config[g]=old;toast('删除失败','error',e.message)}}

  function openUpstreamModal(row){
    const edit=!!row;
    const group=edit?row.dataset.group:Object.keys(model.config||{})[0]||'domestic';
    const idx=edit?+row.dataset.index:-1;
    const u=edit?model.config[group][idx]:{tag:'',protocol:'udp',addr:'',enabled:true};
    const groups=Object.keys(model.config||{});
    // SOCKS5 only for foreign / foreign_ecs; ECS only for foreign_ecs. The timeout takes the place of the fields a group does not have.
    const hasSocks=g=>g==='foreign'||g==='foreign_ecs';
    const fieldsHtml=(g,v)=>{
      const f=(id,label,value,extra='')=>`<div class="field"><label>${label}</label><input id="${id}" ${extra} value="${esc(value)}"></div>`;
      return `<div class="field"><label>名称</label><input id="u-tag" value="${esc(v.tag)}" required></div>
      <div class="field"><label>协议</label><select id="u-protocol">${['udp','tcp','tls','https'].map(x=>`<option ${x===v.protocol?'selected':''}>${x}</option>`).join('')}</select></div>
      ${f('u-addr','服务器地址',v.addr,'required placeholder="223.5.5.5:53 或 https://.../dns-query"')}
      ${f('u-dial','拨号地址',v.dial,'placeholder="可选"')}
      ${hasSocks(g)?f('u-socks','SOCKS5',v.socks,'placeholder="可选"'):''}
      ${g==='foreign_ecs'?f('u-ecs','ECS',v.ecs,'placeholder="一个 IPv4 或 IPv6，可留空；IPv4 默认 /24，IPv6 默认 /56"'):''}
      ${f('u-timeout','查询超时（ms）',v.timeout,'type="number" min="0"')}`;
    };
    const readForm=()=>({tag:$('#u-tag').value,protocol:$('#u-protocol').value,addr:$('#u-addr').value,dial:$('#u-dial').value,socks:$('#u-socks')?$('#u-socks').value:'',ecs:$('#u-ecs')?$('#u-ecs').value:(model.ecs||''),timeout:$('#u-timeout').value});
    const initial={tag:u.tag||'',protocol:u.protocol||'udp',addr:u.addr||u.server_addr||'',dial:u.dial_addr||'',socks:u.socks5||'',ecs:model.ecs||'',timeout:u.upstream_query_timeout||0};
    modalOpen(edit?'编辑上游 DNS':'添加上游 DNS','保存后立即生效',`<div class="grid grid-2">
      <div class="field"><label>所属组</label><select id="u-group" ${edit?'disabled':''}>${groups.map(g=>`<option value="${esc(g)}" ${g===group?'selected':''}>${esc(groupName(g))}</option>`).join('')}</select></div>
      <span id="u-fields" style="display:contents">${fieldsHtml(group,initial)}</span>
    </div>`,async()=>{
      const g=$('#u-group').value;
      const v=readForm();
      const item=Object.assign({},u,{tag:v.tag.trim(),protocol:v.protocol,enabled:u.enabled!==false});
      if(!item.tag)throw new Error('名称不能为空');
      item.addr=v.addr.trim();
      item.dial_addr=v.dial.trim();
      if(hasSocks(g))item.socks5=v.socks.trim();else delete item.socks5;
      const timeout=+v.timeout||0;
      if(timeout>0)item.upstream_query_timeout=timeout;else delete item.upstream_query_timeout;
      for(const k of ['bootstrap','enable_http3','enable_pipeline','account_id','access_key_id','access_key_secret','server_addr','ecs_client_ip','ecs_client_mask','ecs_mask'])delete item[k];
      const candidate=(model.config[g]||[]).slice();
      if(edit)candidate[idx]=item;
      else candidate.push(item);
      const ecs=g==='foreign_ecs'?v.ecs.trim():undefined;
      await saveUpstreamCandidate(g,candidate,ecs);
      model.config[g]=candidate;
      if(ecs!==undefined)model.ecs=ecs;
      toast('上游 DNS 已保存');
      renderRoute(true);
    });
    // choosing another group (when adding) re-lays out the fields and keeps what was typed
    $('#u-group').onchange=()=>{const g=$('#u-group').value;setHTML($('#u-fields'), fieldsHtml(g,readForm()));};
  }
  }
export { renderUpstreams };
