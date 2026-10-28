export const routeIds = ['overview', 'logs', 'upstreams', 'rules', 'management', 'proxy-config'] as const;
export type RouteId = typeof routeIds[number];

// 二级锚点白名单：只有列出的段才会被保留，其余未知段直接丢弃，
// 避免拼错的 hash 把页面带到不存在的页签或空白区。
const routeSubs: Partial<Record<RouteId, string[]>> = {
  rules: ['lists', 'adguard', 'diversion', 'auto'],
  management: ['cache', 'features'],
};

export function parseRoute(value: string): { route: RouteId; sub: string | null } {
  let id = value.replace(/^#\/?/, '').split('?')[0];
  if (id === 'data' || id === 'features') id = 'management';
  const [base, ...rest] = id.split('/');
  const route = (routeIds.includes(base as RouteId) ? base : 'overview') as RouteId;
  const sub = rest.join('/') || null;
  const allowed = routeSubs[route] || [];
  return { route, sub: sub && allowed.includes(sub) ? sub : null };
}

export function resolveRoute(value: string): RouteId {
  return parseRoute(value).route;
}
