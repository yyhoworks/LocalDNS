import { currentScope } from '../../../core/router/route-lifetime';
import { throwIfAborted } from '../../../core/lifecycle/abort';
import { trafficService } from './model.js';
import { trafficRepository } from './repository';
import { assetHttp } from '../../../core/api/network.ts';
export let trafficClientService;
export function initialize() {
  const series=[];
  let range=60,metric='anomaly',overviewContext=null,pending=null,lastAttempt=0,error='',storageError='',loading=true,mountedScope,breakNext=true;
  const overview=()=>!location.hash||location.hash==='#/overview'||location.hash==='#overview';
  const base=()=>new URL(String(window.LOCALDNS_UI_CONFIG?.apiBase||location.origin).replace(/\/$/,''),location.origin);
  const source=base().href.replace(/\/$/,'');
  const ready=trafficRepository.load(source).then(async rows=>{
    // v2 升级：延迟改由上游 p50 仪表值提供，旧行里的区间均值（或 null）会让
    // 趋势线画出一段误导性的片段。把旧行的 latency 清空并写回一次。
    const legacy=rows.filter(row=>row.latencyNow==null&&row.latency!=null);
    if(legacy.length){
      for(const row of legacy)row.latency=null;
      let migrated=false;
      try{migrated=localStorage.getItem('localdns-trends-schema:'+source)==='2';}catch{}
      if(!migrated){
        await trafficRepository.rewrite(legacy).catch(()=>{});
        try{localStorage.setItem('localdns-trends-schema:'+source,'2');}catch{}
      }
    }
    // History may finish after live sampling has begun. Merge without dropping live points.
    const combined=rows.concat(series.map(p=>trafficService.raw(p,p.time))).sort((a,b)=>a.time-b.time);
    series.length=0;
    for(const row of combined)trafficService.record(series,row,row.time);
  }).catch(()=>{storageError='无法读取浏览器历史';}).finally(()=>{loading=false;redraw();});
  function draw(container,minutes=range){
    if(!container?.isConnected)return;range=minutes;container.dataset.trafficMinutes=String(minutes);
    trafficService.render(container,series,minutes,Date.now(),{metric,error,storageError,loading,overviewContext});
  }
  function redraw(){for(const container of document.querySelectorAll('.traffic-chart-body'))draw(container,Number(container.dataset.trafficMinutes)||range);}
  function setOverviewContext(ctx){overviewContext=ctx;redraw();}
  async function refresh(force=false){
    const scope=currentScope();
    if(pending?.scope===scope)return pending.promise;
    if(!force&&Date.now()-lastAttempt<4000)return;
    lastAttempt=Date.now();
    const controller=new AbortController(),release=scope.add(()=>controller.abort());
    const request={scope,controller};pending=request;
    request.promise=(async()=>{
      try{
        throwIfAborted(scope.signal);
        const response=await assetHttp.fetch(new URL(source+'/metrics'),{cache:'no-store',signal:controller.signal,credentials:'omit'});
        if(!response.ok)throw new Error('无法读取 DNS 查询采样');
        const sample=trafficService.parse(await response.text());
        if(sample.total===null)throw new Error('DNS 核心未返回查询计数');
        throwIfAborted(scope.signal);
        const recorded=trafficService.record(series,{...sample,breakBefore:breakNext});error='';
        if(recorded){
          breakNext=false;
          redraw();
          // Storage latency must not hold the network request or the five-second poll open.
          trafficRepository.save(source,trafficService.raw(series.at(-1),series.at(-1).time))
            .then(()=>{storageError='';if(!scope.signal.aborted)redraw();})
            .catch(()=>{storageError='无法保存浏览器历史';if(!scope.signal.aborted)redraw();});
        }
      }catch{
        if(!scope.signal.aborted)error='DNS 趋势采样暂时不可用，请检查连接后重新读取。';
      }finally{
        release();if(pending===request)pending=null;if(!scope.signal.aborted)redraw();
      }
    })();
    return request.promise;
  }
  function start(scope=currentScope()){
    if(scope===mountedScope)return;
    mountedScope=scope;
    scope.add(()=>{if(!overview()||document.visibilityState!=='visible')breakNext=true;});
    scope.interval(()=>{if(document.visibilityState==='visible')refresh(true);},5000);
    if(breakNext||!series.length)scope.timeout(()=>{if(document.visibilityState==='visible')refresh(true);},2000);
    scope.listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')refresh(true);else breakNext=true;});
    scope.listen(document,'freeze',()=>{breakNext=true;});
    scope.listen(window,'focus',()=>refresh(true));
    scope.listen(document,'click',event=>{
      const button=event.target.closest('[data-traffic-metric]');
      if(button?.closest('.traffic-chart-body')&&trafficService.definitions[button.dataset.trafficMetric]){
        metric=button.dataset.trafficMetric;redraw();
      }
      if(event.target.closest('[data-traffic-retry]'))refresh(true);
    });
    refresh(true);
  }
  function mount(container,minutes){draw(container,minutes);start();}
  trafficClientService={render:draw,refresh,start,mount,ready,setOverviewContext};
}
