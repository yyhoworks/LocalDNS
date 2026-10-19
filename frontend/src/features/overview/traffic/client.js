import { currentScope } from '../../../core/router/route-lifetime';
import { throwIfAborted } from '../../../core/lifecycle/abort';
import { trafficService } from './model.js';
import { assetHttp } from '../../../core/api/network.ts';
export let trafficClientService;
export function initialize() {

 'use strict';
 const series=[];let range=60,pending=null,lastAttempt=0,error='';
 const overview=()=>!location.hash||location.hash==='#/overview'||location.hash==='#overview';
 function draw(container,minutes=range){
  if(!container?.isConnected)return;range=minutes;container.dataset.trafficMinutes=String(minutes);
  trafficService.render(container,series,minutes,Date.now(),{source:'browser',error});
 }
 function redraw(){for(const container of document.querySelectorAll('.traffic-chart-body'))draw(container,Number(container.dataset.trafficMinutes)||range);}
 async function refresh(force=false){
  if(pending)return pending;
  if(!force&&Date.now()-lastAttempt<4000)return;
  lastAttempt=Date.now();
  const controller=new AbortController(), scope=currentScope(), timeout=setTimeout(()=>controller.abort(),8000);
  const release=scope.add(()=>controller.abort());
  pending=(async()=>{
   try{
    const base=window.LOCALDNS_UI_CONFIG?.apiBase||location.origin;
    const response=await assetHttp.fetch(new URL(String(base).replace(/\/$/,'')+'/metrics',location.origin), {cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('无法读取 DNS 查询采样');
    const text=await response.text(),match=text.match(/^localdns_queries_total(?:\{[^}]*\})?\s+([0-9.eE+-]+)/m);
    if(!match||!Number.isFinite(Number(match[1])))throw new Error('DNS 核心未返回查询计数');
    throwIfAborted(scope.signal); trafficService.record(series,{total:Number(match[1]),start:'browser'});error='';
   }catch{error='当前会话采样暂时不可用，请检查 DNS 连接。';}
   finally{clearTimeout(timeout);release();pending=null;if(!scope.signal.aborted)redraw();}
  })();return pending;
 }
 let mountedScope;
 function mount(container,minutes){
  draw(container,minutes);
  const scope=currentScope();
  if(scope===mountedScope)return;
  mountedScope=scope;
  scope.interval(()=>{if(document.visibilityState==='visible')refresh();},5000);
  scope.listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')refresh(true);});
  scope.listen(window,'focus',()=>refresh(true));
  scope.listen(document,'click',event=>{if(event.target.closest('[data-traffic-retry]'))refresh(true);});
  refresh(true);
 }
 trafficClientService ={render:draw,refresh,mount};

}
