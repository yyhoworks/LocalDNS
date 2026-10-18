/* Per-category request latency. Never substitute upstream probes for request duration. */
(() => {
  'use strict';
  const limit = 1000;
  function params(kind, key) {
    if (kind === 'domain') return {q:key, exact:true};
    if (kind === 'client') return {q:key, exact:true, client_contains:key};
    if (kind === 'set') return {domain_set:key};
    throw new Error('未知排行类型');
  }
  function summarize(kind, key, response) {
    const field = {domain:'query_name', client:'client_ip', set:'domain_set'}[kind];
    const logs = Array.isArray(response?.logs) ? response.logs : [];
    const matching = logs.filter(row => row[field] === key);
    const durations = matching.filter(row => row.duration_ms !== null &&
      row.duration_ms !== undefined && row.duration_ms !== '' &&
      Number.isFinite(Number(row.duration_ms)) && Number(row.duration_ms) >= 0).map(row => Number(row.duration_ms));
    const total = Number(response?.pagination?.total_items);
    return {average:durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      samples:durations.length, total:Number.isFinite(total) ? total : logs.length,
      partial:total > logs.length || durations.length < matching.length};
  }
  function create(loadLogs, now = Date.now) {
    const cache = new Map(), queue = [];
    let active = 0;
    function pump() {
      while (active < 4 && queue.length) {
        const job = queue.shift();
        if (!job.current()) { job.reject(new DOMException('页面已切换', 'AbortError')); continue; }
        active++;
        Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; pump(); });
      }
    }
    function get(kind, key, current = () => true) {
      const id = JSON.stringify([kind, key]), saved = cache.get(id);
      if (saved && now() - saved.time < 60000) return saved.promise;
      const entry = {time:now()};
      entry.promise = new Promise((resolve, reject) => {
        queue.push({resolve, reject, current, run:async () => summarize(kind, key,
          await loadLogs({page:1, limit, ...params(kind, key)}))});
      }).catch(error => { if (cache.get(id) === entry) cache.delete(id); throw error; });
      cache.delete(id);
      cache.set(id, entry);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
      pump();
      return entry.promise;
    }
    return {get};
  }
  window.LocalDNSRankLatency = {create, summarize, params};
})();
