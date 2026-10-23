import { api } from '../../core/api/api.js';
import { parseProm } from '../../shared/metrics/prometheus';
import { safeResult } from '../../shared/async.js';
import { upstreamMetrics } from './errors.js';

export async function readUpstreams(scope) {
  // config/tags 是页面骨架：任一失败仍然整页报错。
  const [configResult, tagsResult] = await scope.guard(Promise.all([
    safeResult(() => api.request('/api/v1/upstream/config')),
    safeResult(() => api.request('/api/v1/upstream/tags')),
  ]));
  if (!configResult.ok) throw configResult.error;
  if (!tagsResult.ok) throw tagsResult.error;
  const config = configResult.data, tags = tagsResult.data;
  // metrics/ecs 只是增强数据：失败时降级为空并标记 degraded，
  // 页面照常渲染（指标显示占位），不再因单个接口失败整页挂掉。
  const [metricsResult, ecsResult] = await Promise.all([
    safeResult(() => api.metrics()), safeResult(() => api.request('/api/v1/upstream/ecs')),
  ]);
  const ecs = ecsResult.ok ? ecsResult.data : null;
  const groups = Array.isArray(tags) ? tags : Object.keys(config);
  const metrics = parseProm(metricsResult.ok ? metricsResult.data : ''), rows = [];
  groups.forEach(group => (config[group] || []).forEach((upstream, index) => {
    rows.push({ g: group, u: upstream, i: index, m: upstreamMetrics(metrics, group, upstream.tag) });
  }));
  rows.sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false));
  return { config, ecs: typeof ecs?.ecs === 'string' ? ecs.ecs : '', groups, rows, degraded: { metrics: !metricsResult.ok, ecs: !ecsResult.ok } };
}

export function writeUpstreamGroup(group, candidate, ecs) {
  const body = { plugin_tag: group, upstreams: candidate || [] };
  if (group === 'foreign_ecs' && typeof ecs === 'string') body.ecs = ecs;
  return api.json('/api/v1/upstream/config', 'POST', body);
}
