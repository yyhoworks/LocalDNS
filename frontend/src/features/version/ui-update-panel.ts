import { setHTML } from '../../core/security/safe-dom';
import { ApiError } from '../../core/api/api-error';
import { UIUpdateClient, upgradeTarget, hashBackup, type InstalledUI, type UIRelease, type UIUpdateStatus, type UpdateMode } from './ui-update-client';
import { confirmDialog } from '../../shared/components/dialog.js';

export function createUIUpdatePanel(container: HTMLElement) {
  const modes: UpdateMode[] = ['ui', 'core', 'full'], names = { ui: 'UI', core: '内核', full: 'UI + 内核' };
  setHTML(container, `<h3>在线升级</h3><p class="version-note" data-connection>正在连接服务器升级入口…</p>
    <div class="version-upgrade-choices">${modes.map(mode => `<div class="version-upgrade-row" data-mode="${mode}"><div><h4>${names[mode]}</h4><p class="version-note" data-target></p><p class="version-note" data-reason></p>${mode === 'core' ? '<p class="version-note" data-core-name role="status">尚未选择文件</p>' : ''}</div><div class="version-upgrade-controls">${mode === 'core' ? '<label class="button version-file-label">选择内核 ZIP<input type="file" accept=".zip,application/zip" aria-label="选择原作者内核 ZIP" data-core-file disabled></label>' : ''}<button class="button${mode === 'full' ? ' primary' : ''}" type="button" data-start="${mode}" disabled>${mode === 'core' ? '上传并准备更新' : '升级' + names[mode]}</button></div></div>`).join('')}</div>
    <div class="version-update-progress" hidden><progress aria-label="升级正在进行"></progress></div>
    <p class="version-update-result" role="status" aria-live="polite" hidden></p>
    <section class="version-backup" aria-label="下载并校验本机备份" hidden><h4>先保存完整备份</h4>
      <p class="version-note">备份包含上游、自定义规则、客户端别名和订阅设置。请下载到电脑，再选择下载的文件校验。验证通过后才能切换版本。</p>
      <p class="version-note" data-backup-name></p><p class="version-backup-hash" data-backup-hash></p>
      <div class="version-actions"><button class="button" type="button" data-download>下载完整备份</button><label class="button version-file-label">选择本机备份校验<input type="file" accept=".gz,.tgz" data-file></label></div>
      <p class="version-note" role="status" data-backup-result></p><div class="version-actions"><button class="button primary" type="button" data-continue disabled>校验后继续升级</button><button class="button" type="button" data-cancel>取消本次准备</button></div></section>
    <p class="version-error" role="alert" data-error hidden></p>
    <div class="version-actions version-update-actions"><button class="button primary" type="button" data-refresh hidden>刷新使用新版</button><button class="button" type="button" data-rollback hidden>恢复上一版本</button><button class="button" type="button" data-retry>重试连接</button><a class="button" href="https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md" target="_blank" rel="noopener noreferrer" data-help>安装说明</a></div>`);
  container.classList.add('version-ui-update');
  const get = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const refresh = get<HTMLButtonElement>('[data-refresh]'), rollback = get<HTMLButtonElement>('[data-rollback]');
  const retry = get<HTMLButtonElement>('[data-retry]'), download = get<HTMLButtonElement>('[data-download]');
  const file = get<HTMLInputElement>('[data-file]'), proceed = get<HTMLButtonElement>('[data-continue]'), cancel = get<HTMLButtonElement>('[data-cancel]');
  const coreFile = get<HTMLInputElement>('[data-core-file]');
  let client: UIUpdateClient | undefined, available = false, busy = false, reading = false, uncertain = false, error = '';
  let installed: InstalledUI | null = null, latest: UIRelease | null = null, verifiedHash = '', backupResult = '尚未校验本机文件。', notEnabled = false;
  let selectedCore: File | undefined, uploading = false, uploadMessage = '';
  let task: UIUpdateStatus = { state: 'idle', canRollback: false }, timer: ReturnType<typeof setTimeout> | undefined;
  const running = () => ['queued', 'running', 'awaiting_backup', 'rolling_back'].includes(task.state);
  const currentUI = () => installed ? { ...installed, uiVersion: task.installedVersion || installed.uiVersion, backendVersion: task.installedBackend || installed.backendVersion } : installed;
  const describe = (failure: unknown) => failure instanceof Error && (failure.name === 'TypeError' || /Failed to fetch|NetworkError/.test(failure.message)) ? '连接失败，请重试。' : failure instanceof Error ? failure.message : '连接失败，请重试。';
  const target = (mode: UpdateMode) => upgradeTarget(currentUI(), latest, { mode, unified: Boolean(client?.unified) });
  function accept(value: UIUpdateStatus) {
    if (task.jobId !== value.jobId) { verifiedHash = ''; backupResult = '尚未校验本机文件。'; file.value = ''; }
    task = value; uncertain = false;
    document.dispatchEvent(new CustomEvent('localdns-update-status', { detail: value }));
  }
  function paint() {
    for (const mode of modes) {
      const row = get(`[data-mode="${mode}"]`), start = row.querySelector<HTMLButtonElement>('button')!;
      const eligibility = target(mode), supported = mode === 'core' ? Boolean(client?.coreUpload) : mode === 'ui' || client?.unified;
      start.disabled = !available || !supported || (mode === 'core' ? !selectedCore : !eligibility.tag) || busy || running() || uncertain;
      start.textContent = mode === 'core' && uploading ? '正在上传…' : running() && task.mode === mode ? '更新中…' : mode === 'core' ? '上传并准备更新' : '升级' + names[mode];
      row.querySelector('[data-target]')!.textContent = mode === 'ui' ? `${currentUI()?.uiVersion || '—'} → ${latest?.version || '待检查'}` : mode === 'core' ? `当前内核：${currentUI()?.backendVersion || '—'}${running() && task.source === 'upload' && task.targetBackend ? ' → ' + task.targetBackend : ''}` : latest ? `${latest.version} / ${latest.backend}` : '检查更新后显示目标版本';
      row.querySelector('[data-reason]')!.textContent = !supported ? '请先更新升级服务，以支持' + (mode === 'core' ? '上传内核 ZIP。' : '内核升级。') : mode === 'core' ? `上传原作者的内核 ZIP，自动选择 ${client!.coreUpload!.architecture}；保留当前 UI 和设置。下载并校验备份后才会切换，DNS 会短暂重启。` : eligibility.reason;
    }
    coreFile.disabled = !available || !client?.coreUpload || busy || running() || uncertain;
    get('[data-core-name]').textContent = selectedCore ? `${selectedCore.name} · ${(selectedCore.size / 1048576).toFixed(1)} MB` : '尚未选择文件';
    rollback.hidden = !available || !task.canRollback; rollback.disabled = busy || running() || uncertain;
    rollback.textContent = task.rollbackKind === 'full' ? '恢复上一整套版本' : '恢复上一版 UI';
    refresh.hidden = task.state !== 'succeeded' || task.installedVersion === installed?.uiVersion;
    retry.disabled = busy || reading; retry.textContent = available ? '刷新状态' : '重试连接';
    get('[data-help]').hidden = available && Boolean(client?.coreUpload);
    get('[data-connection]').textContent = available ? (client?.coreUpload ? '已连接。UI 使用 GitHub 发行版，内核可上传 ZIP；上传完成后，关闭弹窗任务仍会继续。' : client?.unified ? '已连接。当前服务支持 UI 与整套升级；更新升级服务后可上传内核 ZIP。' : '已连接旧版升级服务，目前支持 UI 单独升级。') : busy ? '正在连接服务器升级入口…' : notEnabled ? '此服务器尚未启用网页升级，请先完成一次安装。' : '升级服务连接失败，请重试。';
    get('.version-update-progress').hidden = !uploading && (!running() || task.state === 'awaiting_backup');
    get('.version-update-result').hidden = !uploading && !task.message; get('.version-update-result').textContent = uploading ? uploadMessage : task.message || '';
    get('.version-backup').hidden = task.state !== 'awaiting_backup' || !task.backup;
    get('[data-backup-name]').textContent = task.backup ? `${task.backup.name} · ${(task.backup.bytes / 1048576).toFixed(1)} MB` : '';
    get('[data-backup-hash]').textContent = task.backup ? 'SHA-256：' + task.backup.sha256 : '';
    get('[data-backup-result]').textContent = backupResult;
    download.disabled = file.disabled = cancel.disabled = busy || uncertain;
    proceed.disabled = busy || uncertain || !verifiedHash || verifiedHash !== task.backup?.sha256 || !task.backupDownloaded;
    proceed.textContent = task.action === 'rollback' ? '校验通过，继续恢复' : '校验通过，继续升级';
    get('[data-error]').hidden = !error; get('[data-error]').textContent = error;
  }
  function schedule() { clearTimeout(timer); if ((running() || uncertain) && available) timer = setTimeout(() => void readStatus(), task.state === 'awaiting_backup' ? 4000 : 1500); }
  async function readStatus() {
    if (!client || !available || busy || reading) return;
    reading = true;
    try { accept(await client.status()); error = ''; } catch (failure) { error = describe(failure); uncertain = true; }
    finally { reading = false; }
    paint(); schedule();
  }
  async function connect() {
    if (busy) return;
    if (client && available) { await readStatus(); return; }
    busy = true; error = ''; paint();
    try {
      const config = (window as typeof window & { LOCALDNS_UI_CONFIG?: { uiUpdaterBase?: string; apiBase?: string } }).LOCALDNS_UI_CONFIG;
      client = new UIUpdateClient(config?.uiUpdaterBase || config?.apiBase || '');
      await client.discover(); accept(await client.status()); available = true;
    } catch (failure) { available = false; notEnabled = failure instanceof ApiError && failure.status === 404; error = notEnabled ? '' : describe(failure); }
    finally { busy = false; paint(); schedule(); }
  }
  async function mutate(action: () => Promise<UIUpdateStatus>) {
    if (busy || !client) return;
    busy = true; error = ''; paint();
    try { accept(await action()); } catch (failure) {
      error = describe(failure);
      try { accept(await client.status()); } catch { uncertain = true; error += ' 正在重新核对服务器任务，请勿重复提交。'; }
    } finally { busy = false; paint(); schedule(); }
  }
  async function execute(mode: UpdateMode | 'rollback') {
    const eligibility = mode === 'rollback' ? null : target(mode);
    if (!client || !available || busy || running() || uncertain || (mode === 'core' ? !selectedCore || !client.coreUpload : mode !== 'rollback' && !eligibility?.tag)) return;
    if (mode === 'core') {
      const selected = selectedCore!;
      if (!await confirmDialog({ title: '准备更新内核', confirmText: '上传并准备', message: `上传「${selected.name}」并准备更换内核？请先保存修改。下载并校验完整备份后才会切换，DNS 届时会短暂重启。` })) return;
      uploading = true; uploadMessage = '正在校验内核 ZIP…';
      try {
        await mutate(async () => {
          const result = await client!.uploadCore(selected, percent => {
            uploadMessage = percent === 100 ? '正在上传内核 ZIP，请保持页面打开…' : `正在校验内核 ZIP… ${percent}%`; paint();
          });
          selectedCore = undefined;
          return result;
        });
      } finally { uploading = false; paint(); }
      return;
    }
    const text = mode === 'rollback' ? (task.rollbackKind === 'full' ? '准备恢复上一整套版本？将先备份当前状态，恢复后设置也回到快照时。' : '恢复上一版 UI？当前 Logo、字体和站点配置会保留。') : mode === 'ui' ? '开始升级 UI？请先保存未提交的修改。DNS 服务继续运行。' : '开始准备升级？请先保存修改。备份下载并校验后才会切换，DNS 届时会短暂重启。';
    if (!await confirmDialog({ message: text, danger: mode === 'rollback' })) return;
    await mutate(() => mode === 'rollback' ? client!.rollback() : client!.upgrade(eligibility!.tag!, mode));
  }
  for (const mode of modes) get(`[data-start="${mode}"]`).addEventListener('click', () => void execute(mode));
  coreFile.addEventListener('change', () => {
    const selected = coreFile.files?.[0];
    selectedCore = undefined; error = '';
    if (selected) {
      if (!/\.zip$/i.test(selected.name) || !selected.size || selected.size > (client?.coreUpload?.maxBytes || 0)) error = `请选择原作者内核 ZIP，大小不超过 ${Math.floor((client?.coreUpload?.maxBytes || 0) / 1048576)} MB。`;
      else selectedCore = selected;
    }
    coreFile.value = ''; paint();
  });
  rollback.addEventListener('click', () => void execute('rollback')); retry.addEventListener('click', () => void connect());
  refresh.addEventListener('click', () => window.location.reload());
  download.addEventListener('click', async () => {
    if (busy || !client || !task.backup) return;
    busy = true; error = ''; backupResult = '正在下载并核对备份，请稍候…'; paint();
    try {
      const blob = await client.download(task), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = task.backup.name; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      backupResult = '下载已发起，请在电脑上保存文件，再选择该文件校验。'; accept(await client.status());
    } catch (failure) { error = describe(failure); backupResult = '下载未完成，请重新下载。'; }
    finally { busy = false; paint(); schedule(); }
  });
  file.addEventListener('change', async () => {
    const selected = file.files?.[0], expected = task.backup, job = task.jobId; verifiedHash = '';
    if (!selected || !expected || busy) return;
    busy = true; error = ''; paint();
    try {
      if (selected.size !== expected.bytes) throw new Error('所选文件大小不一致，请选择本次下载的完整备份。');
      const value = await hashBackup(selected, percent => { backupResult = `正在校验本机文件… ${percent}%`; paint(); });
      if (job !== task.jobId || value !== expected.sha256) throw new Error('备份摘要不一致，请重新下载并选择正确文件。');
      verifiedHash = value; backupResult = '本机文件 SHA-256 一致，可继续升级。'; if (client) accept(await client.status());
    } catch (failure) { error = describe(failure); backupResult = '校验未通过，现网尚未切换。'; }
    finally { busy = false; file.value = ''; paint(); schedule(); }
  });
  proceed.addEventListener('click', () => { if (!proceed.disabled) void mutate(() => client!.continue(task.jobId!, verifiedHash)); });
  cancel.addEventListener('click', () => { if (!cancel.disabled) void mutate(() => client!.cancel(task.jobId!)); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && available) void readStatus(); });
  paint();
  return { connect, setRelease(current: InstalledUI | null, release: UIRelease | null) { installed = current; latest = release; paint(); } };
}
