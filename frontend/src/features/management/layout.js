import { num, fmtDate, esc, compactPct } from '../../shared/format/number.js';

const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const safeCount = value => finite(value) ? Math.max(0, Number(value)) : null;
const dateParts = value => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { day: date.toLocaleDateString('zh-CN'), time: date.toLocaleTimeString('zh-CN', { hour12:false, hour:'2-digit', minute:'2-digit' }), seconds: String(date.getSeconds()).padStart(2, '0') };
};

export function taskBody(status, config) {
  const taskState = String(status.task_state || status.status || 'idle').toLowerCase();
  const running = status.running === true || ['running', 'processing', 'cancelling'].includes(taskState);
  const failed = ['failed', 'error'].includes(taskState);
  const stateText = ({ idle:'空闲', running:'运行中', processing:'运行中', cancelling:'正在取消', failed:'运行失败', error:'运行失败' })[taskState] || (running ? '运行中' : '空闲');
  const scheduled = config?.scheduler?.enabled;
  const next = scheduled ? dateParts(status.next_run_time) : null;
  const processed = safeCount(status.progress?.processed), total = safeCount(status.progress?.total);
  const ratio = processed !== null && total > 0 ? Math.min(100, processed / total * 100) : 0;
  const complete = !running && !failed && total > 0 && processed >= total;
  const interval = safeCount(config?.scheduler?.interval_minutes);
  const lastRun = status.last_run_end_time || status.last_run_start_time || status.last_run?.finished_at || status.last_run?.started_at;
  const frequency = interval > 0 ? interval % 1440 === 0 ? `每 ${num(interval / 1440)} 天` : interval % 60 === 0 ? `每 ${num(interval / 60)} 小时` : `每 ${num(interval)} 分钟` : '未设置间隔';
  const subtitle = failed ? '任务未完成，请查看错误后重试' : running ? (taskState === 'cancelling' ? '正在结束当前任务' : '正在处理域名') : complete ? '已处理全部域名' : total === null ? '暂无任务进度' : total === 0 ? '暂无待处理域名' : '任务未完成';
  return `<div class="task-section-heading"><h3>刷新任务</h3><span class="task-idle ${failed ? 'is-error' : ''}"><span class="management-status-dot"></span>当前${stateText}</span></div>
    <div class="task-priority-grid">
      <section class="task-schedule" aria-label="下次执行计划"><div class="task-field-label">下次执行 <span class="schedule-enabled">${!config ? '定时状态未知' : scheduled ? '定时已启用' : '定时未启用'}</span></div>
        <div class="schedule-time"><strong>${next ? esc(next.time) : '—'}</strong>${next ? `<span>:${next.seconds}</span>` : ''}</div>
        <div class="schedule-date">${next ? esc(next.day) : scheduled ? '等待调度时间' : '未安排自动执行'}</div>
        <p class="schedule-frequency">${frequency}${interval > 0 ? ` <span>· ${num(interval)} 分钟</span>` : ''}</p></section>
      <section class="task-progress" aria-label="${running ? '当前任务进度' : '上次任务进度'}"><div class="task-field-label">${running ? '当前任务进度' : '上次任务进度'}</div>
        <div class="task-progress-value"><strong>${processed === null ? '—' : num(processed)}</strong><span>/ ${total === null ? '—' : num(total)}</span></div>
        <div class="task-progress-track" role="progressbar" aria-label="域名处理进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}" aria-valuetext="${processed === null ? '未知' : num(processed)} / ${total === null ? '未知' : num(total)}"><span style="width:${ratio}%"></span></div>
        <p class="task-progress-caption">${subtitle}</p></section>
    </div>
    ${status.error ? `<p class="task-error" role="alert">${esc(status.error)}</p>` : ''}
    <dl class="task-history"><div><dt>上次运行</dt><dd>${esc(fmtDate(lastRun))}</dd></div><div><dt>上次处理域名</dt><dd>${finite(status.last_run_domain_count) ? num(status.last_run_domain_count) + ' 条' : '—'}</dd></div></dl>`;
}

export function groupedFeatures(profiles, status) {
  const groups = [['filter', '请求与过滤'], ['cache', '缓存策略'], ['client', '客户端分流']];
  const sections = groups.map(([key, name]) => {
    const items = profiles.filter(profile => profile.group === key);
    const on = items.filter(profile => status[profile.tag] === 'A').length;
    const unknown = items.filter(profile => !['A', 'B'].includes(status[profile.tag])).length;
    const controls = items.map(profile => {
      const known = ['A', 'B'].includes(status[profile.tag]);
      const description = known ? (status[profile.tag] === 'A' ? profile.on : profile.off) || profile.desc : profile.desc;
      return `<div class="feature-card management-feature-card"><div>
        <h3>${esc(profile.name)}</h3><p>${esc(description)}</p>
        ${!known ? '<span class="feature-read-error">读取失败</span>' : ''}
      </div><div class="feature-footer"><label class="switch">
        <input data-switch="${profile.tag}" aria-label="${esc(profile.name)}" type="checkbox"
          ${status[profile.tag] === 'A' ? 'checked' : ''} ${known ? '' : 'disabled'}>
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </label></div></div>`;
    });
    return `<section class="management-feature-group"><div class="feature-group-heading">
      <h3>${name}</h3><span>${on} / ${items.length} 开启${unknown ? ` · ${unknown} 项未知` : ''}</span>
    </div><div class="management-feature-items">${controls.join('')}</div>
      ${key === 'client' ? '<p class="management-feature-note">FakeIP 与 RealIP 互斥启用</p>' : ''}
    </section>`;
  });
  return `<div class="management-feature-groups">${sections.join('')}</div>`;
}

export function featureSummary(profiles, status) {
  const on = profiles.filter(p => status[p.tag] === 'A').length;
  const unknown = profiles.filter(p => !['A', 'B'].includes(status[p.tag])).length;
  return `<span class="feature-total"><strong>${on}</strong> / ${profiles.length} 项开启${unknown ? ` · ${unknown} 项未知` : ''}</span>`;
}

export function cacheTable(caches, cacheName) {
  const rows = caches.map(c => `<tr class="${c.tag === 'cache_main' ? 'active-cache-row' : ''}"><td><span class="management-cache-name">${esc(cacheName(c.tag))}</span>${c.tag === 'cache_main' ? '<span class="management-current">当前模式</span>' : ''}</td>
    <td class="cache-requests" data-label="请求总数">${num(c.q)}</td><td class="cache-entries" data-label="条目数">${num(c.size)}</td>
    <td class="cache-hit" data-label="命中率"><span>${compactPct(c.hit)}</span><span class="hit-track" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, Number(c.hit) || 0))}%"></span></span></td>
    <td class="cache-stale" data-label="过期命中">${compactPct(c.lazy)}</td><td class="cache-row-actions"><button class="button small table-detail cache-view" data-tag="${esc(c.tag)}" aria-label="查看${esc(cacheName(c.tag))}">查看</button><details class="management-more"><summary aria-label="${esc(cacheName(c.tag))}更多操作">···</summary><div class="management-more-menu"><button type="button" class="button small danger cache-clear" data-tag="${esc(c.tag)}">清空此缓存</button></div></details></td></tr>`).join('');
  return `<table class="management-cache-table"><thead><tr>${['缓存池','请求总数','条目数','命中率','过期命中','操作'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="6">暂无缓存数据</td></tr>'}</tbody></table>`;
}
