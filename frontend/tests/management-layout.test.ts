// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cacheTable, groupedFeatures, taskBody } from '../src/features/management/layout.js';

const render = (html: string) => { const root = document.createElement('div'); root.innerHTML = html; return root; };
describe('management task states', () => {
  it('does not report empty, failed or partial tasks as complete', () => {
    for (const status of [
      { progress: { processed: 0, total: 0 } },
      { task_state: 'failed', error: '<bad>', progress: { processed: 10, total: 10 } },
      { progress: { processed: 2, total: 10 } },
      {},
    ]) expect(taskBody(status, {})).not.toContain('已处理全部域名');
    expect(taskBody({ task_state:'failed', error:'<bad>' }, {})).toContain('&lt;bad&gt;');
  });
  it('reflects real progress and disabled/unknown schedules without showing a stale next run', () => {
    const status = { running:true, progress:{ processed:25, total:100 }, next_run_time:1794342600000 };
    const root = render(taskBody(status, { scheduler:{ enabled:false, interval_minutes:10080 } }));
    expect(root.textContent).toContain('当前任务进度');
    expect(root.textContent).toContain('定时未启用');
    expect(root.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(root.querySelector('.schedule-time')?.textContent).toBe('—');
    expect(taskBody(status, null)).toContain('定时状态未知');
  });
  it('shows completion only for finished nonempty tasks and clamps progress', () => {
    const html = taskBody({ running:false, progress:{ processed:101, total:100 } }, { scheduler:{ enabled:true, interval_minutes:10080 } });
    expect(html).toContain('已处理全部域名');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('每 7 天');
    expect(html).toContain('10,080 分钟');
  });
});
describe('management groups and cache rows', () => {
  it('keeps unknown feature states disabled and distinct from off', () => {
    const profiles = Array.from({length:8}, (_, i) => ({tag:'switch'+i,name:'Feature '+i,desc:'Description'}));
    const root = render(groupedFeatures(profiles, {switch0:'A',switch1:'B'}));
    expect(root.querySelectorAll('input')).toHaveLength(8);
    expect(root.querySelectorAll('input:disabled')).toHaveLength(6);
    expect(root.querySelectorAll('input:checked')).toHaveLength(1);
    expect(root.textContent).toContain('2 项未知');
    expect(root.querySelector('input')?.getAttribute('aria-label')).toBe('Feature 0');
  });
  it('preserves real cache data, accessible actions, and clamps visual bars', () => {
    const root = render(cacheTable([{tag:'cache_main',q:27847,size:0,hit:120,lazy:80}], () => '全部缓存'));
    expect(root.textContent).toContain('27,847');
    expect(root.querySelector('.hit-track span')?.getAttribute('style')).toBe('width:100%');
    expect(root.querySelector('.cache-clear')?.getAttribute('data-tag')).toBe('cache_main');
    expect(root.querySelector('.cache-view')?.getAttribute('aria-label')).toBe('查看全部缓存');
  });
});
