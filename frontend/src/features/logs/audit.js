import { currentScope } from '../../core/router/route-lifetime';
import { $, $$ } from '../../core/context.js';
import { api } from '../../core/api/api.js';
import { setHTML } from '../../core/security/safe-dom.ts';
import { num, esc } from '../../shared/format/number.js';
import { modalOpen, modalClose } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { renderRoute } from '../../core/router/router.js';
import { auditDirectory, auditStorage, readAuditStorage } from './audit-settings';

function storageDetails(value) {
  const mb = bytes => `${(bytes / 1048576).toFixed(2)} MB`;
  return `<dl class="audit-storage-details"><div><dt>当前实际位置</dt><dd>${esc(value.path)}</dd></div><div><dt>存储占用</dt><dd>内存 ${mb(value.memory_bytes)} · 磁盘 ${mb(value.disk_bytes)} · ${num(value.entries)} 条</dd></div></dl>
    ${value.memory_fs ? '<p class="audit-storage-warning">当前目录位于内存盘（tmpfs），请改用磁盘目录以减少内存占用。</p>' : ''}`;
}

export async function openAuditModal() {
  const scope = currentScope();
  let status, capacity, storage = null, storageError = null;
  try {
    [status, capacity] = await Promise.all([api.status(), api.capacity()]);
    try { storage = await readAuditStorage(path => api.request(path)); }
    catch (error) { storageError = error; }
  } catch (error) {
    if (!scope.signal.aborted) toast('审计控制读取失败', 'error', error.message);
    return;
  }
  if (scope.signal.aborted) return;
  const persistAvailable = !!storage && typeof storage.persist === 'boolean';
  modalOpen('审计控制', '管理 DNS 查询日志的记录状态、容量、存盘与存放位置', `
    <div class="audit-settings">
      <div class="kv-list"><div class="kv-row"><span class="kv-key">当前状态</span><span class="kv-value"><span class="badge ${status.capturing ? 'success' : 'danger'}">${status.capturing ? '运行中' : '已停止'}</span></span></div></div>
      ${persistAvailable ? `<div class="audit-persist-field">
        <label class="switch audit-persist-switch" for="audit-persist"><input id="audit-persist" type="checkbox" ${storage.persist ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">记录存盘 <span class="settings-compact-note">把查询记录压缩写入磁盘目录</span></span></label>
        <p class="form-note" id="audit-persist-help">关闭时只保留内存中的最新记录，磁盘占用保持 0。切换立即生效并写入 <code>config/settings/querylog.json</code>：关闭记为 <code>persist: false</code>，开启是默认值、文件中会省略该键，重启后按文件恢复。</p></div>` : ''}
      <div class="field"><label for="audit-cap">日志容量 <span class="settings-compact-note">最多保留的查询记录数</span></label>
        <div class="settings-refresh-row audit-settings-row"><input id="audit-cap" type="number" min="100" max="1000000" step="1" required value="${capacity.capacity}"><button type="button" class="button primary" id="audit-cap-save">保存容量</button></div></div>
      ${storage ? `<div class="field"><label for="audit-dir">日志存储位置</label>
        <div class="settings-refresh-row audit-settings-row"><input id="audit-dir" type="text" value="${esc(storage.dir)}" placeholder="logs 或 /var/log/localdns" autocomplete="off" spellcheck="false" required aria-describedby="audit-dir-help audit-dir-behavior"><button type="button" class="button primary" id="audit-dir-save">保存目录</button></div>
        <p class="form-note" id="audit-dir-help">填写 VM 上的目录。相对路径基于 LocalDNS 安装目录，也支持 /var/log/localdns 等绝对路径。</p>
        <div id="audit-storage-details">${storageDetails(storage)}</div>
        <p class="form-note" id="audit-dir-behavior">最新 2,000 条记录留在内存，其余压缩写入磁盘。重启服务后查询记录清空，目录设置保留。切换目录也会清空当前记录，旧文件留在原目录。</p></div>` : `<div class="audit-storage-unavailable"><p>${storageError ? '日志存储信息读取失败。可以重试，容量与审计开关仍可使用。' : '当前内核不支持自定义日志目录，升级到支持此功能的内核后即可设置。'}</p>${storageError ? '<button type="button" class="button small" id="audit-storage-retry">重新读取</button>' : ''}</div>`}
      <p class="audit-settings-feedback" id="audit-settings-feedback" role="status" aria-live="polite" hidden></p>
      <div class="grid grid-2 audit-settings-actions"><button type="button" class="button ${status.capturing ? 'danger' : 'success'}" id="modal-audit-toggle">${status.capturing ? '关闭审计' : '开启审计'}</button><button type="button" class="button danger" id="modal-audit-clear">清空日志</button></div>
    </div>`, null, false);

  const dialog = $('#modal');
  const feedback = $('#audit-settings-feedback');
  const active = () => !scope.signal.aborted && dialog.open && feedback.isConnected;
  let refreshOnClose = false;
  dialog.addEventListener('close', () => {
    if (refreshOnClose && !scope.signal.aborted && feedback.isConnected) renderRoute(true);
  }, { once: true });
  function message(text, error = false) {
    feedback.hidden = false;
    feedback.textContent = text;
    feedback.classList.toggle('is-error', error);
    feedback.setAttribute('role', error ? 'alert' : 'status');
  }
  async function perform(button, label, task) {
    const controls = $$('button, input', $('#modal-content'));
    const states = controls.map(control => control.disabled);
    const original = button.textContent;
    controls.forEach(control => { control.disabled = true; });
    button.textContent = label;
    feedback.hidden = true;
    try { await task(); }
    catch (error) { if (active()) message(error.message, true); }
    finally {
      controls.forEach((control, i) => { control.disabled = states[i]; });
      button.textContent = original;
    }
  }

  $('#audit-cap-save').onclick = event => {
    const input = $('#audit-cap');
    if (!input.reportValidity()) return;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 100 || value > 1000000) { message('日志容量应为 100 到 1,000,000 之间的整数。', true); return; }
    if (value < capacity.capacity && !confirm('降低日志容量可能移除较早的查询记录。确定保存容量？')) return;
    return perform(event.currentTarget, '保存中…', async () => {
      await api.json('/api/v1/audit/capacity', 'POST', { capacity: value });
      if (!active()) return;
      capacity = { capacity: value };
      refreshOnClose = true;
      if (storage) {
        try { storage = await readAuditStorage(path => api.request(path)); if (active() && storage) setHTML($('#audit-storage-details'), storageDetails(storage)); }
        catch { message('容量已保存，存储统计刷新失败。请重新打开审计控制查看。', true); return; }
      }
      if (active()) message('日志容量已保存。');
    });
  };
  if (persistAvailable) $('#audit-persist').onchange = async event => {
    const input = event.currentTarget;
    const next = input.checked;
    const controls = $$('button, input', $('#modal-content'));
    const states = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    feedback.hidden = true;
    try {
      const result = await api.json('/api/v1/audit/settings', 'POST', { persist: next });
      if (!active()) return;
      let updated = null;
      try { updated = auditStorage(result); }
      catch { message(next ? '服务器已开启存盘，但返回信息无效。请重新打开审计控制确认。' : '服务器已关闭存盘，但返回信息无效。请重新打开审计控制确认。', true); return; }
      storage = updated;
      input.checked = storage.persist === true;
      refreshOnClose = true;
      message(storage.persist ? '已开启记录存盘，查询记录会压缩写入磁盘目录。' : '已关闭记录存盘，只保留内存中的最新记录。');
    } catch (error) {
      if (!active()) return;
      input.checked = !next;
      message(error.message, true);
    } finally {
      controls.forEach((control, i) => { control.disabled = states[i]; });
    }
  };
  if (storage) $('#audit-dir-save').onclick = event => {
    let directory;
    try { directory = auditDirectory($('#audit-dir').value); }
    catch (error) { message(error.message, true); $('#audit-dir').focus(); return; }
    if (directory === storage.dir) { message('日志目录未变更。'); return; }
    if (!confirm('切换日志目录会清空当前查询记录，旧压缩文件留在原目录。确定保存目录？')) return;
    return perform(event.currentTarget, '保存中…', async () => {
      const result = await api.json('/api/v1/audit/settings', 'POST', { dir: directory });
      if (!active()) return;
      try { storage = auditStorage(result); }
      catch { message('服务器已接受保存请求，但返回信息无效。请重新打开审计控制确认当前目录。', true); return; }
      $('#audit-dir').value = storage.dir;
      setHTML($('#audit-storage-details'), storageDetails(storage));
      message('日志目录已保存，当前查询记录已清空。');
      refreshOnClose = true;
    });
  };
  $('#audit-storage-retry')?.addEventListener('click', () => { modalClose(); openAuditModal(); });
  $('#modal-audit-toggle').onclick = event => {
    if (status.capturing && !confirm('确定关闭审计？关闭期间新的查询日志将不再记录，直至重新开启。')) return;
    return perform(event.currentTarget, '更新中…', async () => {
    await api.request(`/api/v1/audit/${status.capturing ? 'stop' : 'start'}`, { method: 'POST' });
    if (!active()) return;
    toast('审计状态已更新'); modalClose(); renderRoute(true);
    });
  };
  $('#modal-audit-clear').onclick = event => {
    if (!confirm('确定清空所有查询日志？此操作无法撤销。')) return;
    return perform(event.currentTarget, '清空中…', async () => {
      await api.request('/api/v1/audit/clear', { method: 'POST' });
      if (!active()) return;
      toast('日志已清空'); modalClose(); renderRoute(true);
    });
  };
}
