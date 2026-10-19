import { api } from '../../core/api/api.js';
import { parseProm } from '../../shared/metrics/prometheus';
import { upstreamMetrics } from './errors.js';

export async function readUpstreams(scope) {
  const [config, tags, rawMetrics, ecs] = await scope.guard(Promise.all([
    api.request('/api/v1/upstream/config'), api.request('/api/v1/upstream/tags'),
    api.metrics(), api.request('/api/v1/upstream/ecs'),
  ]));
  const groups = Array.isArray(tags) ? tags : Object.keys(config);
  const metrics = parseProm(rawMetrics), rows = [];
  groups.forEach(group => (config[group] || []).forEach((upstream, index) => {
    rows.push({ g: group, u: upstream, i: index, m: upstreamMetrics(metrics, group, upstream.tag) });
  }));
  rows.sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false));
  return { config, ecs: typeof ecs?.ecs === 'string' ? ecs.ecs : '', groups, rows };
}

export function writeUpstreamGroup(group, candidate, ecs) {
  const body = { plugin_tag: group, upstreams: candidate || [] };
  if (group === 'foreign_ecs' && typeof ecs === 'string') body.ecs = ecs;
  return api.json('/api/v1/upstream/config', 'POST', body);
}
