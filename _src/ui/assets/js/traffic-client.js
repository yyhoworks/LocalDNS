/* Current-session DNS sampling; no companion process or historical service. */
(() => {
 'use strict';
 const series=[];let range=60,pending=null,lastAttempt=0,error='';
 const overview=()=>!location.hash||location.hash==='#/overview'||location.hash==='#overview';
 function draw(container,minutes=range){
  if(!container?.isConnected)return;range=minutes;container.dataset.trafficMinutes=String(minutes);
  window.LocalDNSTraffic.render(container,series,minutes,Date.now(),{source:'browser',error});
 }
 function redraw(){for(const container of document.querySelectorAll('.traffic-chart-body'))draw(container,Number(container.dataset.trafficMinutes)||range);}
 async function refresh(force=false){
  if(pending)return pending;
  if(!force&&Date.now()-lastAttempt<4000)return;
  lastAttempt=Date.now();
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  pending=(async()=>{
   try{
    const base=window.LOCALDNS_UI_CONFIG?.apiBase||location.origin;
    const response=await fetch(new URL(String(base).replace(/\/$/,'')+'/metrics',location.origin),{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('无法读取 DNS 查询采样');
    const text=await response.text(),match=text.match(/^localdns_queries_total(?:\{[^}]*\})?\s+([0-9.eE+-]+)/m);
    if(!match||!Number.isFinite(Number(match[1])))throw new Error('DNS 核心未返回查询计数');
    window.LocalDNSTraffic.record(series,{total:Number(match[1]),start:'browser'});error='';
   }catch{error='当前会话采样暂时不可用，请检查 DNS 连接。';}
   finally{clearTimeout(timeout);pending=null;redraw();}
  })();return pending;
 }
 function setup(){
  setInterval(()=>{if(overview()&&document.visibilityState==='visible')refresh();},5000);
  document.addEventListener('visibilitychange',()=>{if(overview()&&document.visibilityState==='visible')refresh(true);});
  window.addEventListener('focus',()=>{if(overview())refresh(true);});
  window.addEventListener('hashchange',()=>{if(overview())refresh(true);});
  document.addEventListener('click',event=>{if(event.target.closest('[data-traffic-retry]'))refresh(true);});
  if(overview())refresh();
 }
 window.LocalDNSTrafficClient={render:draw,refresh,mount(container,minutes){draw(container,minutes);refresh();}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
