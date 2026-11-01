// 概览「代理流量」卡的数据来源。
//
// 内核不统计代理字节数，数据由 services/proxy-traffic 采集器轮询 Mihomo /
// sing-box 的 /connections 后写入 ui/custom/traffic.json（custom/ 目录在 UI
// 升级时保留）。采集器不在时返回 null，卡片显示「—」而不是 0——七格布局保持
// 不变，用户能看出这是「没接入」而不是「今天没流量」。
import { esc, fmtBytesBrief } from '../../shared/format/number.js';
import { parseSummary, freshness } from '../proxy/traffic-model.js';

const ENDPOINT = 'custom/traffic.json';

/** 只接受采集器写出的结构；缺 updated 视为无效（避免把半截文件当数据）。 */
export function parseProxyTraffic(raw) {
  return parseSummary(raw);
}

/** 把 "12.6 GB" 拆成数字和单位，交给现有数字字体排版。 */
export function splitBytes(value) {
  const text = fmtBytesBrief(value);
  const match = /^([\d.]+)\s*(\S+)$/.exec(text);
  return match ? { number: match[1], unit: ` ${match[2]}` } : { number: '—', unit: '' };
}

export function proxyCardView(data, now=Date.now()) {
  if (!data) return { value: '—', note: '未接入采集', state: 'empty', title: '未接入代理流量采集' };
  const status=freshness(data,now);
  if(status==='expired')return {value:'—',note:'采集已过期',state:status,title:`最后记录日期：${data.date} · 更新于 ${data.updated}`};
  const total = splitBytes(data.total);
  const down = splitBytes(data.down);
  const up = splitBytes(data.up);
  return {
    value: `${total.number}${total.unit}`,
    note: status==='stale'?'采集中断 · 最后记录':`今日 ↓${down.number}${down.unit} ↑${up.number}${up.unit}`,
    state: status,
    title: `今日走代理（采样估算）：下载 ${down.number}${down.unit}，上传 ${up.number}${up.unit}（不含直连）· 采集于 ${data.updated} · 点击进入代理页`,
  };
}

export async function loadProxyTraffic(fetchImpl = globalThis.fetch) {
  try {
    const url = new URL(`${ENDPOINT}?_=${Date.now()}`, document.baseURI);
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseProxyTraffic(await response.json());
  } catch {
    return null;
  }
}

/** 把数据写进卡片。数字走 display-number/display-unit，和 displayNumerals 输出一致。 */
export function hydrateProxyCard(root, data) {
  const card = root?.querySelector?.('[data-proxy-traffic]');
  if (!card) return;
  const view = proxyCardView(data);
  const value = card.querySelector('[data-proxy-value]');
  const note = card.querySelector('[data-proxy-note]');
  card.dataset.state = view.state;
  card.title = view.title;
  if (value) {
    if (data&&view.value!=='—') {
      const match = /^([\d.]+)(\s*\S+)?$/.exec(view.value) || ['', view.value, ''];
      const size = Math.min(38, 260 / Math.max(1, match[1].length));
      value.classList.add('has-display-number');
      value.style.setProperty('--numeral-size', `${size.toFixed(2)}px`);
      value.innerHTML = `<span class="display-number">${esc(match[1])}</span>` +
        (match[2] ? `<span class="display-unit">${esc(match[2])}</span>` : '');
    } else {
      value.classList.remove('has-display-number');
      value.style.removeProperty('--numeral-size');
      value.textContent = view.value;
    }
  }
  if (note) note.textContent = view.note;
}
