import { fmtDate } from '../../shared/format/number.js';

/** Keep the original record for details/export; templates consume this display model. */
export function logViewModel(record, aliases = {}) {
  const type = String(record.query_type || '').toUpperCase();
  return {
    record,
    time: fmtDate(record.query_time),
    mobileTime: new Date(record.query_time).toLocaleTimeString('zh-CN', { hour12: false }),
    domain: String(record.query_name || ''), type, queryType: String(record.query_type || ''),
    shortType: ({ AAAA:'6', A:'A', CNAME:'C', PTR:'P', HTTPS:'H', TXT:'T', MX:'M', NS:'N', SRV:'S' })[type] || type[0] || '?',
    blocked: /黑|BAN|BLOCK|拒绝|拦截/i.test(String(record.domain_set || '')),
    answer: (record.answers || []).map(answer => answer?.data || answer?.value).filter(Boolean).join(', ') || record.response_code || '—',
    set: record.domain_set, duration: record.duration_ms,
    client: String(record.client_ip || ''), clientLabel: aliases[record.client_ip] || record.client_ip,
    code: record.response_code, success: record.response_code === 'NOERROR',
  };
}
