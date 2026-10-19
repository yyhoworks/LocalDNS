import { icon } from './icons.js';
import { esc } from '../format/number.js';

  const loadingPage=()=>`<div class="grid grid-4 metrics-grid-mobile">${[1,2,3,4].map(()=>`<div class="metric-card skeleton" style="height:112px"></div>`).join('')}</div><div class="card skeleton" style="height:340px;margin-top:16px"></div>`;

  function overviewMetricCard(label,value,iconName,tone='primary'){return `<div class="metric-card overview-kpi-card tone-${tone}"><span class="metric-icon">${icon(iconName)}</span><div class="overview-kpi-body"><span class="overview-kpi-label">${esc(label)}</span><div class="metric-value">${value}</div></div></div>`;}

  function card(title,body,{iconName='overview',subtitle='',actions='',className=''}={}){return `<section class="card ${className}"><div class="card-header"><div class="card-title"><span class="icon">${icon(iconName)}</span><div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div><div class="card-actions">${actions}</div></div><div class="card-body">${body}</div></section>`;}

  const empty=(text='暂无数据')=>`<div class="empty-state"><div><div class="empty-icon">${icon('info')}</div><strong>${esc(text)}</strong></div></div>`;
export { loadingPage, overviewMetricCard, card, empty };
