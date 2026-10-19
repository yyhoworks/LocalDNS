import { ApiError } from './api-error';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(`${name} 返回格式无效。`, 0, value, 'contract');
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new ApiError(`${name} 返回格式无效。`, 0, value, 'contract');
  return value;
}

/** Validate known fields without dropping extension fields supplied by newer backends. */
export function normalizeResponse(path: string, value: unknown): unknown {
  const endpoint = path.split('?')[0];
  if (endpoint === '/metrics') {
    if (typeof value !== 'string') throw new ApiError('指标必须为文本。', 0, value, 'contract');
  } else if (endpoint === '/api/v2/audit/logs') {
    const data = record(value, '查询日志');
    const logs = data.logs === undefined ? [] : array(data.logs, '查询日志');
    logs.forEach(log => {
      const item = record(log, '查询记录');
      for (const key of ['query_name', 'query_type', 'client_ip', 'response_code']) {
        if (item[key] !== undefined && typeof item[key] !== 'string') throw new ApiError(`查询记录 ${key} 类型无效。`, 0, item, 'contract');
      }
      if (item.answers !== undefined) array(item.answers, 'DNS 应答').forEach(answer => record(answer, 'DNS 应答'));
    });
    const filters = data.filters === undefined ? {} : record(data.filters, '日志筛选');
    for (const key of ['query_types', 'domain_sets', 'response_codes']) {
      if (filters[key] !== undefined && !array(filters[key], '日志筛选').every(item => typeof item === 'string')) throw new ApiError('日志筛选类型无效。', 0, filters, 'contract');
    }
    const pagination = data.pagination === undefined ? {} : record(data.pagination, '分页');
    for (const key of ['current_page', 'total_pages', 'total_items']) {
      if (pagination[key] !== undefined && (!Number.isFinite(pagination[key]) || Number(pagination[key]) < 0)) throw new ApiError('分页数据无效。', 0, pagination, 'contract');
    }
    return { ...data, logs, filters, pagination };
  } else if (endpoint === '/api/v1/upstream/tags') {
    if (!array(value, '上游分组').every(tag => typeof tag === 'string')) throw new ApiError('上游分组类型无效。', 0, value, 'contract');
  } else if (endpoint === '/api/v1/upstream/ecs') {
    const data = record(value, 'ECS');
    if (data.ecs !== undefined && typeof data.ecs !== 'string') throw new ApiError('ECS 类型无效。', 0, value, 'contract');
  } else if (endpoint.startsWith('/api/v2/audit/rank/')) {
    array(value, '排行').forEach(item => record(item, '排行项目'));
  } else if (['/api/v2/audit/stats', '/api/v1/audit/status', '/api/v1/audit/capacity', '/api/v1/upstream/config', '/api/v1/status', '/plugins/client_name'].includes(endpoint)) {
    const data = record(value, endpoint);
    if (endpoint === '/api/v1/upstream/config') {
      for (const group of Object.values(data)) array(group, '上游配置').forEach(item => {
        const upstream = record(item, '上游');
        for (const key of ['tag', 'addr', 'server_addr', 'protocol', 'dial_addr', 'socks5']) {
          if (upstream[key] !== undefined && typeof upstream[key] !== 'string') throw new ApiError(`上游 ${key} 类型无效。`, 0, item, 'contract');
        }
        if (upstream.enabled !== undefined && typeof upstream.enabled !== 'boolean') throw new ApiError('上游启用状态类型无效。', 0, item, 'contract');
      });
    }
    if (endpoint === '/plugins/client_name' && !Object.values(data).every(alias => typeof alias === 'string')) {
      throw new ApiError('客户端别名类型无效。', 0, data, 'contract');
    }
    if (endpoint === '/api/v2/audit/stats') {
      for (const key of ['total_queries', 'average_duration_ms', 'client_count', 'domain_count']) if (data[key] !== undefined && !Number.isFinite(data[key])) throw new ApiError(`统计 ${key} 类型无效。`, 0, data, 'contract');
    }
  }
  return value;
}
