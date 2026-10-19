import { metricFind } from '../../shared/metrics/prometheus.ts';

  function parseSystem(metrics){ const start=metricFind(metrics,'process_start_time_seconds'); const info=metrics.find(x=>x.name==='localdns_runtime_info'); const ver=metrics.find(x=>x.name==='localdns_info'); return {
    version:ver?.labels?.version||'', platform:info?.labels?.platform||'',
    start, uptime:start?Date.now()/1000-start:0, cpu:metricFind(metrics,'process_cpu_seconds_total'), rss:metricFind(metrics,'process_resident_memory_bytes'), heapIdle:metricFind(metrics,'localdns_heap_free_bytes'),
    runtime:info?`Rust ${String(info.labels?.runtime||'').replace('rust-','')}`:'—', threads:metricFind(metrics,'localdns_threads'), goroutines:metricFind(metrics,'localdns_tasks'), fds:metricFind(metrics,'process_open_fds')
  };}

  function parseCaches(metrics){ const tags=['cache_main','cache_domestic','cache_foreign','cache_foreign_ecs']; return tags.map(tag=>{const q=metricFind(metrics,'localdns_cache_query_total',{tag}),h=metricFind(metrics,'localdns_cache_hit_total',{tag}),l=metricFind(metrics,'localdns_cache_lazy_hit_total',{tag}),size=metricFind(metrics,'localdns_cache_size_current',{tag});return{tag,q,h,l,size,hit:q?h/q*100:0,lazy:q?l/q*100:0};}); }
export { parseSystem, parseCaches };
