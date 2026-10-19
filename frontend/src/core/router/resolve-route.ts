export const routeIds = ['overview', 'logs', 'upstreams', 'rules', 'management'] as const;
export type RouteId = typeof routeIds[number];

export function resolveRoute(value: string): RouteId {
  let id = value.replace(/^#\/?/, '').split('?')[0];
  if (id === 'data' || id === 'features') id = 'management';
  return routeIds.includes(id as RouteId) ? id as RouteId : 'overview';
}
