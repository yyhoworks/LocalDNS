// Local UI preview with an allowlisted read-only backend proxy. No deployment occurs.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

function isReadEndpoint(url) {
  return url === '/metrics' || /^\/api\/v1\/(status|audit\/(status|capacity)|upstream\/(config|tags|ecs))$/.test(url) ||
    /^\/api\/v2\/audit\/(stats|rank\/[\w-]+|logs(?:\/[\w-]+)?)$/.test(url) ||
    url === '/plugins/client_name' || url === '/plugins/adguard/rules' ||
    /^\/plugins\/[\w-]+\/(show|config|status)$/.test(url) ||
    /^\/plugins\/requery\/(scheduler\/config|stats\/source_file_counts)$/.test(url);
}
function createPreviewServer({ backend = '', onBlocked = () => {} } = {}) {
  const root = path.resolve(__dirname, '../_src/ui');
  const base = backend ? new URL(backend) : null;
  if (base && !['http:', 'https:'].includes(base.protocol)) throw new Error('Backend must use HTTP(S)');
  return http.createServer((request, response) => {
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { response.writeHead(400).end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    const isApi = /^\/(api|plugins)\//.test(url.pathname) || url.pathname === '/metrics';
    if (request.method !== 'GET' || (isApi && !isReadEndpoint(url.pathname))) {
      onBlocked({ method: request.method, path: url.pathname });
      response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '只读预览：不允许修改后端配置或执行任务。' })); return;
    }
    if (isApi) {
      if (!base) { response.writeHead(503).end('Preview backend is not configured'); return; }
      const target = new URL(url.pathname + url.search, base);
      const upstream = (target.protocol === 'https:' ? https : http).get(target, result => {
        response.writeHead(result.statusCode, { 'Content-Type': result.headers['content-type'] || 'text/plain' });
        result.pipe(response);
      });
      upstream.setTimeout(10000, () => upstream.destroy(new Error('Backend request timed out')));
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Preview backend unavailable'); });
      response.on('close', () => upstream.destroy()); return;
    }
    let relative;
    try { relative = decodeURIComponent(url.pathname.replace(/^\/ui(?=\/|$)/, '') || '/'); }
    catch { response.writeHead(400).end(); return; }
    if (relative === '/') relative = '/index.html';
    const file = path.resolve(root, '.' + relative);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    if (relative === '/config.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      response.end('window.LOCALDNS_UI_CONFIG={apiBase:"",title:"LocalDNS · 合并版只读预览",refreshInterval:30,requestTimeout:10000,demoOnApiFailure:false};'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(data);
    });
  });
}
module.exports = { createPreviewServer, isReadEndpoint };
if (require.main === module) {
  const port = Number(process.env.LOCALDNS_PREVIEW_PORT || 8792);
  const server = createPreviewServer({ backend: process.env.LOCALDNS_PREVIEW_BACKEND });
  server.listen(port, '127.0.0.1', () => console.log(`READ_ONLY_PREVIEW=http://127.0.0.1:${port}/ui/`));
}
