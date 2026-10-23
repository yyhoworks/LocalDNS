import { setHTML } from '../../core/security/safe-dom.ts';
const clientsService = (() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const own = (map, key) => Object.hasOwn(map, key);

  function aliases(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) {
      throw new Error('客户端别名读取不完整，暂时无法保存。请关闭后重试。');
    }
    return {...value};
  }

  function normalizeIP(value) {
    const text = String(value || '').trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(text)) {
      const parts = text.split('.');
      if (parts.every(part => +part <= 255 && String(+part) === part)) return text;
    } else if (text.includes(':') && /^[0-9a-f:.]+$/i.test(text)) {
      try { return new URL('http://[' + text + ']/').hostname.slice(1, -1); } catch {}
    }
    throw new Error('请输入有效的 IPv4 或 IPv6 地址。');
  }

  function mergeEdits(baseline, latest, edits) {
    const next = aliases(latest);
    for (const [ip, name] of edits) {
      if (own(latest, ip) !== own(baseline, ip) || latest[ip] !== baseline[ip]) {
        throw new Error(ip + ' 的别名已被其他设备修改。请关闭后重新打开，避免覆盖新内容。');
      }
      if (name === null || !name.trim()) delete next[ip];
      else Object.defineProperty(next, ip, {value:name.trim(), enumerable:true, writable:true, configurable:true});
    }
    return next;
  }

  function topology(clients, names, total, compact = String) {
    const observed = (Array.isArray(clients) ? clients : []).filter(c => typeof c.key === 'string' && Number.isFinite(+c.count) && +c.count > 0);
    // 百分比口径统一为「当前保留记录」窗口：分子来自 rank('client')（本文件
    // 别名弹窗与慢查询面板均按此口径标注）。调用方传入的 total 是 audit
    // stats 的 total_queries，前端无法确证它与 rank 的保留窗口一致（状态
    // 胶囊处将其标为「累计」），混用会让各节点百分比之和系统性偏离 100%。
    // 改用同一份 rank 数据的计数之和作分母，百分比恒为同窗口内占比；
    // observed 为空时才回退到 total。
    const observedTotal = observed.reduce((sum, c) => sum + +c.count, 0);
    const denominator = Math.max(1, observedTotal || +total || 0);
    const result = observed.slice(0, 4).map((client, i) => ({
      id:'c' + (i + 1), ip:client.key, muted:false, name:names[client.key] || client.key,
      sub:client.key + ' · ' + compact(client.count) + ' 次', val:Math.round(+client.count / denominator * 100) + '%',
      valColor:i === 0 ? '#93C5FD' : 'var(--text-1)', icon:'monitor'
    }));
    const rest = observed.slice(4), count = rest.reduce((sum, c) => sum + +c.count, 0);
    if (rest.length) result.push({id:'c5',ip:'',muted:false,name:'其余 ' + rest.length + ' 个来源',sub:'查询来源汇总 · ' + compact(count) + ' 次',val:Math.round(count / denominator * 100) + '%',valColor:'var(--text-2)',icon:'dots'});
    if (!result.length) result.push({id:'c_empty',ip:'',muted:true,name:'暂无客户端请求',sub:'当前保留记录中没有查询来源',val:'暂无记录',valColor:'var(--text-3)',icon:'monitor'});
    return result;
  }

  async function open({request, rank, modal, notify, onSaved}) {
    const baseline = aliases(await request('/plugins/client_name'));
    let observed = [], rankUnavailable = false;
    try { const value = await rank('client', 200); if (!Array.isArray(value)) throw new Error(); observed = value; }
    catch { rankUnavailable = true; }
    const recorded = new Map(observed.map(c => [String(c.key), +c.count || 0]));
    const rows = new Map([...recorded.keys(), ...Object.keys(baseline)].map(ip => [ip, {ip, name:baseline[ip] || '', removed:false}]));
    const edits = new Map();
    let host, busy = false;
    const current = () => [...rows.values()].filter(row => !row.removed);
    const html = '<div class="client-manager"><p class="client-manager-note">名称保存在服务器，其他设备刷新后可见。移除别名只清除名称，不删除查询记录或改变设备联网。</p>' + (rankUnavailable ? '<p class="client-manager-note">查询来源暂时不可用，已保存的别名仍可管理。</p>' : '') + '<div class="client-manager-toolbar"><label class="field">搜索 IP 或别名<input type="search" id="client-alias-search" autocomplete="off"></label><span id="client-alias-count"></span></div><div id="client-alias-list" class="client-alias-list"></div><div class="client-alias-add"><label class="field">客户端 IP<input id="client-alias-new-ip" placeholder="192.168.1.100 或 IPv6" autocomplete="off"></label><label class="field">别名<input id="client-alias-new-name" maxlength="100" placeholder="例如：书房电脑" autocomplete="off"></label><button type="button" class="glass-btn" id="client-alias-add">添加</button></div><p id="client-alias-feedback" class="client-manager-note" role="status" aria-live="polite">更改后点击下方“保存”；取消不会写入服务器。</p></div>';

    function feedback(text) { host.querySelector('#client-alias-feedback').textContent = text; }
    function updateCount() { host.querySelector('#client-alias-count').textContent = current().length + ' 个来源 · ' + edits.size + ' 项待保存'; }
    function setEdit(row, value) {
      if (value === baseline[row.ip] || (value === null && !own(baseline, row.ip))) edits.delete(row.ip);
      else edits.set(row.ip, value);
      updateCount();
    }
    function renderList() {
      const query = host.querySelector('#client-alias-search').value.trim().toLowerCase();
      const visible = current().filter(row => (row.ip + ' ' + row.name).toLowerCase().includes(query));
      setHTML(host.querySelector('#client-alias-list'), visible.map((row, i) => '<div class="client-alias-row"><div class="client-alias-identity"><strong>' + esc(row.ip) + '</strong><small>' + (recorded.has(row.ip) ? recorded.get(row.ip).toLocaleString('zh-CN') + ' 次查询 · 当前保留记录' : own(baseline, row.ip) ? '已保存别名 · 当前保留记录中未出现' : '新增别名 · 尚未保存') + '</small></div><label class="field"><span class="client-alias-label">设备别名</span><input data-client-name="' + esc(row.ip) + '" aria-label="' + esc(row.ip) + ' 的别名" value="' + esc(row.name) + '" maxlength="100" autocomplete="off"></label><button type="button" class="glass-btn client-alias-remove" data-client-remove="' + esc(row.ip) + '" aria-label="移除 ' + esc(row.ip) + ' 的别名" ' + (!row.name ? 'disabled' : '') + '>移除别名</button></div>').join('') || '<p class="client-manager-note">没有匹配的来源或别名。</p>');
      updateCount();
    }

    modal('客户端管理', '全部已保存别名与最近最多 200 个查询来源', html, async () => {
      if (busy || !host.isConnected || !host.closest('dialog')?.open) throw new Error('窗口已关闭，请重新打开客户端管理。');
      if (host.querySelector('#client-alias-new-ip').value.trim() || host.querySelector('#client-alias-new-name').value.trim()) throw new Error('新增项尚未添加，请先点击“添加”或清空输入。');
      if (!edits.size) return;
      busy = true;
      const submitted = new Map(edits), controls = [...host.querySelectorAll('input,button')].map(el => [el, el.disabled]);
      controls.forEach(([el]) => {el.disabled = true;});
      try {
        const latest = aliases(await request('/plugins/client_name'));
        const next = mergeEdits(baseline, latest, submitted);
        if (!host.isConnected || !host.closest('dialog')?.open) throw new Error('窗口已关闭，未提交更改。');
        await request('/plugins/client_name', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
        onSaved(next); notify('客户端别名已保存到服务器');
      } finally { busy = false; controls.forEach(([el, disabled]) => {el.disabled = disabled;}); }
    });
    host = document.querySelector('#modal-content .client-manager');
    host.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
      event.preventDefault();
      if (['client-alias-new-ip','client-alias-new-name'].includes(event.target.id)) host.querySelector('#client-alias-add').click();
    });
    host.querySelector('#client-alias-search').oninput = renderList;
    host.querySelector('#client-alias-list').oninput = event => {
      const ip = event.target.dataset.clientName; if (!ip || busy) return;
      const row = rows.get(ip); row.name = event.target.value; setEdit(row, row.name.trim() || null);
      event.target.closest('.client-alias-row').querySelector('[data-client-remove]').disabled = !row.name.trim();
    };
    host.querySelector('#client-alias-list').onclick = event => {
      const button = event.target.closest('[data-client-remove]'); if (!button || busy) return;
      const row = rows.get(button.dataset.clientRemove); row.name = ''; row.removed = !recorded.has(row.ip); setEdit(row, null); renderList();
      feedback(row.ip + ' 的别名已标记移除，点击“保存”后生效；取消可放弃。');
    };
    host.querySelector('#client-alias-add').onclick = () => {
      if (busy) return;
      const ipInput = host.querySelector('#client-alias-new-ip'), nameInput = host.querySelector('#client-alias-new-name');
      try {
        const ip = normalizeIP(ipInput.value), name = nameInput.value.trim();
        if (!name) throw new Error('请输入设备别名。');
        const duplicate = [...rows.values()].find(row => {try {return normalizeIP(row.ip) === ip && !row.removed;} catch {return row.ip === ip && !row.removed;}});
        if (duplicate) throw new Error('这个 IP 已在列表中，请直接修改它的别名。');
        rows.set(ip, {ip, name, removed:false}); setEdit(rows.get(ip), name);
        ipInput.value = ''; nameInput.value = ''; host.querySelector('#client-alias-search').value = ''; renderList(); feedback(ip + ' 已添加，点击“保存”后生效。');
      } catch (error) { feedback(error.message); }
    };
    renderList();
  }
  return {aliases, normalizeIP, mergeEdits, topology, open};

})();
export { clientsService };
export function initialize() {}
