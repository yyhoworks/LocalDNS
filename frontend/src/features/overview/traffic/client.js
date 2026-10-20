import { currentScope } from '../../../core/router/route-lifetime';
import { throwIfAborted } from '../../../core/lifecycle/abort';
import { trafficService } from './model.js';
import { trafficRepository } from './repository';
import { assetHttp } from '../../../core/api/network.ts';
export let trafficClientService;
export function initialize() {
  const series=[];
  let range=60,metric='qps',pending=null,lastAttempt=0,error='',storageError='',loading=true,mountedScope,breakNext=true;
  const overview=()=>!location.hash||location.hash==='#/overview'||location.hash==='#overview';
  const base=()=>new URL(String(window.LOCALDNS_UI_CONFIG?.apiBase||location.origin).replace(/\/$/,''),location.origin);
  const source=base().href.replace(/\/$/,'');
  const ready=trafficRepository.load(source).then(rows=>{
    for(const row of rows)trafficService.record(series,row,row.time);
  }).catch(()=>{storageError='无法读取浏览器历史';}).finally(()=>{loading=false;redraw();});
  function draw(container,minutes=range){
    if(!container?.isConnected)return;range=minutes;container.dataset.trafficMinutes=String(minutes);
    trafficService.render(container,series,minutes,Date.now(),{metric,error,storageError,loading});
  }
  function redraw(){for(const container of document.querySelectorAll('.traffic-chart-body'))draw(container,Number(container.dataset.trafficMinutes)||range);}
  async function refresh(force=false){
    const scope=currentScope();
    if(pending?.scope===scope)return pending.promise;
    if(!force&&Date.now()-lastAttempt<4000)return;
    lastAttempt=Date.now();
    const controller=new AbortController(),release=scope.add(()=>controller.abort());
    const request={scope,controller};pending=request;
    request.promise=(async()=>{
      try{
        await ready;throwIfAborted(scope.signal);
        const response=await assetHttp.fetch(new URL(source+'/metrics'),{cache:'no-store',signal:controller.signal,credentials:'omit'});
        if(!response.ok)throw new Error('无法读取 DNS 查询采样');
        const sample=trafficService.parse(await response.text());
        if(sample.total===null)throw new Error('DNS 核心未返回查询计数');
        throwIfAborted(scope.signal);
        const recorded=trafficService.record(series,{...sample,breakBefore:breakNext});error='';
        if(recorded){
          breakNext=false;
          redraw();
          try{await trafficRepository.save(source,trafficService.raw(series.at(-1),series.at(-1).time));storageError='';}
          catch{storageError='无法保存浏览器历史';}
        }
      }catch{
        if(!scope.signal.aborted)error='DNS 趋势采样暂时不可用，请检查连接后重新读取。';
      }finally{
        release();if(pending===request)pending=null;if(!scope.signal.aborted)redraw();
      }
    })();
    return request.promise;
  }
  function mount(container,minutes){
    draw(container,minutes);
    const scope=currentScope();
    if(scope===mountedScope)return;
    mountedScope=scope;
    scope.add(()=>{if(!overview()||document.visibilityState!=='visible')breakNext=true;});
    scope.interval(()=>{if(document.visibilityState==='visible')refresh();},5000);
    scope.listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')refresh(true);else breakNext=true;});
    scope.listen(document,'freeze',()=>{breakNext=true;});
    scope.listen(window,'focus',()=>refresh(true));
    scope.listen(document,'click',event=>{
      const button=event.target.closest('[data-traffic-metric]');
      if(button&&container.contains(button)&&trafficService.definitions[button.dataset.trafficMetric]){
        metric=button.dataset.trafficMetric;redraw();
      }
      if(event.target.closest('[data-traffic-retry]'))refresh(true);
    });
    refresh(true);
  }
  trafficClientService={render:draw,refresh,mount,ready};
}
