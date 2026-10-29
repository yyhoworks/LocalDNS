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
  const allActiveIps = [...new Set([
    ...observedClients.map(c => String(c.key)).filter(Boolean),
    ...Object.keys(clientAliases || {}),
    ...controlledEntries.map(e => e.ip)
  ])];

  const effectivePolicy = entry => {
    if (clientMode === 'fakeip') return entry.enabled ? 'fakeip' : 'realip';
    if (clientMode === 'realip') return entry.enabled ? 'realip' : 'fakeip';
    if (clientMode === 'all') return 'all';
    return 'unknown';
  };

  const strategyBadgeHtml = entry => {
    const policy = effectivePolicy(entry);
    if (policy === 'fakeip') {
      return '<span class="devices-badge is-fakeip">✓ FakeIP 科学分流</span>';
    }
    if (policy === 'realip') {
      return '<span class="devices-badge is-realip">→ RealIP 真实解析</span>';
    }
    if (policy === 'all') {
      return `<span class="devices-badge is-standby">全员分流中（名单${entry.enabled ? '待命' : '停用'}）</span>`;
    }
    return '<span class="devices-badge is-muted">策略状态未知</span>';
  };

  const rowControlHtml = entry => {
    const policy = effectivePolicy(entry);
    if (clientMode === 'fakeip' || clientMode === 'realip') {
      const fakeNextEnabled = clientMode === 'fakeip' ? '1' : '0';
      const realNextEnabled = clientMode === 'realip' ? '1' : '0';
      return `
        <div class="seg-group devices-inline-seg" role="group" aria-label="单机分流策略 ${esc(entry.ip)}">
          <button type="button" class="seg-item ${policy === 'fakeip' ? 'active' : ''}" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${fakeNextEnabled}" data-devices-target-policy="fakeip" ${policy === 'fakeip' ? 'aria-pressed="true"' : 'aria-pressed="false"'} title="让 ${esc(entry.ip)} 走 FakeIP 科学分流">FakeIP</button>
          <button type="button" class="seg-item ${policy === 'realip' ? 'active' : ''}" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${realNextEnabled}" data-devices-target-policy="realip" ${policy === 'realip' ? 'aria-pressed="true"' : 'aria-pressed="false"'} title="让 ${esc(entry.ip)} 强制返回 RealIP 真实解析">RealIP</button>
        </div>
      `;
    }
    return `<button type="button" class="button small" data-devices-toggle-line="${entry.lineIndex}" data-devices-next-enabled="${entry.enabled ? '0' : '1'}">${entry.enabled ? '停用' : '启用'}</button>`;
  };

  setHTML(page, `
    <div class="view-title-row">
      <div>
        <h1>设备与客户端策略</h1>
        <span class="gc-sub">统一管理内网客户端设备别名、全局/单机分流模式（全员分流 / 指定 FakeIP / 指定 RealIP）及设备查询活跃度</span>
      </div>
      <div class="devices-header-actions">
        <button type="button" class="glass-btn" id="devices-open-alias-modal">管理全部别名</button>
        <button type="button" class="glass-btn" data-route="overview">← 返回概览</button>
      </div>
    </div>

    <div class="col-6 devices-col">
      <section class="glass-card devices-card">
        <header class="gc-head">
          <div>
            <h2 class="gc-title">1. 客户端分流模式与受控设备名单</h2>
            <p class="workspace-subline">模式切换与受控客户端 IP 同屏配置，所见即所得</p>
          </div>
          <div class="devices-card-tools">
            <button type="button" class="button small" id="devices-add-controlled">${icon('plus')}新增受控 IP</button>
            <button type="button" class="button small" id="devices-edit-raw">原文编辑</button>
          </div>
        </header>

        <div class="devices-mode-banner">
          <div class="devices-mode-label">
            <strong>当前全局客户端策略：</strong>
            <small>${
              clientMode === 'fakeip'
                ? '下方每台设备可直接切换「FakeIP / RealIP」；未列入名单的其它内网设备默认走 RealIP 真实解析'
                : clientMode === 'realip'
                  ? '下方每台设备可直接切换「FakeIP / RealIP」；未列入名单的其它内网设备默认走 FakeIP 科学分流'
                  : clientMode === 'all'
                    ? '局域网所有设备默认按分流规则正常解析，下方受控名单保留待命'
                    : '分流开关状态读取失败，暂不可切换'
            }</small>
          </div>
          <div class="seg-group" role="group" aria-label="客户端分流策略">
            <button type="button" class="seg-item ${clientMode === 'all' ? 'active' : ''}" data-devices-mode="all" ${clientMode === 'unknown' ? 'disabled' : ''}>全员分流</button>
            <button type="button" class="seg-item ${clientMode === 'fakeip' ? 'active' : ''}" data-devices-mode="fakeip" ${clientMode === 'unknown' ? 'disabled' : ''}>指定 FakeIP</button>
            <button type="button" class="seg-item ${clientMode === 'realip' ? 'active' : ''}" data-devices-mode="realip" ${clientMode === 'unknown' ? 'disabled' : ''}>指定 RealIP</button>
          </div>
        </div>

        ${clientIpLoadError ? `
          <div class="error-panel">
            <strong>受控客户端 IP 名单读取失败</strong>
            <p>${esc(clientIpLoadError.message)}</p>
          </div>
        ` : `
          <div class="table-wrap devices-table-wrap">
            <table class="devices-table">
              <thead>
                <tr>
                  <th>客户端 IP / 网段</th>
                  <th>设备别名</th>
                  <th>当前生效策略</th>
                  <th>单机策略与操作</th>
                </tr>
              </thead>
              <tbody>
                ${controlledEntries.length ? controlledEntries.map(entry => {
                  const alias = clientAliases[entry.ip] || entry.note || '—';
                  return `
                    <tr class="${clientMode === 'all' && !entry.enabled ? 'is-disabled' : ''}">
                      <td class="mono"><button type="button" class="workspace-text-button mono" data-devices-log-ip="${esc(entry.ip)}">${esc(entry.ip)}</button></td>
                      <td>${esc(alias)}</td>
                      <td>${strategyBadgeHtml(entry)}</td>
                      <td>
                        <div class="devices-row-actions">
                          ${rowControlHtml(entry)}
                          <button type="button" class="button small danger" data-devices-delete-line="${entry.lineIndex}" data-devices-note-line="${entry.noteLineIndex ?? ''}" aria-label="移出受控名单 ${esc(entry.ip)}">移除</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('') : `
                  <tr>
                    <td colspan="4" class="table-empty">受控客户端名单为空 · 可从右侧活跃设备一键加入或点击右上角“新增受控 IP”</td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        `}
      </section>
    </div>

    <div class="col-6 devices-col">
      <section class="glass-card devices-card">
        <header class="gc-head">
          <div>
            <h2 class="gc-title">2. 局域网活跃设备与别名映射</h2>
            <p class="workspace-subline">在此设置的设备别名将在「概览」「日志」「解析路径」全站生效</p>
          </div>
          <div class="devices-card-tools">
            <button type="button" class="button small" id="devices-alias-btn">批量编辑别名</button>
          </div>
        </header>

        <div class="table-wrap devices-table-wrap">
          <table class="devices-table">
            <thead>
              <tr>
                <th>客户端 IP</th>
                <th>设备别名</th>
                <th>累计请求</th>
                <th>快捷操作</th>
              </tr>
            </thead>
            <tbody>
              ${allActiveIps.length ? allActiveIps.map(ip => {
                const isLoopback = ip === '127.0.0.1' || ip === '::1';
                const alias = clientAliases[ip] || (isLoopback ? 'LocalDNS' : '—');
                const count = recordedMap.get(ip);
                const inControlled = controlledIpSet.has(ip);
                const addLabel = clientMode === 'fakeip' ? '+ 加入 FakeIP 名单' : clientMode === 'realip' ? '+ 加入 RealIP 名单' : '+ 加入受控名单';
                return `
                  <tr>
                    <td class="mono"><button type="button" class="workspace-text-button mono" data-devices-log-ip="${esc(ip)}" title="查看 ${esc(ip)} 的查询日志">${esc(ip)}</button></td>
                    <td><button type="button" class="workspace-text-button" data-devices-edit-alias title="点击设置或修改设备别名"><strong>${esc(alias)}</strong></button></td>
                    <td class="mono">${count ? `${num(count)} 次` : '—'}</td>
                    <td>
                      <div class="devices-row-actions">
                        ${isLoopback
                          ? '<span class="devices-status-tag">本机系统</span>'
                          : inControlled
                            ? '<span class="devices-status-tag">已在受控名单</span>'
                            : `<button type="button" class="button small" data-devices-add-ip="${esc(ip)}" ${clientIpLoadError ? 'disabled' : ''}>${addLabel}</button>`
                        }
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="4" class="table-empty">暂无活跃客户端记录</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `);

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

  // 2. 保存受控客户端名单方法（走 ruleSaveService 并发保护）
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

  // 3. 单条 FakeIP/RealIP 策略切换或启停与移除
  $$('[data-devices-toggle-line]', page).forEach(btn => {
    btn.onclick = async () => {
      if (clientIpLoadError || btn.classList.contains('active')) return;
      const lineIndex = Number(btn.dataset.devicesToggleLine);
      const nextEnabled = btn.dataset.devicesNextEnabled === '1';
      const targetPolicy = btn.dataset.devicesTargetPolicy;
      btn.disabled = true;
      try {
        const nextText = serializeToggleLine(clientIpText, lineIndex, nextEnabled);
        const msg = targetPolicy === 'fakeip'
          ? '已将该设备切换为 FakeIP 科学分流'
          : targetPolicy === 'realip'
            ? '已将该设备切换为 RealIP 真实解析'
            : nextEnabled ? '受控客户端已启用' : '受控客户端已停用';
        await saveClientIpList(nextText, msg);
      } catch (e) {
        btn.disabled = false;
        toast('操作失败', 'error', e.message);
      }
    };
  });

  $$('[data-devices-delete-line]', page).forEach(btn => {
    btn.onclick = async () => {
      if (clientIpLoadError) return;
      const lineIndex = Number(btn.dataset.devicesDeleteLine);
      const noteLineAttr = btn.dataset.devicesNoteLine;
      const noteLineIndex = noteLineAttr !== undefined && noteLineAttr !== '' ? Number(noteLineAttr) : null;
      btn.disabled = true;
      try {
        const nextText = serializeDeleteLine(clientIpText, lineIndex, noteLineIndex);
        await saveClientIpList(nextText, '已从受控名单移除');
      } catch (e) {
        btn.disabled = false;
        toast('移除失败', 'error', e.message);
      }
    };
  });

  // 4. 从右侧活跃设备一键加入受控名单
  $$('[data-devices-add-ip]', page).forEach(btn => {
    btn.onclick = async () => {
      if (clientIpLoadError) return;
      const ip = btn.dataset.devicesAddIp;
      if (!ip) return;
      btn.disabled = true;
      try {
        const nextText = clientIpText ? `${clientIpText}\n${ip}` : ip;
        await saveClientIpList(nextText, `已将 ${ip} 加入受控名单`);
      } catch (e) {
        btn.disabled = false;
        toast('添加失败', 'error', e.message);
      }
    };
  });

  // 5. 新增受控 IP 弹窗
  const addControlledBtn = $('#devices-add-controlled', page);
  if (addControlledBtn) {
    addControlledBtn.onclick = () => {
      if (clientIpLoadError) {
        toast('名单未成功加载，暂不可新增', 'error');
        return;
      }
      modalOpen(
        '新增受控客户端 IP / 网段',
        '支持 IPv4、IPv6 或 CIDR 网段（如 192.168.1.10 或 192.168.1.0/24）',
        `<div class="stack">
          <div class="field"><label for="devices-new-ip">客户端 IP / CIDR 网段</label><input id="devices-new-ip" placeholder="例如：192.168.1.50 或 192.168.1.0/24" autocomplete="off"></div>
          <div class="field"><label for="devices-new-note">备注说明（可选）</label><input id="devices-new-note" placeholder="例如：书房电脑" autocomplete="off"></div>
        </div>`,
        async () => {
          const ip = $('#devices-new-ip').value.trim();
          const note = $('#devices-new-note').value.trim();
          if (!ip || /\s/.test(ip) || !IP_OR_CIDR_RE.test(ip)) throw new Error('请输入有效的客户端 IP 或 CIDR 网段');
          const block = note ? `# 备注：${note}\n${ip}` : ip;
          const nextText = clientIpText ? `${clientIpText}\n${block}` : block;
          await saveClientIpList(nextText, `已添加受控客户端 ${ip}`);
        }
      );
    };
  }

  // 6. 原文编辑弹窗（支持批量粘贴与导出下载）
  const editRawBtn = $('#devices-edit-raw', page);
  if (editRawBtn) {
    editRawBtn.onclick = () => {
      if (clientIpLoadError) {
        toast('名单未成功加载，暂不可编辑', 'error');
        return;
      }
      modalOpen(
        '编辑受控客户端 IP 名单原文',
        '一行一条客户端 IP 或 CIDR 网段，以 # 开头表示停用或注释',
        `<div class="stack">
          <div class="field">
            <label for="devices-raw-textarea">客户端 IP 名单 (/plugins/client_ip)</label>
            <textarea id="devices-raw-textarea" class="rule-textarea" rows="12" spellcheck="false">${esc(clientIpText)}</textarea>
          </div>
          <div><button type="button" class="button small" id="devices-download-raw">${icon('download')}下载 client_ip.txt</button></div>
        </div>`,
        async () => {
          const nextText = $('#devices-raw-textarea').value.trim();
          await saveClientIpList(nextText, '受控客户端 IP 名单已保存');
        }
      );
      const dlBtn = $('#devices-download-raw');
      if (dlBtn) dlBtn.onclick = () => downloadText('client_ip.txt', $('#devices-raw-textarea').value);
    };
  }

  // 7. 别名管理弹窗与点击 IP 跳转查询日志
  if ($('#devices-open-alias-modal', page)) $('#devices-open-alias-modal', page).onclick = openAliasModal;
  if ($('#devices-alias-btn', page)) $('#devices-alias-btn', page).onclick = openAliasModal;
  $$('[data-devices-edit-alias]', page).forEach(btn => { btn.onclick = openAliasModal; });

  $$('[data-devices-log-ip]', page).forEach(btn => {
    btn.onclick = () => {
      const ip = btn.dataset.devicesLogIp;
      if (ip) {
        state.logs.client = ip;
        state.logs.page = 1;
        navigate('logs');
      }
    };
  });
}

export { renderDevices };
