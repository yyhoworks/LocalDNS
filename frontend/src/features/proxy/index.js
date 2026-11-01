import { CleanupScope } from '../../core/lifecycle/cleanup-scope';
import { setHTML } from '../../core/security/safe-dom.ts';
import { mount as mountEditor, requestLeave as editorLeave } from '../proxy-config/index.js';
import { mountTraffic } from './traffic.js';
import { takeProxyPane } from './selection.js';

let activePane=null;
export const requestLeave = () => activePane==='config'?editorLeave():true;

export async function mount(parent, context) {
  setHTML(parent, `<section class="pp-root" aria-labelledby="proxy-title"><header class="pp-heading"><div><h1 id="proxy-title">代理</h1><p>查看代理用量，管理核心配置。</p></div><span class="pp-core-status" id="proxy-stat-status" role="status">正在读取统计…</span></header><div class="pp-navigation" role="tablist" aria-label="代理工作区"><button type="button" class="pp-tab" id="proxy-pane-traffic" role="tab" aria-selected="true" aria-controls="proxy-pane-content" data-proxy-pane="traffic">流量统计</button><button type="button" class="pp-tab" id="proxy-pane-config" role="tab" aria-selected="false" aria-controls="proxy-pane-content" tabindex="-1" data-proxy-pane="config">配置管理</button><span class="pp-navigation-note" id="proxy-pane-note">仅统计走代理的上传与下载</span></div><section id="proxy-pane-content" role="tabpanel" aria-labelledby="proxy-pane-traffic"></section></section>`);
  const root=parent.querySelector('.pp-root'),content=root.querySelector('#proxy-pane-content');
  let pane=null,child=null,sequence=0;
  context.scope.add(()=>{sequence++;child?.dispose();activePane=null;});
  async function showPane(next) {
    if(next===pane)return;
    const version=++sequence;
    if(pane==='config'&&!await editorLeave())return;
    if(context.signal.aborted||sequence!==version)return;
    child?.dispose();content.replaceChildren();pane=next;activePane=next;
    child=new CleanupScope();
    root.querySelectorAll('[data-proxy-pane]').forEach(button=>{const selected=button.dataset.proxyPane===next;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    content.classList.toggle('proxy-config-pane',next==='config');
    content.setAttribute('aria-labelledby','proxy-pane-'+next);
    root.querySelector('#proxy-pane-note').textContent=next==='config'?'读取配置 → 检查改动 → 保存并应用':'仅统计走代理的上传与下载';
    const subcontext={...context,signal:child.signal,scope:child};
    if(next==='config')await mountEditor(content,subcontext);
    else await mountTraffic(content,subcontext,status=>{root.querySelector('#proxy-stat-status').textContent=status;});
  }
  root.querySelectorAll('[data-proxy-pane]').forEach(button=>button.addEventListener('click',()=>{showPane(button.dataset.proxyPane);}));
  root.querySelector('.pp-navigation').addEventListener('keydown',event=>{
    if(!event.target.matches('[data-proxy-pane]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const next=event.key==='Home'?'traffic':event.key==='End'?'config':pane==='traffic'?'config':'traffic';
    showPane(next).then(()=>{if(pane===next)root.querySelector('#proxy-pane-'+next).focus();});
  });
  await showPane(takeProxyPane());
}
