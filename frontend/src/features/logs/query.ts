/** Session UI state: retained across hash navigation, reset only by the user. */
export function createLogQuery(mobile: boolean) {
  return { page: 1, limit: mobile ? 25 : 50, q: '', exact: false, type: '', set: '', code: '', client: '' };
}

export function logQueryParams(query: ReturnType<typeof createLogQuery>) {
  return { page: query.page, limit: query.limit, q: query.q, exact: query.exact,
    query_type: query.type, domain_set: query.set, response_code: query.code, client_contains: query.client };
}
