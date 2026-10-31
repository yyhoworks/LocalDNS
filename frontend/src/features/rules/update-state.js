// Writes outlive a route. Keep their state when a user leaves and returns.
const pending = new Map();
const views = new Map();
const selectors = {
  adguard: '.ad-update,#ad-update-all,.ad-enable,.ad-edit,.ad-delete,#ad-add',
  diversion: '.div-update,#div-update-all,[data-div-update-group],.div-enable,.div-edit,.div-delete,#div-add'
};

export function syncRuleUpdateState(body, collection, refresh) {
  if (!body?.isConnected || body.dataset.ruleCollection !== collection) return;
  if (refresh) views.set(collection, { body, refresh });
  const operation = pending.get(collection);
  for (const button of body.querySelectorAll(selectors[collection])) {
    const update = button.matches('.ad-update,.div-update,#ad-update-all,#div-update-all,[data-div-update-group]');
    button.disabled = Boolean(operation);
    if (!update) continue;
    const row = button.closest('[data-id],[data-tag][data-name]');
    const active = operation && (operation.kind === 'all' || (operation.kind === 'group'
      ? button.dataset.divUpdateGroup === operation.tag || row?.dataset.tag === operation.tag
      : collection === 'adguard' ? row?.dataset.id === operation.id
        : row?.dataset.tag === operation.tag && row?.dataset.name === operation.name));
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent;
    const label = active ? '更新中…' : button.dataset.idleLabel;
    if (button.textContent !== label) button.textContent = label;
    if (active) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }
  let note = body.querySelector('[data-rule-update-status]');
  if (!note) {
    note = document.createElement('p');
    note.className = 'form-note';
    note.dataset.ruleUpdateStatus = '';
    note.setAttribute('role', 'status');
    body.querySelector('.card-body')?.prepend(note);
  }
  const message = operation ? '正在下载并更新规则，最多等待 5 分钟，请勿重复提交。' : '下载更新最多等待 5 分钟。';
  if (note.textContent !== message) note.textContent = message;
}

export async function runRuleUpdate(body, collection, operation, task) {
  if (pending.has(collection)) return;
  pending.set(collection, operation);
  syncRuleUpdateState(body, collection);
  try { return await task(); }
  finally {
    pending.delete(collection);
    const view = views.get(collection);
    if (view?.body !== body && view?.body.isConnected && view.body.dataset.ruleCollection === collection) await view.refresh();
    else syncRuleUpdateState(body, collection);
  }
}

export const ruleUpdatePending = collection => pending.has(collection);
