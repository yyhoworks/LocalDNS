import { setHTML } from '../../core/security/safe-dom.ts';
import { $, $$, state } from '../../core/context.js';
import { api } from '../../core/api/api.js';
import { esc, num } from '../../shared/format/number.js';
import { icon } from '../../shared/components/icons.js';
import { modalOpen } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { downloadText } from '../../shared/downloads.js';
import { navigate, renderRoute } from '../../core/router/router.js';
import { safeResult } from '../../shared/async.js';
import { loadAliases, openAliasModal, clientAliases } from '../logs/aliases.js';
import { ruleSaveService } from '../rules/save.js';

const IP_OR_CIDR_RE = /^((?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]*:[0-9a-fA-F:.]+)(?:\/\d{1,3})?)(?:\s+#\s*(.*))?$/i;

function parseClientIpLines(rawText) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  let pendingNote = null;
  lines.forEach((rawLine, lineIndex) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      pendingNote = null;
      return;
    }
    const noteMatch = trimmed.match(/^#\s*(?:备注|note)\s*[:：]\s*(.*)$/i);
    if (noteMatch) {
      pendingNote = { lineIndex, text: noteMatch[1].trim() };
      return;
    }
    if (trimmed.startsWith('#')) {
      const body = trimmed.replace(/^#\s*(?:停用原文[:：]\s*)?/, '').trim();
      const disabledMatch = body.match(IP_OR_CIDR_RE);
      if (disabledMatch) {
        entries.push({
          lineIndex,
          noteLineIndex: pendingNote ? pendingNote.lineIndex : null,
          ip: disabledMatch[1].trim(),
          note: (disabledMatch[2] || (pendingNote ? pendingNote.text : '')).trim(),
          enabled: false
        });
      }
      pendingNote = null;
      return;
    }
    const activeMatch = trimmed.match(/^([^\s#]+)(?:\s+#\s*(.*))?$/);
    if (activeMatch) {
      entries.push({
        lineIndex,
        noteLineIndex: pendingNote ? pendingNote.lineIndex : null,
        ip: activeMatch[1].trim(),
        note: (activeMatch[2] || (pendingNote ? pendingNote.text : '')).trim(),
        enabled: true
      });
    }
    pendingNote = null;
  });
  return { lines, entries };
}

function serializeToggleLine(rawText, lineIndex, nextEnabled) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return String(rawText || '');
  const trimmed = lines[lineIndex].trim();
  if (nextEnabled) {
    lines[lineIndex] = trimmed.replace(/^#\s*(?:停用原文[:：]\s*)?/, '');
  } else if (!trimmed.startsWith('#')) {
    lines[lineIndex] = `# 停用原文：${trimmed}`;
  }
  return lines.filter((l, idx) => idx < lines.length - 1 || l.trim()).join('\n');
}

function serializeDeleteLine(rawText, lineIndex, noteLineIndex = null) {
  const lines = String(rawText || '').replace(/\r\n/g, '\n').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return String(rawText || '');
  const indicesToRemove = new Set([lineIndex]);
  if (Number.isInteger(noteLineIndex) && noteLineIndex >= 0 && noteLineIndex < lines.length) {
    indicesToRemove.add(noteLineIndex);
  }
  return lines.filter((_, idx) => !indicesToRemove.has(idx)).join('\n').trim();
}

async function renderDevices(container, context) {
  const renderScope = context.scope;
  const page = container;
  const reqOpt = { signal: renderScope.signal };
  const safe = fn => safeResult(fn);

  const [sw2Res, sw12Res, clientIpRes, clientsRes] = await renderScope.guard(Promise.all([
    safe(() => api.request('/plugins/switch2/show', reqOpt)),
    safe(() => api.request('/plugins/switch12/show', reqOpt)),
    safe(() => api.request('/plugins/client_ip/show?all=1', reqOpt)),
    safe(() => api.rank('client', 200, reqOpt)),
    loadAliases(renderScope)
  ]));

  const sw2 = sw2Res.ok ? String(sw2Res.data || '').trim().toUpperCase() : '?';
  const sw12 = sw12Res.ok ? String(sw12Res.data || '').trim().toUpperCase() : '?';
  const swKnown = (sw2 === 'A' || sw2 === 'B') && (sw12 === 'A' || sw12 === 'B');
  const clientMode = !swKnown ? 'unknown' : sw2 === 'A' ? 'fakeip' : sw12 === 'A' ? 'realip' : 'all';

  const clientIpText = clientIpRes.ok ? String(clientIpRes.data || '').trim() : '';
  const clientIpLoadError = clientIpRes.ok ? null : clientIpRes.error;
  const { entries: controlledEntries } = parseClientIpLines(clientIpText);
  const controlledIpSet = new Set(controlledEntries.map(e => e.ip));

  const observedClients = clientsRes.ok && Array.isArray(clientsRes.data) ? clientsRes.data : [];
  const recordedMap = new Map(observedClients.map(c => [String(c.key), +c.count || 0]));

  const effectivePolicy = entry => {
    if (clientMode === 'fakeip') return entry.enabled ? 'fakeip' : 'realip';
    if (clientMode === 'realip') return entry.enabled ? 'realip' : 'fakeip';
    if (clientMode === 'all') return 'all';
    return 'unknown';
  };

  // 统一设备模型：受控条目 + 未受控活跃 IP 合成一张表
  const aliasOf = ip => clientAliases[ip] || null;
  const devices = [
    ...controlledEntries.map(entry => ({
      kind: 'controlled',
      entry,
      ip: entry.ip,
      alias: aliasOf(entry.ip) || entry.note || '',
      count: recordedMap.get(entry.ip) || 0,
      policy: effectivePolicy(entry)
    })),
    ...[...new Set([
      ...observedClients.map(c => String(c.key)).filter(Boolean),
      ...Object.keys(clientAliases || {})
    ])].filter(ip => !controlledIpSet.has(ip)).map(ip => {
      const isLoopback = ip === '127.0.0.1' || ip === '::1';
      return {
        kind: 'active',
        entry: null,
        ip,
        alias: aliasOf(ip) || (isLoopback ? 'LocalDNS' : ''),
        count: recordedMap.get(ip) || 0,
        policy: 'none',
        isLoopback
      };
    })
  ];
  // 自动收录：把有查询记录但没有别名的活跃 IP 写进别名表，占位名可在行内改
  const AUTO_KEY = 'localdns-devices-auto-collect';
  const autoCollectOn = (() => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; } })();
  if (autoCollectOn && !autoCollecting) {
    const missing = devices.filter(d => d.kind === 'active' && !d.alias && d.count > 0 && !d.isLoopback);
    if (missing.length) {
      autoCollecting = true;
      const next = { ...clientAliases };
      missing.forEach(d => { next[d.ip] = `设备 ${d.ip.split('.').pop()}`; });
      api.json('/plugins/client_name', 'PUT', next)
        .then(() => { renderRoute(true); })
        .catch(error => toast('自动收录设备失败', 'error', error.message))
        .finally(() => { autoCollecting = false; });
    }
  }
  const maxCount = Math.max(1, ...devices.map(d => d.count));
  const counts = { all: devices.length, fakeip: 0, realip: 0, none: 0 };
  devices.forEach(d => {
    if (d.policy === 'fakeip') counts.fakeip++;
    else if (d.policy === 'realip') counts.realip++;
    else if (d.policy === 'none') counts.none++;
  });

  const badgeHtml = d => {
    if (d.policy === 'fakeip') return '<span class="dev-pill is-fakeip">✓ FakeIP 科学分流</span>';
    if (d.policy === 'realip') return '<span class="dev-pill is-realip">→ RealIP 真实解析</span>';
    if (d.policy === 'all') return `<span class="dev-pill is-standby">全员分流${d.entry && !d.entry.enabled ? ' · 已停用' : ''}</span>`;
    if (d.policy === 'none') return '<span class="dev-pill is-none">未受控</span>';
    return '<span class="dev-pill is-none">未知</span>';
  };

  const controlHtml = d => {
    if (d.kind !== 'controlled') {
      if (d.isLoopback) return '<span class="dev-sys-tag">本机系统</span>';
      if (clientIpLoadError) return '<span class="dev-sys-tag">名单加载失败</span>';
      const label = clientMode === 'fakeip' ? '+ 加入 FakeIP 名单' : clientMode === 'realip' ? '+ 加入 RealIP 名单' : '+ 加入名单';
      return `<button type="button" class="dev-join" data-devices-add-ip="${esc(d.ip)}">${label}</button>`;
    }
    const entry = d.entry;
    // 名单加载失败时禁用行内写按钮，避免点击静默无反馈
    const entryBtnAttrs = text => clientIpLoadError
      ? 'disabled title="名单加载失败，暂不可操作"'
      : `title="${text}"`;
    if (clientMode === 'fakeip' || clientMode === 'realip') {
      const fakeNextEnabled = clientMode === 'fakeip' ? '1' : '0';
      const realNextEnabled = clientMode === 'realip' ? '1' : '0';
      return `
        <span class="dev-mseg" role="group" aria-label="单机分流策略 ${esc(entry.ip)}">
          <button type="button" class="${d.policy === 'fakeip' ? 'on' : ''}" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${fakeNextEnabled}" data-devices-target-policy="fakeip" aria-pressed="${d.policy === 'fakeip'}" ${entryBtnAttrs(`让 ${esc(entry.ip)} 走 FakeIP 科学分流`)}>指定 FakeIP</button>
          <button type="button" class="${d.policy === 'realip' ? 'on' : ''}" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${realNextEnabled}" data-devices-target-policy="realip" aria-pressed="${d.policy === 'realip'}" ${entryBtnAttrs(`让 ${esc(entry.ip)} 走 RealIP 真实解析`)}>指定 RealIP</button>
        </span>`;
    }
    return `<button type="button" class="dev-join" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${entry.enabled ? '0' : '1'}" ${clientIpLoadError ? 'disabled title="名单加载失败，暂不可操作"' : ''}>${entry.enabled ? '停用' : '启用'}</button>`;
  };

  const rowHtml = d => {
    const pct = Math.max(4, Math.round(d.count / maxCount * 100));
    const aliasBtn = `<button type="button" class="dev-alias-btn" data-devices-edit-alias title="管理设备别名">${esc(d.alias) || '<span class="dev-noalias">未命名设备</span>'}</button>`;
    return `
    <div class="dev-row${d.kind === 'active' ? ' is-uncontrolled' : ''}" data-ip="${esc(d.ip)}" data-q="${esc((d.alias + d.ip).toLowerCase())}" data-policy="${d.policy}" data-req="${d.count}">
      <div><input type="checkbox" class="dev-ck" data-devices-ck="${esc(d.ip)}" aria-label="选择 ${esc(d.ip)}"></div>
      <div class="dev-main">
        <div class="dev-alias">${aliasBtn}${d.kind === 'controlled' ? '<span class="dev-tag">受控</span>' : ''}</div>
        <button type="button" class="dev-ip" data-devices-log-ip="${esc(d.ip)}" title="查看 ${esc(d.ip)} 的查询日志">${esc(d.ip)}</button>
      </div>
      <div>${badgeHtml(d)}</div>
      <div class="dev-actcol"><div class="dev-bar"><i style="width:${pct}%"></i></div><div class="dev-num"><span class="mono">${num(d.count)}</span> 次</div></div>
      <div>${controlHtml(d)}</div>
      <div class="dev-ops">
        <button type="button" class="dev-iconbtn" data-devices-edit-alias title="管理设备别名">${icon('edit')}</button>
        <button type="button" class="dev-iconbtn" data-devices-menu="${esc(d.ip)}" title="更多操作">${icon('more')}</button>
      </div>
    </div>`;
  };

  setHTML(page, `
  <div class="devices-dark">
    <div class="dev-topbar">
      <div>
        <h1>设备</h1>
        <p class="dev-sub">内网客户端分流策略 · 别名与受控名单</p>
      </div>
      <div class="dev-modebox">
        <span class="dev-mode-label">全局客户端策略</span>
        <div class="dev-seg" role="group" aria-label="客户端分流策略">
          <button type="button" class="${clientMode === 'all' ? 'on' : ''}" data-devices-mode="all" ${clientMode === 'unknown' ? 'disabled' : ''}>全员分流</button>
          <button type="button" class="${clientMode === 'fakeip' ? 'on' : ''}" data-devices-mode="fakeip" ${clientMode === 'unknown' ? 'disabled' : ''}>指定 FakeIP</button>
          <button type="button" class="${clientMode === 'realip' ? 'on' : ''}" data-devices-mode="realip" ${clientMode === 'unknown' ? 'disabled' : ''}>指定 RealIP</button>
        </div>
      </div>
    </div>

    <div class="dev-stats">
      <div class="dev-stat"><div><div class="dev-stat-k">设备总数</div><div class="dev-stat-v">${counts.all}</div><div class="dev-stat-d">受控 ${controlledEntries.length} · 未受控 ${counts.none}</div></div><div class="dev-stat-ic">⧉</div></div>
      <div class="dev-stat"><div><div class="dev-stat-k">FakeIP 科学分流</div><div class="dev-stat-v is-green">${counts.fakeip}</div><div class="dev-stat-d">指定客户端</div></div><div class="dev-stat-ic is-green">✓</div></div>
      <div class="dev-stat"><div><div class="dev-stat-k">RealIP 真实解析</div><div class="dev-stat-v is-amber">${counts.realip}</div><div class="dev-stat-d">指定客户端 · 直连优先</div></div><div class="dev-stat-ic is-amber">→</div></div>
      <div class="dev-stat"><div><div class="dev-stat-k">未受控</div><div class="dev-stat-v is-gray">${counts.none}</div><div class="dev-stat-d">跟随全局默认</div></div><div class="dev-stat-ic">○</div></div>
    </div>

    <div class="dev-filterbar">
      <div class="dev-ftabs" id="devices-ftabs" role="group" aria-label="按策略过滤">
        <button type="button" class="${devView.filter === 'all' ? 'on' : ''}" data-devices-filter="all">全部设备 <span class="n">${counts.all}</span></button>
        <button type="button" class="${devView.filter === 'fakeip' ? 'on' : ''}" data-devices-filter="fakeip">FakeIP 科学分流 <span class="n">${counts.fakeip}</span></button>
        <button type="button" class="${devView.filter === 'realip' ? 'on' : ''}" data-devices-filter="realip">RealIP 真实解析 <span class="n">${counts.realip}</span></button>
        <button type="button" class="${devView.filter === 'none' ? 'on' : ''}" data-devices-filter="none">未受控 <span class="n">${counts.none}</span></button>
      </div>
      <div class="dev-search">
        <div class="dev-searchbox"><input type="text" id="devices-q" placeholder="搜索别名、IP…" autocomplete="off" value="${esc(devView.q)}"></div>
        <button type="button" class="dev-sortbtn" id="devices-sort">${icon('chevron')} ${devView.sort === 'req' ? '请求数 ↓' : 'IP 地址 ↑'}</button>
      
        <button type="button" class="dev-sortbtn" id="devices-bulk-alias" title="批量修改别名，或给还没出现过的 IP 预置名称">批量别名</button>
        <button type="button" class="dev-sortbtn" id="devices-auto-collect" aria-pressed="${autoCollectOn}" title="自动把有查询记录但没有别名的活跃 IP 写进别名表">自动收录 ${autoCollectOn ? '开' : '关'}</button>
        <button type="button" class="dev-addbtn" id="devices-add-controlled" ${clientIpLoadError ? 'disabled title="名单加载失败，暂不可操作"' : ''}>+ 新增受控 IP</button>
      </div>
    </div>

    ${clientIpLoadError ? `<div class="dev-errpanel"><strong>受控客户端 IP 名单读取失败</strong><p>${esc(clientIpLoadError.message)}</p></div>` : ''}

    <div class="dev-table">
      <div class="dev-thead">
        <div><input type="checkbox" class="dev-ck" id="devices-ck-all" aria-label="全选"></div>
        <div>设备</div><div>生效策略</div><div class="dev-col-act">活跃度</div><div class="dev-col-ctl">单机策略</div>
        <div class="dev-col-ops"></div>
      </div>
      <div id="devices-rows">${devices.map(rowHtml).join('') || '<div class="dev-empty">暂无设备记录</div>'}</div>
      <div class="dev-empty" id="devices-empty-filter" hidden>无匹配设备，试试更换关键词或 <button type="button" class="dev-linkbtn" id="devices-clear-filter">清除筛选</button></div>
    </div>
    <div class="dev-batchbar" id="devices-batchbar">
      <span id="devices-batch-n">已选 0 台</span>
      <button type="button" data-devices-batch="fakeip">设为 FakeIP</button>
      <button type="button" data-devices-batch="realip">设为 RealIP</button>
      <button type="button" data-devices-batch="rm">移出名单</button>
      <button type="button" data-devices-batch="cancel">取消</button>
    </div>
  </div>`);

  // ---- 视图状态：过滤 / 搜索 / 排序（状态在模块级 devView，多次渲染之间保留；纯 DOM，不触发重渲染） ----
  const applyView = () => {
    const q = (devView.q || '').toLowerCase();
    const rows = [...$$('.dev-row', page)];
    rows.forEach(r => {
      const hitQ = !q || r.dataset.q.includes(q);
      const hitF = devView.filter === 'all' || r.dataset.policy === devView.filter;
      r.style.display = hitQ && hitF ? '' : 'none';
    });
    const body = $('#devices-rows', page);
    const visible = rows.filter(r => r.style.display !== 'none');
    visible
      .sort((a, b) => devView.sort === 'req' ? (+b.dataset.req - +a.dataset.req) : a.dataset.ip.localeCompare(b.dataset.ip))
      .forEach(r => body.appendChild(r));
    const emptyFilter = $('#devices-empty-filter', page);
    if (emptyFilter) emptyFilter.hidden = rows.length === 0 || visible.length > 0;
    syncBatchUI();
  };
  $('#devices-ftabs', page).addEventListener('click', e => {
    const b = e.target.closest('[data-devices-filter]');
    if (!b) return;
    $$('#devices-ftabs [data-devices-filter]', page).forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    devView.filter = b.dataset.devicesFilter;
    applyView();
  });
  const qInput = $('#devices-q', page);
  qInput.addEventListener('input', () => { devView.q = qInput.value; applyView(); });
  $('#devices-sort', page).onclick = function () {
    devView.sort = devView.sort === 'req' ? 'ip' : 'req';
    this.innerHTML = `${icon('chevron')} ${devView.sort === 'req' ? '请求数 ↓' : 'IP 地址 ↑'}`;
    applyView();
  };
  const clearFilterBtn = $('#devices-clear-filter', page);
  if (clearFilterBtn) clearFilterBtn.onclick = () => {
    devView.q = '';
    devView.filter = 'all';
    qInput.value = '';
    $$('#devices-ftabs [data-devices-filter]', page).forEach(x => x.classList.toggle('on', x.dataset.devicesFilter === 'all'));
    applyView();
  };

  // ---- 批量选择 ----
  const devSel = new Set();
  const syncBatchUI = () => {
    $$('[data-devices-ck]', page).forEach(checkbox => { checkbox.checked = devSel.has(checkbox.dataset.devicesCk); });
    const bar = $('#devices-batchbar', page);
    bar.classList.toggle('show', devSel.size > 0);
    $('#devices-batch-n', page).textContent = `已选 ${devSel.size} 台`;
    const visible = [...$$('.dev-row', page)].filter(r => r.style.display !== 'none').map(r => r.dataset.ip);
    const all = $('#devices-ck-all', page);
    if (all) all.checked = visible.length > 0 && visible.every(ip => devSel.has(ip));
  };
  $('#devices-ck-all', page).onchange = function () {
    [...$$('.dev-row', page)].filter(r => r.style.display !== 'none').forEach(r => {
      this.checked ? devSel.add(r.dataset.ip) : devSel.delete(r.dataset.ip);
    });
    applyView();
  };

  // ---- 后端写入 ----
  const saveClientIpList = async (nextText, successMessage) => {
    await ruleSaveService.save(
      'client_ip',
      nextText,
      clientIpText,
      () => api.request('/plugins/client_ip/show?all=1'),
      values => api.json('/plugins/client_ip/post', 'POST', { values })
    );
    toast(successMessage);
    renderRoute(true, true);
  };
  const doToggleLine = async (entry, nextEnabled, targetPolicy, btn) => {
    if (clientIpLoadError) return;
    if (btn) btn.disabled = true;
    try {
      const nextText = serializeToggleLine(clientIpText, entry.lineIndex, nextEnabled);
      const msg = targetPolicy === 'fakeip'
        ? '已将该设备切换为 FakeIP 科学分流'
        : targetPolicy === 'realip'
          ? '已将该设备切换为 RealIP 真实解析'
          : nextEnabled ? '受控客户端已启用' : '受控客户端已停用';
      await saveClientIpList(nextText, msg);
    } catch (e) {
      if (btn) btn.disabled = false;
      toast('操作失败', 'error', e.message);
    }
  };
  const doDeleteLine = async (entry, btn) => {
    if (clientIpLoadError) return;
    if (btn) btn.disabled = true;
    try {
      const nextText = serializeDeleteLine(clientIpText, entry.lineIndex, entry.noteLineIndex);
      await saveClientIpList(nextText, '已从受控名单移除');
    } catch (e) {
      if (btn) btn.disabled = false;
      toast('移除失败', 'error', e.message);
    }
  };
  const doAddIp = async (ip, btn) => {
    if (clientIpLoadError || !ip) return;
    if (btn) btn.disabled = true;
    try {
      const nextText = clientIpText ? `${clientIpText}\n${ip}` : ip;
      await saveClientIpList(nextText, `已将 ${ip} 加入受控名单`);
    } catch (e) {
      if (btn) btn.disabled = false;
      toast('添加失败', 'error', e.message);
    }
  };
  const goLog = ip => {
    if (!ip) return;
    state.logs.client = ip;
    state.logs.page = 1;
    navigate('logs');
  };

  // 1. 切换客户端分流模式（与概览页保持一致的串行写入 + 回读校验 + 回滚保护）
  let modeGen = 0;
  $$('[data-devices-mode]', page).forEach(btn => {
    btn.onclick = async () => {
      const m = btn.dataset.devicesMode;
      const targets = { all: ['B', 'B'], fakeip: ['A', 'B'], realip: ['B', 'A'] };
      const target = targets[m];
      if (!target || !swKnown) return;
      const gen = ++modeGen;
      const isStale = () => gen !== modeGen;
      const modeBtns = $$('[data-devices-mode]', page);
      modeBtns.forEach(b => { b.disabled = true; });
      const original = [sw2, sw12];
      const postSwitch = (tag, value) => api.json(`/plugins/${tag}/post`, 'POST', { value });
      const readSwitches = async () => {
        const [v2, v12] = await Promise.all([api.request('/plugins/switch2/show'), api.request('/plugins/switch12/show')]);
        return [String(v2 || '').trim().toUpperCase(), String(v12 || '').trim().toUpperCase()];
      };
      try {
        const steps = [{ tag: 'switch2', value: target[0] }, { tag: 'switch12', value: target[1] }]
          .sort((a, b) => (a.value === 'A') - (b.value === 'A'));
        for (const step of steps) { await postSwitch(step.tag, step.value); if (isStale()) return; }
        const actual = await readSwitches();
        if (isStale()) return;
        if (actual[0] !== target[0] || actual[1] !== target[1]) {
          throw new Error(`开关状态与目标不一致（当前 switch2=${actual[0] || '?'}, switch12=${actual[1] || '?'}）`);
        }
        toast(m === 'all' ? '已切换为全员分流模式' : m === 'fakeip' ? '已启用：指定 FakeIP' : '已启用：指定 RealIP');
      } catch (e) {
        if (isStale()) return;
        let note = '请刷新页面确认当前分流状态。';
        try {
          await postSwitch('switch2', original[0]);
          await postSwitch('switch12', original[1]);
          note = '已恢复切换前状态。';
        } catch {}
        if (isStale()) return;
        toast('切换失败', 'error', `${e.message} ${note}`);
      }
      if (isStale()) return;
      modeBtns.forEach(b => { b.disabled = false; });
      renderRoute(true, true);
    };
  });

  // 2. 单条 FakeIP/RealIP 策略切换
  $$('[data-devices-toggle-line]', page).forEach(btn => {
    btn.onclick = () => {
      if (btn.classList.contains('on')) return;
      const entry = controlledEntries.find(e => e.lineIndex === Number(btn.dataset.devicesToggleLine));
      if (!entry) return;
      doToggleLine(entry, btn.dataset.devicesNextEnabled === '1', btn.dataset.devicesTargetPolicy, btn);
    };
  });

  // 3. 从未受控行一键加入受控名单
  $$('[data-devices-add-ip]', page).forEach(btn => {
    btn.onclick = () => doAddIp(btn.dataset.devicesAddIp, btn);
  });

  // 4. 行内多选
  $$('[data-devices-ck]', page).forEach(ck => {
    ck.onchange = () => {
      ck.checked ? devSel.add(ck.dataset.devicesCk) : devSel.delete(ck.dataset.devicesCk);
      syncBatchUI();
    };
  });

  // 5. 批量操作
  $('#devices-batchbar', page).addEventListener('click', async e => {
    const b = e.target.closest('[data-devices-batch]');
    if (!b) return;
    const action = b.dataset.devicesBatch;
    if (action === 'cancel') { devSel.clear(); syncBatchUI(); return; }
    if (clientIpLoadError || devSel.size === 0) return;
    b.disabled = true;
    try {
      let nextText = clientIpText;
      const selControlled = controlledEntries.filter(en => devSel.has(en.ip));
      const selNew = [...devSel].filter(ip => !controlledIpSet.has(ip) && ip !== '127.0.0.1' && ip !== '::1');
      if (action === 'rm') {
        selControlled
          .map(en => ({ li: en.lineIndex, ni: en.noteLineIndex }))
          .sort((x, y) => y.li - x.li)
          .forEach(({ li, ni }) => { nextText = serializeDeleteLine(nextText, li, ni); });
        await saveClientIpList(nextText, `已将 ${selControlled.length} 台移出受控名单`);
      } else {
        const toPolicy = action;
        selControlled.forEach(en => {
          const nextEnabled = clientMode === 'fakeip' ? toPolicy === 'fakeip' : clientMode === 'realip' ? toPolicy === 'realip' : true;
          nextText = serializeToggleLine(nextText, en.lineIndex, nextEnabled);
        });
        if (selNew.length) nextText = nextText ? `${nextText}\n${selNew.join('\n')}` : selNew.join('\n');
        await saveClientIpList(nextText, `已批量更新 ${devSel.size} 台`);
      }
    } catch (err) {
      b.disabled = false;
      toast('批量操作失败', 'error', err.message);
    }
  });

  // 6. 更多菜单：查看日志 / 移入移出名单（fixed 定位挂到 body，避免菜单显示不全）
  let openMenu = null;
  const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  const placeMenu = (m, btn) => {
    const r = btn.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    // 右对齐触发按钮，并钳制在视口内；下方放不下时翻到上方
    let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  };
  const menuCloser = e => {
    if (openMenu && !e.target.closest('.dev-menu') && !e.target.closest('[data-devices-menu]')) closeMenu();
  };
  const menuDismiss = () => closeMenu();
  document.addEventListener('click', menuCloser);
  document.addEventListener('scroll', menuDismiss, true);
  window.addEventListener('resize', menuDismiss);
  renderScope.signal.addEventListener('abort', () => {
    document.removeEventListener('click', menuCloser);
    document.removeEventListener('scroll', menuDismiss, true);
    window.removeEventListener('resize', menuDismiss);
  }, { once: true });
  $$('[data-devices-menu]', page).forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const ip = btn.dataset.devicesMenu;
      const entry = controlledEntries.find(en => en.ip === ip);
      if (openMenu) { closeMenu(); return; }
      const m = document.createElement('div');
      m.className = 'dev-menu';
      m.innerHTML = `<button type="button" data-m="log">查看查询日志</button>` +
        (entry
          ? `<button type="button" data-m="rm" class="danger">移出受控名单</button>`
          : `<button type="button" data-m="join">加入受控名单</button>`);
      document.body.appendChild(m);
      placeMenu(m, btn);
      openMenu = m;
      m.onclick = ev => {
        const b = ev.target.closest('[data-m]');
        if (!b) return;
        const mm = b.dataset.m;
        closeMenu();
        if (mm === 'log') goLog(ip);
        else if (mm === 'rm' && entry) doDeleteLine(entry, null);
        else if (mm === 'join') doAddIp(ip, null);
      };
    };
  });

  // 7. 新增受控 IP 弹窗
    const autoBtn = $('#devices-auto-collect', page);
  if (autoBtn) autoBtn.onclick = () => {
    const on = autoBtn.getAttribute('aria-pressed') !== 'true';
    try { localStorage.setItem('localdns-devices-auto-collect', on ? '1' : '0'); } catch {}
    renderRoute(true);
  };

  const addControlledBtn = $('#devices-add-controlled', page);
  if (addControlledBtn) {
    addControlledBtn.onclick = () => {
      if (clientIpLoadError) {
        toast('名单未成功加载，暂不可编辑', 'error');
        return;
      }
      let mode = 'single';
      modalOpen(
        '受控客户端 IP',
        '逐条添加，或切到原文批量维护整份名单',
        `<div class="stack">
          <div class="dev-modeswitch" role="group" aria-label="编辑方式">
            <button type="button" class="on" data-ipmode="single">逐条添加</button>
            <button type="button" data-ipmode="raw">原文批量</button>
          </div>
          <div id="devices-panel-single">
            <div class="field"><label for="devices-new-ip">客户端 IP / CIDR 网段</label><input id="devices-new-ip" placeholder="例如：192.168.8.50 或 192.168.8.0/24" autocomplete="off"></div>
            <div class="field"><label for="devices-new-note">备注说明（可选）</label><input id="devices-new-note" placeholder="例如：书房电脑" autocomplete="off"></div>
          </div>
          <div id="devices-panel-raw" hidden>
            <div class="field"><label for="devices-raw-textarea">客户端 IP 名单 (/plugins/client_ip)</label><textarea id="devices-raw-textarea" class="rule-textarea" rows="12" spellcheck="false">${esc(clientIpText)}</textarea></div>
            <div><button type="button" class="button small" id="devices-download-raw">${icon('download')}下载 client_ip.txt</button></div>
          </div>
        </div>`,
        async () => {
          if (mode === 'raw') {
            await saveClientIpList($('#devices-raw-textarea').value.trim(), '受控客户端 IP 名单已保存');
            return;
          }
          const ip = $('#devices-new-ip').value.trim();
          const note = $('#devices-new-note').value.trim();
          if (!ip || /\s/.test(ip) || !IP_OR_CIDR_RE.test(ip)) throw new Error('请输入有效的客户端 IP 或 CIDR 网段');
          const block = note ? `# 备注：${note}\n${ip}` : ip;
          await saveClientIpList(clientIpText ? `${clientIpText}\n${block}` : block, `已添加受控客户端 ${ip}`);
        }
      );
      $$('[data-ipmode]').forEach(button => {
        button.onclick = () => {
          mode = button.dataset.ipmode;
          $$('[data-ipmode]').forEach(other => other.classList.toggle('on', other === button));
          const single = $('#devices-panel-single'), raw = $('#devices-panel-raw');
          if (single) single.hidden = mode !== 'single';
          if (raw) raw.hidden = mode !== 'raw';
        };
      });
      const dl = $('#devices-download-raw');
      if (dl) dl.onclick = () => downloadText('client_ip.txt', $('#devices-raw-textarea').value);
    };
  }
// 9. 别名管理弹窗
  $$('[data-devices-edit-alias]', page).forEach(btn => {
    btn.onclick = () => {
      const ip = btn.closest('[data-ip]')?.dataset.ip;
      if (!ip) return;
      modalOpen(
        '设备别名',
        ip,
        `<div class="stack"><div class="field"><label for="devices-alias-name">设备别名</label><input id="devices-alias-name" value="${esc(clientAliases[ip] || '')}" placeholder="例如：书房电脑" autocomplete="off"></div></div>`,
        async () => {
          const name = $('#devices-alias-name').value.trim();
          const next = { ...clientAliases };
          if (name) next[ip] = name; else delete next[ip];
          await api.json('/plugins/client_name', 'PUT', next);
          toast(name ? `已更新 ${ip} 的别名` : `已清除 ${ip} 的别名`);
          renderRoute(true);
        }
      );
    };
  });
  const bulkAliasBtn = $('#devices-bulk-alias', page);
  if (bulkAliasBtn) bulkAliasBtn.onclick = openAliasModal;

  applyView();
}

let autoCollecting = false;
// 视图状态（模块级）：过滤 / 排序 / 关键词，在多次渲染之间保留（写操作后的静默重渲染会重置 render 闭包变量）
const devView = { filter: 'all', sort: 'req', q: '' };
export { renderDevices };
