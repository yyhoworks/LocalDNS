import { ApiError } from '../../core/api/api-error';
import { setHTML } from '../../core/security/safe-dom';
import { api } from '../../core/api/api.js';
import { confirmDialog, modalOpen } from '../../shared/components/dialog.js';
import { toast } from '../../shared/components/toast.js';
import { esc, num } from '../../shared/format/number.js';
import { syncRuleUpdateState, runRuleUpdate, ruleUpdatePending } from './update-state.js';

export type CustomSplitMode = 'default' | 'custom';
export interface CustomSplitRule {
  type: string;
  name?: string;
  enabled?: boolean;
  url?: string;
  files?: string;
  rule_count?: number;
  local?: boolean;
  upload_name?: string;
  auto_update?: boolean;
  update_interval_hours?: number;
}
export interface CustomSplitSnapshot { mode: CustomSplitMode; rules: CustomSplitRule[] }
export interface CustomSplitProbe { supported: boolean; snapshot?: CustomSplitSnapshot; error?: string }

const endpoint = '/api/v1/custom-split';
const ruleEndpoint = '/api/v1/rule-groups/custom_split';
const builtinNames: Record<string, string> = {
  block_list: '黑名单',
  proxy_list: '国外解析名单',
  direct_list: '国内解析名单',
  custom_non_cn: '海外自定义规则',
  custom_cn: '国内自定义规则',
};
const builtinCounts: Record<string, string> = {
  block_list: 'block',
  proxy_list: 'force_foreign_fakeip',
  direct_list: 'force_domestic',
  custom_non_cn: 'custom_non_cn',
  custom_cn: 'custom_cn',
};
const editableTypes: Record<string, string> = {
  proxy_rule: '代理规则',
  direct_rule: '直连规则',
};
const isBuiltin = (rule: CustomSplitRule): boolean => Object.hasOwn(builtinNames, rule.type);
const isEditable = (rule: CustomSplitRule): boolean => Object.hasOwn(editableTypes, rule.type);

function parseSnapshot(value: unknown): CustomSplitSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('自定义分流返回格式无效。', 0, value, 'contract');
  }
  const data = value as Record<string, unknown>;
  if (!['default', 'custom'].includes(String(data.mode)) || !Array.isArray(data.rules)) {
    throw new ApiError('自定义分流缺少有效模式或规则顺序。', 0, value, 'contract');
  }
  const rules = data.rules.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(`自定义分流第 ${index + 1} 条规则无效。`, 0, item, 'contract');
    }
    const rule = item as Record<string, unknown>;
    if (typeof rule.type !== 'string' || !rule.type || (rule.name !== undefined && typeof rule.name !== 'string') ||
      (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')) {
      throw new ApiError(`自定义分流第 ${index + 1} 条规则字段无效。`, 0, item, 'contract');
    }
    for (const key of ['url', 'files', 'upload_name']) {
      if (rule[key] != null && typeof rule[key] !== 'string') {
        throw new ApiError(`自定义分流第 ${index + 1} 条规则来源无效。`, 0, item, 'contract');
      }
    }
    return { ...rule, type: rule.type, enabled: rule.enabled !== false } as CustomSplitRule;
  });
  return { mode: data.mode as CustomSplitMode, rules };
}

export async function probeCustomSplit(signal?: AbortSignal): Promise<CustomSplitProbe> {
  try {
    const value = await api.request(endpoint, { signal });
    if (typeof value === 'string' && /^\s*(?:<!doctype html|<html)/i.test(value)) {
      return { supported: false };
    }
    return { supported: true, snapshot: parseSnapshot(value) };
  } catch (error) {
    if (signal?.aborted) return { supported: false };
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) return { supported: false };
    return { supported: false, error: error instanceof Error ? error.message : '读取自定义分流能力失败。' };
  }
}

function serializeOrder(rules: CustomSplitRule[]) {
  return rules.map(rule => isBuiltin(rule)
    ? { type: rule.type, enabled: rule.enabled !== false }
    : { type: rule.type, name: rule.name, enabled: rule.enabled !== false });
}

function displayName(rule: CustomSplitRule) {
  return isBuiltin(rule) ? builtinNames[rule.type] : rule.name || rule.type;
}

function displaySource(rule: CustomSplitRule) {
  if (isLocalRule(rule)) {
    return `本地文件 · ${rule.files || rule.upload_name || '已上传'}`;
  }
  return rule.url || rule.files || '内核内置规则';
}

function isLocalRule(rule: CustomSplitRule) {
  return Boolean(rule.local || rule.upload_name || (!rule.url && rule.files));
}

function ruleCount(rule: CustomSplitRule, counts: Record<string, unknown>) {
  const key = isBuiltin(rule) ? builtinCounts[rule.type] : undefined;
  const count = key ? counts[key] : rule.rule_count;
  return typeof count === 'number' && Number.isFinite(count) ? `${num(count)} 条` : '—';
}

async function commitOrder(snapshot: CustomSplitSnapshot, rules: CustomSplitRule[]) {
  if (snapshot.rules.some(rule => !isBuiltin(rule) && !isEditable(rule))) {
    throw new Error('内核返回了当前界面无法编辑的规则类型，无法安全保存整个顺序。');
  }
  const fresh = parseSnapshot(await api.request(endpoint));
  if (fresh.mode !== snapshot.mode || JSON.stringify(serializeOrder(fresh.rules)) !== JSON.stringify(serializeOrder(snapshot.rules))) {
    throw new Error('内核的分流模式或规则顺序已变化，请刷新后再编辑。');
  }
  await api.json(endpoint, 'PUT', { rules: serializeOrder(rules) });
}

function sourcePayload(values: {
  type: string;
  name: string;
  url: string;
  files: string;
  enabled: boolean;
  autoUpdate: boolean;
  intervalHours: number;
  local?: boolean;
  uploadName?: string;
}) {
  const payload = {
    type: values.type,
    name: values.name,
    files: values.files,
    enabled: values.enabled,
    auto_update: values.autoUpdate,
    update_interval_hours: values.intervalHours,
  };
  if (values.local) {
    return { ...payload, local: true, upload_name: values.uploadName };
  }
  return values.url ? { ...payload, url: values.url } : payload;
}

async function uploadRuleFile(name: string, file: File, entry: ReturnType<typeof sourcePayload>, from?: string) {
  const query = new URLSearchParams({ filename: file.name, entry: JSON.stringify(entry) });
  if (from && from !== name) query.set('from', from);
  if (file.size > 64 * 1024 * 1024) throw new Error('规则文件不能超过 64 MB。');
  return api.request(`${ruleEndpoint}/${encodeURIComponent(name)}/upload?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}

function openRuleModal(
  current: CustomSplitRule | null,
  snapshot: CustomSplitSnapshot,
  signal: AbortSignal,
  refresh: () => Promise<void>,
) {
  const initialType = current?.type || 'proxy_rule';
  const initialName = current?.name || builtinNames[initialType] || '';
  const initialUrl = current?.url || '';
  const initialFiles = current?.files || '';
  const initialEnabled = current?.enabled !== false;
  const initialAutoUpdate = current?.auto_update !== false;
  const initialHours = current?.update_interval_hours || 24;
  const availableTypes = current ? editableTypes : {
    ...editableTypes,
    ...Object.fromEntries(Object.entries(builtinNames).filter(([type]) => !snapshot.rules.some(rule => rule.type === type))),
  };
  const types = Object.entries(availableTypes).map(([type, label]) =>
    `<option value="${type}" ${type === initialType ? 'selected' : ''}>${label}</option>`).join('');
  modalOpen(current ? '编辑自定义规则' : '添加自定义规则',
    '自定义源按当前顺序参与匹配；规则内容由内核转换并加载。',
    `<div class="stack">
      <div class="grid grid-2">
        <div class="field"><label for="split-rule-name">名称</label>
          <input id="split-rule-name" maxlength="100" value="${esc(initialName)}" required></div>
        <div class="field"><label for="split-rule-type">规则用途</label>
          <select id="split-rule-type">${types}</select></div>
      </div>
      <label class="switch"><input id="split-rule-enabled" type="checkbox" ${initialEnabled ? 'checked' : ''}>
        <span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label>
      <div id="split-rule-source-fields" class="stack">
        <div class="field"><label for="split-rule-url">订阅地址</label>
          <input id="split-rule-url" type="url" value="${esc(initialUrl)}" placeholder="https://example.com/rules"></div>
        <div class="field"><label for="split-rule-file">本地规则文件</label>
          <input id="split-rule-file" type="file" accept=".srs,.json,.txt,.yaml,.yml,.dat">
          <p class="form-note">选择文件会替换当前来源，支持 SRS、JSON、TXT、YAML 和 DAT，最大 64 MB。</p></div>
        <div class="field"><label for="split-rule-files">源文件名（可选）</label>
          <input id="split-rule-files" maxlength="180" value="${esc(initialFiles)}"></div>
        <label class="switch"><input id="split-rule-auto" type="checkbox" ${initialAutoUpdate ? 'checked' : ''}>
          <span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label>
        <div class="field"><label for="split-rule-hours">更新间隔（小时）</label>
          <input id="split-rule-hours" type="number" min="1" step="1" value="${esc(String(initialHours))}"></div>
      </div>
    </div>`, async () => {
      if (signal.aborted) return;
      const name = document.querySelector<HTMLInputElement>('#split-rule-name')?.value.trim() || '';
      const url = document.querySelector<HTMLInputElement>('#split-rule-url')?.value.trim() || '';
      const files = document.querySelector<HTMLInputElement>('#split-rule-files')?.value.trim() || '';
      const type = document.querySelector<HTMLSelectElement>('#split-rule-type')?.value || 'proxy_rule';
      const enabled = document.querySelector<HTMLInputElement>('#split-rule-enabled')?.checked ?? true;
      const autoUpdate = document.querySelector<HTMLInputElement>('#split-rule-auto')?.checked ?? true;
      const hoursValue = Number(document.querySelector<HTMLInputElement>('#split-rule-hours')?.value);
      const file = document.querySelector<HTMLInputElement>('#split-rule-file')?.files?.[0] || null;
      const localCurrent = Boolean(current && isLocalRule(current));
      if (!current && Object.hasOwn(builtinNames, type)) {
        if (snapshot.rules.some(rule => rule.type === type)) throw new Error('该内置规则已在自定义顺序中。');
        await commitOrder(snapshot, [...snapshot.rules, { type, enabled }]);
        toast('内置规则已加入自定义顺序');
        if (!signal.aborted) await refresh();
        return;
      }
      if (!name) throw new Error('请填写规则名称。');
      if (!url && !file && !localCurrent) throw new Error('请填写订阅地址或选择本地规则文件。');
      if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('订阅地址必须使用 HTTP 或 HTTPS。');
      if (!Number.isInteger(hoursValue) || hoursValue < 1) throw new Error('更新间隔必须是大于 0 的整数小时。');
      if (snapshot.rules.some(rule => rule !== current && rule.name === name)) throw new Error('规则名称已存在。');
      const keepLocal = localCurrent && !file && !url;
      const payload = sourcePayload({ type, name, url: file ? '' : url, files, enabled,
        autoUpdate: file || keepLocal ? false : autoUpdate, intervalHours: hoursValue,
        local: keepLocal, uploadName: current?.upload_name });
      const from = current?.name;
      const query = from && from !== name ? `?${new URLSearchParams({ from })}` : '';
      if (file) await uploadRuleFile(name, file, payload, from);
      else await api.json(`${ruleEndpoint}/${encodeURIComponent(name)}${query}`, 'PUT', payload);
      toast(current ? '自定义规则已保存' : '自定义规则已添加');
      if (!signal.aborted) await refresh();
    }, true, { pendingLabel: '保存中…', onError: (error: unknown) => reportWriteFailure('保存失败', error) });
  const typeSelect = document.querySelector<HTMLSelectElement>('#split-rule-type')!;
  const nameInput = document.querySelector<HTMLInputElement>('#split-rule-name')!;
  const sourceFields = document.querySelector<HTMLElement>('#split-rule-source-fields')!;
  let sourceName = nameInput.value;
  const syncTypeFields = () => {
    const builtin = Object.hasOwn(builtinNames, typeSelect.value);
    if (!nameInput.readOnly) sourceName = nameInput.value;
    nameInput.readOnly = builtin;
    nameInput.value = builtin ? builtinNames[typeSelect.value] : sourceName;
    sourceFields.hidden = builtin;
    sourceFields.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = builtin; });
  };
  typeSelect?.addEventListener('change',syncTypeFields);
  syncTypeFields();
}

export async function renderCustomSplitRules(
  body: HTMLElement,
  signal: AbortSignal,
  refresh: () => Promise<void>,
) {
  const [probe, status] = await Promise.all([
    probeCustomSplit(signal),
    api.request('/api/v1/status', { signal }).catch(() => null),
  ]);
  if (signal.aborted || !body.isConnected) return;
  if (!probe.supported || !probe.snapshot) {
    if (body.querySelector('.custom-split-card')) {
      toast('暂未刷新自定义分流', 'info', '已保留上次读取的规则。');
      return;
    }
    setHTML(body, `<section class="card"><div class="error-panel"><strong>自定义分流暂不可用</strong>
      <p>${esc(probe.error || '当前内核没有返回可识别的自定义分流配置。')}</p></div></section>`);
    return;
  }
  const snapshot = probe.snapshot;
  if (snapshot.mode !== 'custom') {
    setHTML(body, '<section class="card"><div class="empty-state">当前使用默认分流。切到自定义模式后可调整规则。</div></section>');
    return;
  }
  const counts = status && typeof status === 'object' && 'rules' in status && status.rules && typeof status.rules === 'object'
    ? status.rules as Record<string, unknown> : {};
  const rows = snapshot.rules.map((rule, index) => {
    const name = displayName(rule);
    const type = isBuiltin(rule) ? builtinNames[rule.type] : isEditable(rule) ? editableTypes[rule.type] : rule.type;
    const source = displaySource(rule);
    const builtin = isBuiltin(rule);
    const canEdit = isEditable(rule);
    const canUpdate = canEdit && Boolean(rule.url);
    return `<li class="custom-split-row${rule.enabled === false ? ' is-disabled' : ''}"
        data-tag="custom_split" data-name="${esc(rule.name || rule.type)}" data-split-index="${index}">
      <div class="custom-split-order">
        <span aria-label="优先级 ${index + 1}">${index + 1}</span>
        <button class="button ghost" type="button" data-split-move="-1" data-index="${index}"
          aria-label="将 ${esc(name)} 上移" ${index === 0 ? 'data-always-disabled disabled' : ''}>上移</button>
        <button class="button ghost" type="button" data-split-move="1" data-index="${index}"
          aria-label="将 ${esc(name)} 下移"
          ${index === snapshot.rules.length - 1 ? 'data-always-disabled disabled' : ''}>下移</button>
      </div>
      <div class="custom-split-main">
        <label class="switch custom-split-enabled"><input type="checkbox" class="sp-enable" data-split-enabled="${index}"
          aria-label="启用 ${esc(name)}" ${rule.enabled !== false ? 'checked' : ''}>
          <span class="switch-track"><span class="switch-thumb"></span></span></label>
        <div class="custom-split-copy"><strong>${esc(name)}</strong>
          <span>${esc(type)} · ${esc(ruleCount(rule, counts))}</span>
          <span class="custom-split-source" title="${esc(source)}">${esc(source)}</span></div>
      </div>
      <div class="custom-split-actions">
        ${canUpdate ? '<button class="button sp-update" type="button">更新</button>' : ''}
        ${canEdit ? `<button class="button sp-edit" type="button">${isLocalRule(rule) ? '编辑或替换文件' : '编辑'}</button>` : ''}
        ${builtin || canEdit ? '<button class="button ghost sp-delete" type="button">移除</button>' : ''}
      </div>
    </li>`;
  }).join('');
  const hasUpdate = snapshot.rules.some(rule => rule.enabled !== false && isEditable(rule) && Boolean(rule.url));
  setHTML(body, `<section class="card custom-split-card">
    <div class="card-header"><div class="card-title"><h2>自定义分流顺序</h2>
      <span class="rule-card-subtitle">按顺序匹配；内置名单移除后仍保留原始数据。</span></div></div>
    <div class="card-body">
      <p class="form-note">只在“自定义”模式生效。用上移、下移调整优先级；每次变更会立即保存到内核。</p>
      <div class="custom-split-toolbar">
        <span>${snapshot.rules.length} 条规则</span>
        <div><button class="button" id="sp-update-all" type="button"
          ${hasUpdate ? '' : 'data-always-disabled disabled'}>更新全部</button>
          <button class="button primary" id="sp-add" type="button">添加规则</button></div>
      </div>
      ${rows ? `<ol class="custom-split-list">${rows}</ol>` :
        '<div class="empty-state">添加内置规则、订阅或本地规则文件。</div>'}
    </div>
  </section>`);
  syncRuleUpdateState(body, 'custom-split', refresh);

  let saving = false;
  const setBusy = (value: boolean) => {
    saving = value;
    body.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(control => {
      control.disabled = value || control.hasAttribute('data-always-disabled');
    });
    if (value) body.setAttribute('aria-busy', 'true');
    else body.removeAttribute('aria-busy');
  };
  const saveOrder = async (rules: CustomSplitRule[], message: string, rollback?: () => void) => {
    if (saving) return false;
    setBusy(true);
    try {
      await commitOrder(snapshot, rules);
      toast(message);
      if (!signal.aborted) await refresh();
      return !signal.aborted;
    } catch (error) {
      rollback?.();
      reportWriteFailure('自定义分流保存失败', error);
      return false;
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };

  body.querySelectorAll<HTMLButtonElement>('[data-split-move]').forEach(button => {
    button.onclick = async () => {
      if (saving) return;
      const index = Number(button.dataset.index);
      const target = index + Number(button.dataset.splitMove);
      if (target < 0 || target >= snapshot.rules.length) return;
      const next = [...snapshot.rules];
      [next[index], next[target]] = [next[target], next[index]];
      if (await saveOrder(next, '自定义分流顺序已保存')) {
        const moved = body.querySelector(`[data-split-index="${target}"]`);
        const sameDirection = `[data-split-move="${button.dataset.splitMove}"]:not([disabled])`;
        (moved?.querySelector<HTMLButtonElement>(sameDirection) ||
          moved?.querySelector<HTMLButtonElement>('[data-split-move]:not([disabled])'))?.focus();
      }
    };
  });
  body.querySelectorAll<HTMLInputElement>('[data-split-enabled]').forEach(input => {
    input.onchange = () => {
      if (saving) return;
      const index = Number(input.dataset.splitEnabled);
      const next = snapshot.rules.map((rule, ruleIndex) => ruleIndex === index
        ? { ...rule, enabled: input.checked } : rule);
      void saveOrder(next, '自定义分流状态已保存', () => { input.checked = snapshot.rules[index].enabled !== false; });
    };
  });
  body.querySelector<HTMLButtonElement>('#sp-add')!.onclick = () => openRuleModal(null, snapshot, signal, refresh);
  const rowRule = (button: HTMLButtonElement) =>
    snapshot.rules[Number(button.closest<HTMLElement>('[data-split-index]')?.dataset.splitIndex)];
  body.querySelectorAll<HTMLButtonElement>('.sp-edit').forEach(button => {
    button.onclick = () => {
      const rule = rowRule(button);
      if (rule) openRuleModal(rule, snapshot, signal, refresh);
    };
  });
  body.querySelectorAll<HTMLButtonElement>('.sp-delete').forEach(button => {
    button.onclick = async () => {
      const rule = rowRule(button);
      if (!rule || saving) return;
      const name = displayName(rule);
      if (!await confirmDialog({ title: '移除自定义规则',
        message: isBuiltin(rule) ? `从自定义顺序中移除“${name}”？原始名单和规则文件不会删除。` : `删除“${name}”及其自定义规则来源？`,
        confirmText: '移除', danger: true }) || signal.aborted || saving) return;
      setBusy(true);
      try {
        if (isBuiltin(rule)) {
          await commitOrder(snapshot, snapshot.rules.filter(item => item !== rule));
        } else {
          await api.request(`${ruleEndpoint}/${encodeURIComponent(rule.name || '')}`, { method: 'DELETE' });
        }
        toast('自定义规则已移除');
        if (!signal.aborted) await refresh();
      } catch (error) {
        reportWriteFailure('移除失败', error);
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    };
  });
  body.querySelectorAll<HTMLButtonElement>('.sp-update').forEach(button => {
    button.onclick = async () => {
      const name = rowRule(button)?.name;
      if (!name || saving || ruleUpdatePending('custom-split')) return;
      await runRuleUpdate(body, 'custom-split', { kind: 'single', name, signal }, async () => {
        try {
          await api.request(`${ruleEndpoint}/${encodeURIComponent(name)}/update`, { method: 'POST' });
          toast('规则更新完成');
          if (!signal.aborted) await refresh();
        } catch (error) {
          reportWriteFailure('规则更新失败', error);
        }
      });
    };
  });
  body.querySelector<HTMLButtonElement>('#sp-update-all')!.onclick = async () => {
    if (!hasUpdate || saving || ruleUpdatePending('custom-split')) return;
    await runRuleUpdate(body, 'custom-split', { kind: 'all', signal }, async () => {
      try {
        const result = await api.request(`${ruleEndpoint}/update`, { method: 'POST' }) as {
          changed?: number; unchanged?: number; failed?: number; errors?: Array<{ name?: string; error?: string }>;
        };
        const failed = Number(result?.failed || 0);
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        if (failed) toast('部分规则更新失败', 'error', errors.map(item => `${item?.name || '规则'}：${item?.error || '更新失败'}`).join('；'));
        else toast(`规则更新完成：${Number(result?.changed || 0)} 个来源有变化，${Number(result?.unchanged || 0)} 个无变化`);
        if (!signal.aborted) await refresh();
      } catch (error) {
        reportWriteFailure('批量更新失败', error);
      }
    });
  };
}

function reportWriteFailure(label: string, error: unknown) {
  if (error instanceof ApiError && ['timeout', 'network', 'invalid-json'].includes(error.code)) {
    toast('操作结果待确认', 'info', '服务器可能仍在处理，请先刷新核对结果。');
    return;
  }
  toast(label, 'error', error instanceof Error ? error.message : '请重新读取状态后核对。');
}
