import { setHTML } from '../../core/security/safe-dom';
import { ApiError } from '../../core/api/api-error';
import { UIUpdateClient, upgradeTarget, type InstalledUI, type UIRelease, type UIUpdateStatus } from './ui-update-client';

export function createUIUpdatePanel(container: HTMLElement) {
  setHTML(container, `<h3>在线升级 UI</h3>
    <p class="version-note" data-update-connection>正在连接服务器升级入口…</p>
    <form class="version-update-auth" hidden>
      <label for="version-update-password">升级口令</label>
      <div class="version-update-unlock"><input id="version-update-password" type="password" autocomplete="current-password" required placeholder="输入安装时生成的口令"><button class="button" type="submit">授权升级</button></div>
      <p class="version-note">授权保留 30 分钟，口令不会保存在浏览器。</p>
    </form>
    <p class="version-note" data-update-target></p>
    <div class="version-update-progress" hidden><progress aria-label="UI 升级正在进行"></progress></div>
    <p class="version-update-result" role="status" aria-live="polite" hidden></p>
    <p class="version-error" role="alert" data-update-error hidden></p>
    <div class="version-actions version-update-actions">
      <button class="button primary" type="button" data-update-start disabled>升级 UI</button>
      <button class="button" type="button" data-update-refresh hidden>刷新使用新版</button>
      <button class="button" type="button" data-update-rollback hidden>恢复上一版 UI</button>
      <button class="button" type="button" data-update-retry>重试连接</button>
      <a class="button" href="https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md" target="_blank" rel="noopener noreferrer" data-update-help>安装说明</a>
    </div>`);
  container.classList.add('version-ui-update');
  const get = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const connection = get('[data-update-connection]'), form = get<HTMLFormElement>('form');
  const password = get<HTMLInputElement>('input'), authorize = get<HTMLButtonElement>('button[type=submit]');
  const start = get<HTMLButtonElement>('[data-update-start]'), refresh = get<HTMLButtonElement>('[data-update-refresh]');
  const rollback = get<HTMLButtonElement>('[data-update-rollback]'), retry = get<HTMLButtonElement>('[data-update-retry]');
  const help = get<HTMLAnchorElement>('[data-update-help]'), errorNode = get('[data-update-error]');
  const message = get('.version-update-result'), progress = get('.version-update-progress');
  let client: UIUpdateClient | undefined, available = false, busy = false, reading = false, error = '';
  let installed: InstalledUI | null = null, latest: UIRelease | null = null;
  let task: UIUpdateStatus = { state: 'idle', canRollback: false }, timer: ReturnType<typeof setTimeout> | undefined;
  const running = () => task.state === 'queued' || task.state === 'running';
  const currentUI = () => installed && task.installedVersion ? { ...installed, uiVersion: task.installedVersion } : installed;
  const describe = (failure: unknown) => failure instanceof Error ? failure.message : '连接失败，请重试。';

  function paint() {
    const target = upgradeTarget(currentUI(), latest);
    form.hidden = !available || Boolean(client?.authorized);
    authorize.disabled = busy;
    start.disabled = !available || !client?.authorized || !target.tag || busy || running();
    start.textContent = running() ? '正在更新…' : latest && target.tag ? '升级至 ' + latest.version : '升级 UI';
    rollback.hidden = !client?.authorized || !task.canRollback;
    rollback.disabled = busy || running();
    const needsRefresh = task.state === 'succeeded' && task.installedVersion !== installed?.uiVersion;
    refresh.hidden = !needsRefresh;
    refresh.classList.toggle('primary', needsRefresh);
    start.hidden = task.state === 'succeeded' && !target.tag;
    retry.disabled = busy;
    retry.textContent = client?.authorized ? '刷新状态' : '重试连接';
    help.hidden = available;
    connection.textContent = available ? client?.authorized ? '已授权，升级任务由服务器执行。' : '已连接，请授权后开始升级。'
      : busy ? '正在连接服务器升级入口…' : '此服务器尚未启用网页升级。完成一次安装后即可在这里操作。';
    get('[data-update-target]').textContent = needsRefresh
      ? `当前页面 UI 为 ${installed?.uiVersion || '旧版'}；刷新后使用服务器上的 ${task.installedVersion}。`
      : target.reason;
    progress.hidden = !running();
    message.hidden = !task.message;
    message.textContent = task.message || '';
    errorNode.hidden = !error;
    errorNode.textContent = error;
  }
  function schedule() {
    clearTimeout(timer);
    if (running() && client?.authorized) timer = setTimeout(() => void readStatus(), 1500);
  }
  async function readStatus() {
    if (!client?.authorized || busy || reading) return;
    reading = true;
    try { task = await client.status(); error = ''; }
    catch (failure) { error = describe(failure); }
    finally { reading = false; }
    paint(); schedule();
  }
  async function connect() {
    if (busy) return;
    if (client?.authorized) { await readStatus(); return; }
    busy = true; error = ''; paint();
    try {
      const config = (window as typeof window & { LOCALDNS_UI_CONFIG?: { uiUpdaterBase?: string; apiBase?: string } }).LOCALDNS_UI_CONFIG;
      client = new UIUpdateClient(config?.uiUpdaterBase || config?.apiBase || '');
      await client.discover(); available = true;
    } catch (failure) {
      available = false;
      error = failure instanceof ApiError && failure.status === 404 ? '' : describe(failure);
    } finally { busy = false; paint(); }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !client || !password.value) return;
    busy = true; error = ''; paint();
    try { await client.login(password.value); task = await client.status(); }
    catch (failure) { error = describe(failure); }
    finally { password.value = ''; busy = false; paint(); schedule(); }
  });
  async function execute(restore: boolean) {
    const target = upgradeTarget(currentUI(), latest);
    if (!client?.authorized || busy || running() || (!restore && !target.tag)) return;
    if (!window.confirm(restore ? '恢复上一版 UI？当前 Logo、字体和站点配置会保留。' : '开始升级 UI？请先保存未提交的修改。升级完成后由你手动刷新，DNS 服务继续运行。')) return;
    busy = true; error = ''; paint();
    try { task = restore ? await client.rollback() : await client.upgrade(target.tag!); }
    catch (failure) {
      error = describe(failure);
      // A timed-out POST may already have started a task. Reconcile before allowing another action.
      if (client.authorized) {
        try { task = await client.status(); }
        catch { error += ' 请刷新状态核对服务器任务，避免重复提交。'; }
      }
    } finally { busy = false; paint(); schedule(); }
  }
  start.addEventListener('click', () => void execute(false));
  rollback.addEventListener('click', () => void execute(true));
  retry.addEventListener('click', () => void connect());
  refresh.addEventListener('click', () => window.location.reload());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && client?.authorized) void readStatus();
  });
  paint();
  return {
    connect,
    setRelease(current: InstalledUI | null, release: UIRelease | null) { installed = current; latest = release; paint(); },
  };
}
