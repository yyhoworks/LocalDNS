import { storage } from '../../core/context.js';

// 待重启标记：缓存参数保存后若需重启内核才置位，持久化到本地偏好，
// 刷新页面后顶栏重启按钮与侧栏底 badge 仍能恢复显示；
// 任何一次 restartService 成功都会清掉。事件只做 UI 刷新通知，
// 不经过管理页模块，避免 shell 与管理页互相引用。
const KEY = 'localdns-pending-restart-v1';
function isPendingRestart() {
  try { return storage.get(KEY) === '1'; } catch { return false; }
}
function setPendingRestart(on) {
  try {
    if (on) storage.set(KEY, '1');
    else storage.set(KEY, '');
  } catch { /* 偏好写不进时只影响 badge 显示，不阻塞保存流程 */ }
  window.dispatchEvent(new CustomEvent('localdns:pending-restart'));
}
export { isPendingRestart, setPendingRestart };
