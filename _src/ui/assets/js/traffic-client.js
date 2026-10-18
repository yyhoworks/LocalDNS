/* Device-owned sampling; the browser reads bounded, server-persisted history. */
(() => {
 'use strict';
 const histories=new Map(),requests=new Map(),attempts=new Map();let range=60;
 const overview=()=>!location.hash||location.hash==='#/overview'||location.hash==='#overview';
 function draw(container,minutes=range){
  if(!container?.isConnected)return;range=minutes;container.dataset.trafficMinutes=String(minutes);
  const history=histories.get(minutes)||{points:[],offset:0,loading:true,error:''};
  window.LocalDNSTraffic.render(container,history.points,minutes,Date.now()+history.offset,{loading:history.loading,error:history.error,current:history.current,source:'server'});
 }
 function redraw(){for(const container of document.querySelectorAll('.traffic-chart-body'))draw(container,Number(container.dataset.trafficMinutes)||range);}
 async function refresh(force=false,minutes=range){
  if(requests.has(minutes))return requests.get(minutes);
  if(!force&&Date.now()-(attempts.get(minutes)||0)<4000)return;
  attempts.set(minutes,Date.now());
  const task=(async()=>{
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
   try{
    const service=new URL(window.LOCALDNS_UI_CONFIG?.proxyConfigBase||location.origin);
    if(!window.LOCALDNS_UI_CONFIG?.proxyConfigBase)service.port='9098';
    service.pathname='/api/proxy-config/traffic';service.search='?minutes='+minutes;service.hash='';
    const response=await fetch(service,{cache:'no-store',credentials:'omit',signal:controller.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'无法读取服务器采样记录。');
    if(!Array.isArray(result.points)||!Number.isFinite(result.now))throw new Error('服务器采样数据格式不正确。');
    const points=result.points.filter(sample=>Number.isFinite(sample.time)&&Number.isFinite(sample.elapsed)&&(sample.qps===null||Number.isFinite(sample.qps)));
    histories.set(minutes,{points,offset:result.now-Date.now(),current:result.current,loading:false,error:String(result.error||'')});
   }catch(error){
    const previous=histories.get(minutes)||{points:[],offset:0};
    histories.set(minutes,{...previous,loading:false,error:error.name==='AbortError'?'采样记录读取超时，正在自动重试。':error instanceof TypeError?'暂时无法读取服务器采样，正在自动重试。':error.message});
   }finally{clearTimeout(timeout);requests.delete(minutes);if(minutes===range)redraw();}
  })();requests.set(minutes,task);return task;
 }
 function setup(){
  setInterval(()=>{if(overview()&&document.visibilityState==='visible')refresh();},5000);
  document.addEventListener('visibilitychange',()=>{if(overview()&&document.visibilityState==='visible')refresh(true);});
  window.addEventListener('focus',()=>{if(overview())refresh(true);});
  window.addEventListener('hashchange',()=>{if(overview())refresh(true);});
  document.addEventListener('click',event=>{if(event.target.closest('[data-traffic-retry]'))refresh(true);});
  if(overview())refresh();
 }
 window.LocalDNSTrafficClient={render:draw,refresh,mount(container,minutes){draw(container,minutes);refresh(false,minutes);}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
