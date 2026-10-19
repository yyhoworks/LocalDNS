import { setHTML } from '../../core/security/safe-dom.ts';
export let queryPathService;
export function initialize() {

  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const missing = value => value === null || value === undefined || value === '';
  const elapsed = value => missing(value) || !Number.isFinite(Number(value)) ? '未记录' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits:3}) + ' ms';
  const facts = rows => '<dl class="query-path-facts">' + rows.map(([key,value]) => `<div><dt>${esc(key)}</dt><dd>${esc(missing(value) ? '未记录' : value)}</dd></div>`).join('') + '</dl>';
  function model(record, aliases = {}) {
    const answers = Array.isArray(record.answers) ? record.answers : [];
    const steps = [{name:'请求来源',result:aliases[record.client_ip] || record.client_ip || '未记录',facts:[['客户端',record.client_ip],['查询名称',record.query_name],['类型 / 类别',[record.query_type,record.query_class].filter(Boolean).join(' / ')]],note:'本条日志记录的查询问题与来源。'}];
    if (typeof record.cache === 'boolean') steps.push({name:'缓存记录',result:record.cache ? '缓存命中' : '未标记命中',facts:[['缓存标记',String(record.cache)],['最终分流',record.domain_set]],note:record.cache ? '此请求标记为缓存命中；命中前的其他执行步骤未记录。' : 'cache=false 仅表示未标记缓存命中，不据此推断检查顺序。'});
    if (record.domain_set) steps.push({name:'分流结果',result:record.domain_set,facts:[['最终分流',record.domain_set],['学习记录',record.learning],['上游尝试',record.upstream_attempt]],note:'最终分类与日志原文；未将分类推断为具体规则条目或上游节点。'});
    steps.push({name:'返回应答',result:record.response_code || '未记录',facts:[['响应码',record.response_code],['应答条数',answers.length],['请求总耗时',elapsed(record.duration_ms)]],note:'请求总耗时按接口原值显示，阶段耗时没有单独记录。'});
    const cached = record.cache === true && record.domain_set === 'cache_main';
    const conclusion = cached ? '主缓存命中，返回 ' + answers.length + ' 条应答。' : [record.domain_set ? '分流结果：' + record.domain_set : '分流未记录', record.response_code || '响应码未记录', answers.length + ' 条应答'].join(' · ');
    return {record,answers,steps,conclusion};
  }
  function html(record, aliases = {}) {
    const m = model(record, aliases);
    return `<div class="query-path" data-query-path><div class="query-path-summary"><p>${esc(m.conclusion)}</p>${facts([['请求总耗时',elapsed(record.duration_ms)],['Trace ID',record.trace_id],['记录范围','已有字段摘要']])}</div><section class="query-path-overview"><header><h3>已记录的路径</h3><span>点击查看依据</span></header><ol class="query-path-nodes">${m.steps.map((s,i) => `<li><button type="button" data-path-step="${i}" aria-pressed="${i === 0}" aria-controls="query-path-step-detail"><strong>${esc(s.name)}</strong><span>${esc(s.result)}</span><small>耗时未记录</small></button></li>`).join('')}</ol></section><section id="query-path-step-detail" class="query-path-step" aria-label="所选步骤"></section><p class="query-path-gap">本条缺少逐步执行记录。未记录不代表未执行；不补造规则、上游或分段耗时。</p><section class="query-path-answers"><header><h3>应答记录</h3><span>${m.answers.length} 条</span></header>${m.answers.length ? `<div class="table-wrap"><table><thead><tr><th>类型</th><th>值</th><th>TTL</th></tr></thead><tbody>${m.answers.map(a => `<tr><td>${esc(a.type ?? a.record_type ?? '未记录')}</td><td class="mono">${esc(a.data ?? a.value ?? '未记录')}</td><td>${esc(a.ttl === undefined || a.ttl === null ? '—' : a.ttl + ' s')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="query-path-note">本条日志没有 Answer 记录。</p>'}</section><details class="workspace-note"><summary>原始日志</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details></div>`;
  }
  function bind(root, record, aliases = {}) {
    const m = model(record,aliases), detail = root.querySelector('#query-path-step-detail');
    const select = index => {
      const step = m.steps[index]; if (!step) return;
      root.querySelectorAll('[data-path-step]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.pathStep) === index)));
      setHTML(detail, `<h3>${esc(step.name)}</h3><p class="query-path-note">${esc(step.note)}</p>${facts(step.facts)}`);
    };
    root.querySelectorAll('[data-path-step]').forEach(b => b.onclick = () => select(Number(b.dataset.pathStep)));
    select(0);
  }
  queryPathService = {model,html,bind};

}
