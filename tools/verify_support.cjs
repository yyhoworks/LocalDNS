// Shared helpers for the browser verification scripts. Fixtures only; nothing here reaches a real backend.
const path = require('node:path');

/**
 * Launch the verification browser. Defaults to Microsoft Edge (the maintainers' setup).
 * - LOCALDNS_BROWSER: Playwright channel (msedge, chrome, ...). Ignored when a path is given.
 * - LOCALDNS_BROWSER_PATH: executable to launch instead, e.g. /usr/bin/chromium on Linux CI.
 */
function launchBrowser(chromium, options = {}) {
  const executablePath = process.env.LOCALDNS_BROWSER_PATH;
  if (executablePath) return chromium.launch({ headless: true, ...options, executablePath: path.resolve(executablePath) });
  return chromium.launch({ headless: true, ...options, channel: process.env.LOCALDNS_BROWSER || 'msedge' });
}
const browserLabel = () => process.env.LOCALDNS_BROWSER_PATH || process.env.LOCALDNS_BROWSER || 'msedge';

/**
 * The released backend (VERSION.json backendVersion FJGOE, FJGLI API family) answers
 * GET /api/v1/features; BackendClient then rewrites legacy UI paths to the FJGLI routes.
 * Values mirror the existing legacy fixtures (switchN/show = 'A'); FJGOE has one client policy.
 */
const FJGOE_FEATURES = Object.freeze({
  request_blocking: true, block_special_qtypes: true, adguard: true, block_aaaa: true,
  full_cache: true, route_cache: true, client_policy: 'normal',
});

const lists = { direct: 'whitelist', block: 'blocklist', proxy: 'greylist', proxy_realip: 'force_realip',
  ddns: 'ddns_domains', pcdn: 'pcdn_domains', pcdn_v4: 'pcdn_regex_v4', pcdn_v6: 'pcdn_regex_v6',
  clients: 'client_ip', direct_cidrs: 'direct_ip', rewrite: 'rewrite' };
const refresh = { status: 'status', start: 'trigger', cancel: 'cancel', reset: 'reset',
  schedule: 'scheduler/config', counts: 'stats/source_file_counts' };

/**
 * Map an FJGOE route (as requested by BackendClient) back to the legacy key used by
 * frontend/tests/fixtures/api.json, so one set of fixture bodies serves the released backend.
 * The inverse of frontend/src/core/api/backend-client.ts; unknown paths are returned unchanged.
 */
function fixtureKey(p) {
  let m;
  if (p === '/api/v1/querylog/entries') return '/api/v2/audit/logs';
  if ((m = p.match(/^\/api\/v1\/querylog\/(stats|rank\/.+)$/))) return '/api/v2/audit/' + m[1];
  if ((m = p.match(/^\/api\/v1\/querylog\/(.+)$/))) return '/api/v1/audit/' + m[1];
  if (p === '/api/v1/client-aliases') return '/plugins/client_name';
  if ((m = p.match(/^\/api\/v1\/lists\/([\w-]+)$/)) && lists[m[1]]) return `/plugins/${lists[m[1]]}/show`;
  if ((m = p.match(/^\/api\/v1\/caches\/([\w-]+)(?:\/(save|flush))?$/))) return `/plugins/cache_${m[1]}/${m[2] || 'show'}`;
  if ((m = p.match(/^\/api\/v1\/domain-stats(?:\/(save|flush))?$/))) return `/plugins/domain_stats/${m[1] || 'show'}`;
  if ((m = p.match(/^\/api\/v1\/learned\/(\w+)(?:\/(save|flush))?$/))) return `/plugins/${m[1]}/${m[2] || 'show'}`;
  if ((m = p.match(/^\/api\/v1\/route-refresh\/(\w+)$/)) && refresh[m[1]]) return '/plugins/requery/' + refresh[m[1]];
  if ((m = p.match(/^\/api\/v1\/adguard\/(.+)$/))) return '/plugins/adguard/' + m[1];
  if ((m = p.match(/^\/api\/v1\/rule-groups\/([\w-]+)\/([^/]+)\/update$/))) return `/plugins/${m[1]}/update/${m[2]}`;
  if ((m = p.match(/^\/api\/v1\/rule-groups\/([\w-]+)(?:\/([^/]+))?$/))) return `/plugins/${m[1]}/config` + (m[2] ? '/' + m[2] : '');
  return p;
}

module.exports = { launchBrowser, browserLabel, FJGOE_FEATURES, fixtureKey };
