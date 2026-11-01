import { setHTML } from '../../core/security/safe-dom.ts';
import { assetHttp } from '../../core/api/network.ts';
import { preferences } from '../../core/persistence/preferences.ts';
import { createUIUpdatePanel } from './ui-update-panel';
import { releaseRetryAt } from './release-backoff';
import { githubAuthHeaders, readGithubToken, RELEASE_RETRY_KEY } from './github-token';
const versionService = (() => {
  'use strict';
  const REPO = 'https://github.com/yyhoworks/LocalDNS';
  const ENDPOINT = 'https://api.github.com/repos/yyhoworks/LocalDNS/releases/latest';
  const TTL = 6 * 60 * 60 * 1000;
  // 保留发行标签里的原始写法（2026.11.01.8）；用解析后的数字重拼会丢掉前导零。
  function versionText(value) {
    const match = String(value || '').match(/(?:^|ui-v|^v)(\d{4}\.\d+\.\d+\.\d+)(?=$|[-+])/i);
    return match ? match[1] : '';
  }
  function versionParts(value) {
    const text = versionText(value);
    return text ? text.split('.').map(Number) : null;
  }
  function compareVersions(a, b) {
    const aa = versionParts(a), bb = versionParts(b);
    if (!aa || !bb) return null;
    for (let i = 0; i < 4; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
    return 0;
  }
  function releaseInfo(value) {
    if (!value || value.draft || value.prerelease || !versionParts(value.tag_name))
      throw new Error('GitHub 返回的正式版信息无法识别，请稍后重试。');
    const tag = String(value.tag_name);
    const files = (Array.isArray(value.assets) ? value.assets : []).map(item => String(item.name || ''));
    return {tag, version: versionText(tag),
      backend: tag.match(/^([a-z0-9]+)-ui-v/i)?.[1]?.toUpperCase() || '',
      url: REPO + '/releases/tag/' + encodeURIComponent(tag),
      assetNames: files,
      packages: [files.some(x => /_Update\.zip$/i.test(x)) && 'UI 升级包',
        files.some(x => /_Full\.zip$/i.test(x)) && '含核心完整包',
        files.some(x => /_Service\.zip$/i.test(x)) && '配套服务包'].filter(Boolean)};
  }
  function assess(installed, latest) {
    const baseline = installed.channel === 'local' ? installed.baseUiVersion : installed.uiVersion;
    const comparison = compareVersions(latest.version, baseline);
    const sameVersionNewCore = comparison === 0 && latest.backend &&
      latest.backend !== String(installed.backendVersion || '').toUpperCase();
    return {available: comparison > 0 || sameVersionNewCore, comparison,
      local: installed.channel === 'local', baseline};
  }
  function setup() {
    const start = async () => {
      const button = document.querySelector('#version-button');
      if (!button) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'version-dialog'; dialog.className = 'version-dialog';
      dialog.setAttribute('aria-labelledby', 'version-dialog-title');
      setHTML(dialog, '<div class="version-dialog-head"><h2 id="version-dialog-title">版本与更新</h2><form method="dialog"><button type="submit" class="glass-btn" aria-label="关闭版本信息">关闭</button></form></div><div id="version-content" aria-live="polite"></div><div class="version-actions"><button type="button" class="button" id="version-check-now">检查更新</button><a class="button" href="' + REPO + '/releases" target="_blank" rel="noopener noreferrer" id="version-release-link">查看 GitHub 发布</a></div>');
      document.body.append(dialog);
      const content = dialog.querySelector('#version-content'), manual = dialog.querySelector('#version-check-now');
      const cacheKey = 'localdns-release-check-v1:' + location.origin + ':' +
        String(window.LOCALDNS_UI_CONFIG?.apiBase || '');
      let runningBackend = null;
      let installed = null, latest = null, checkedAt = 0, lastAttemptAt = 0, error = '', metadataError = '', checking = false, pending;
      const cooldownKey = RELEASE_RETRY_KEY;
      let retryAt = 0, retryTimer;
      function readCooldown() {
        try { retryAt = Math.max(retryAt, Number(preferences.getItem(cooldownKey)) || 0); } catch {}
      }
      function waitForRetry() {
        clearTimeout(retryTimer);
        if (retryAt > Date.now()) retryTimer = setTimeout(() => paint(), Math.min(2147483647, retryAt - Date.now() + 50));
      }
      const updateSection = document.createElement('section');
      dialog.querySelector('.version-actions').before(updateSection);
      const updater = createUIUpdatePanel(updateSection);
      // 令牌在「系统管理 → GitHub 访问」里维护；这里只负责携带它，被拒时停用。
      let tokenRejected = false, rejectedFor = '';
      function currentToken() {
        const stored = readGithubToken();
        if (stored !== rejectedFor) tokenRejected = false;
        return tokenRejected ? '' : stored;
      }
      const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      const date = value => value ? new Date(value).toLocaleString('zh-CN', {hour12: false}) : '尚未检查';
      function paint() {
        const limited = retryAt > Date.now();
        const status = installed && latest ? assess({ ...installed, backendVersion: runningBackend || installed.backendVersion }, latest) : null;
        const text = checking ? '检查中' : limited ? '请求受限' : error ? '检查失败' : !installed ? '版本未读取' :
          !latest ? '尚未检查' : status.available ? '有新版本' : status.comparison === null ? '版本待核对' :
          status.local ? '本地测试版' : status.comparison < 0 ? '当前版本较新' : '已是最新';
        button.dataset.status = error || limited ? 'error' : status?.available ? 'update' : 'normal';
        const displayVersion = String(installed?.uiVersion || '').replace(/-local.*$/, '');
        button.querySelector('[data-version-number]').textContent = displayVersion ? 'UI ' + displayVersion : '版本';
        button.querySelector('[data-version-status]').textContent = text;
        button.title = `版本与更新：${installed?.uiVersion || '未读取'}，${text}`;
        button.setAttribute('aria-label', button.title);
        manual.disabled = checking || limited;
        manual.textContent = checking ? '正在检查…' : limited ? '等待 GitHub 限流恢复' : '检查更新';
        const fact = (name, value) => `<div><dt>${name}</dt><dd>${escape(value)}</dd></div>`;
        const backend = runningBackend || document.querySelector('#brand-version-tag')?.dataset.backendVersion || installed?.backendVersion;
        setHTML(content, `<dl class="version-facts">${fact('当前 UI', installed?.uiVersion || '未能读取')}${fact('DNS 核心', backend || '尚未读取')}${fact('GitHub 最新正式版', latest ? latest.version + (latest.backend ? ' / ' + latest.backend : '') : '尚未读取')}${fact('上次成功检查', date(checkedAt))}${limited ? fact('允许再次检查', date(retryAt)) : ''}</dl><p class="version-result">${escape(checking ? '正在获取 GitHub 最新正式版…' : limited || error ? '更新检查暂不可用，保留上次成功检查的结果。' : status?.available ? 'GitHub 已发布新版本，可查看更新说明与安装包。' : status?.local ? '当前为本地测试版，基于正式版 ' + status.baseline + '；' + (status.comparison === null ? '请在 GitHub 核对版本。' : '基准之后暂无新正式版。') : status?.comparison === 0 ? '当前 UI 已是最新正式版。' : status?.comparison < 0 ? '当前 UI 版本高于 GitHub 最新正式版。' : '点击“检查更新”获取 GitHub 最新正式版。')}</p>${latest?.packages.length ? `<p class="version-note">发布包：${escape(latest.packages.join('、'))}。UI 升级包仅更新界面；内核单独更新可上传原作者 ZIP，整套升级使用 GitHub 完整包。</p>` : ''}${metadataError ? `<p class="version-error" role="alert">${escape(metadataError)}</p>` : ''}${limited ? `<p class="version-error" role="alert">GitHub 请求受限，请在 ${escape(date(retryAt))} 后重新检查，也可直接打开 GitHub 发布页；或在「系统管理 → GitHub 访问」填入自己的访问令牌，按账号额度立即恢复。</p>` : error ? `<p class="version-error" role="alert">${escape(error)} 可点击“检查更新”重试，或打开 GitHub 发布页。</p>` : ''}<p class="version-note">自动检查间隔为 6 小时；手动检查会重新请求，限流期间暂停请求。个人令牌在「系统管理 → GitHub 访问」里维护。</p>`);
        dialog.querySelector('#version-release-link').href = latest?.url || REPO + '/releases';
        updater.setRelease(installed, latest);
      }
      async function fetchJSON(url) {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const token = currentToken();
          const response = await assetHttp.fetch(url, {signal: controller.signal, cache: 'no-store', credentials: 'omit', headers: {Accept: 'application/json', ...githubAuthHeaders(url, token)}});
          if (String(url) === ENDPOINT && response.status === 401 && token) {
            // 令牌失效：停止携带，免得每次检查都白打一次请求。
            tokenRejected = true; rejectedFor = token;
            throw new Error('GitHub 拒绝了「系统管理」里保存的访问令牌（401），已暂停使用；请重新填写或清除。');
          }
          if (!response.ok) {
            const denied = String(url) === ENDPOINT && response.status === 403 ? await response.clone().json().catch(() => null) : null;
            if (String(url) === ENDPOINT && (response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit|abuse detection/i.test(denied?.message || '')))) {
              retryAt = releaseRetryAt(response.headers);
              try { preferences.setItem(cooldownKey, retryAt); } catch {}
              waitForRetry();
              throw new Error('GitHub 请求受限，请稍后重试。');
            }
            throw new Error('请求失败（HTTP ' + response.status + '）。');
          }
          return await response.json();
        } finally { clearTimeout(timeout); }
      }
      async function loadInstalled() {
        try {
          const value = await fetchJSON(new URL('version.json', document.baseURI));
          if (!versionParts(value.uiVersion)) throw new Error('当前 UI 版本格式无法识别。');
          installed = value; metadataError = '';
        } catch { metadataError = '当前 UI 版本信息读取失败，请刷新页面后重试。'; }
      }
      function check(force = false) {
        if (pending) return pending;
        readCooldown();
        if (retryAt > Date.now()) { waitForRetry(); paint(); return Promise.resolve(); }
        if (!force && error && Date.now() - lastAttemptAt < 15 * 60 * 1000) return Promise.resolve();
        if (!force && latest && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < TTL) { paint(); return Promise.resolve(); }
        checking = true; error = ''; lastAttemptAt = Date.now(); paint();
        pending = (async () => {
          try {
            if (!installed) await loadInstalled();
            latest = releaseInfo(await fetchJSON(ENDPOINT)); checkedAt = Date.now();
            try { preferences.setItem(cacheKey, JSON.stringify({checkedAt, release: {tag_name: latest.tag,
              assets: latest.assetNames.map(name => ({name}))}})); } catch {}
          } catch (failure) { error = failure.name === 'AbortError' ? '连接 GitHub 超时。' : failure instanceof TypeError || /Failed to fetch|NetworkError/.test(failure.message || '') ? '无法连接 GitHub，请检查网络后重试。' : failure.message || '无法连接 GitHub。'; }
          finally { checking = false; pending = null; paint(); }
        })();
        return pending;
      }
      document.addEventListener('localdns-update-status', event => { runningBackend = event.detail.installedBackend || runningBackend; paint(); });
      button.onclick = () => { paint(); dialog.showModal(); updater.connect(); };
      manual.onclick = () => check(true);
      let backdrop = false;
      dialog.addEventListener('pointerdown', event => { backdrop = event.target === dialog; });
      dialog.addEventListener('click', event => { if (backdrop && event.target === dialog) dialog.close(); backdrop = false; });
      await loadInstalled();
      try {
        const saved = JSON.parse(preferences.getItem(cacheKey) || 'null');
        if (saved && Number.isFinite(saved.checkedAt) && saved.checkedAt <= Date.now()) {
          latest = releaseInfo(saved.release); checkedAt = saved.checkedAt;
        }
      } catch {}
      paint(); check();
      setInterval(() => { if (!document.hidden) check(); }, TTL);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
  }
  return {versionParts, compareVersions, releaseInfo, assess, setup};

})();
export { versionService };
export function initialize() {versionService.setup();}
