(() => {
  'use strict';

  const CONFIG = Object.assign({
    apiBase: '', title: 'LocalDNS 控制台', refreshInterval: 30,
    requestTimeout: 10000, demoOnApiFailure: false
  }, window.LOCALDNS_UI_CONFIG || {});
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const API_BASE = String(CONFIG.apiBase || '').replace(/\/$/, '');
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const page = $('#page-content');
  const storage = { get(k){ try { return window.localStorage.getItem(k); } catch { return null; } }, set(k,v){ try { window.localStorage.setItem(k,String(v)); } catch {} } };
  const state = {
    route: 'overview', charts: [], history: [], lastStats: null, lastStatsAt: null, lastCpuTotal: null, lastCpuAt: null,
    logs: { page: 1, limit: 50, q: '', exact: false, type: '', set: '', code: '', client: '' },
    ruleTag: 'whitelist', upstreamConfig: null, aliases: {},
    refreshTimer: null, mobileMoreOpen: false, renderSeq: 0, routeController: null, routeUiCleanup: [],
    overviewSlowPage: 0, overviewDomainPage: 0
  };

  const icons = {
    overview:'<path d="M4 13h6V3H4v10Zm0 8h6v-6H4v6Zm10 0h6V11h-6v10Zm0-18v6h6V3h-6Z"/>',
    logs:'<path d="M5 4h14v2H5V4Zm0 5h14v2H5V9Zm0 5h9v2H5v-2Zm0 5h7v2H5v-2Z"/>',
    upstream:'<path d="M12 3a5 5 0 0 1 5 5v1h1a3 3 0 1 1 0 6h-1v1a5 5 0 0 1-10 0v-1H6a3 3 0 1 1 0-6h1V8a5 5 0 0 1 5-5Zm-3 6h6V8a3 3 0 1 0-6 0v1Zm0 6v1a3 3 0 1 0 6 0v-1H9Z"/>',
    rules:'<path d="M4 4h7v7H4V4Zm2 2v3h3V6H6Zm7-2h7v7h-7V4Zm2 2v3h3V6h-3ZM4 13h7v7H4v-7Zm2 2v3h3v-3H6Zm7-2h2v2h-2v-2Zm3 0h4v2h-4v-2Zm-3 3h7v2h-7v-2Zm0 3h5v2h-5v-2Z"/>',
    data:'<path d="M12 3c-4.42 0-8 1.34-8 3v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6c0-1.66-3.58-3-8-3Zm0 2c3.48 0 5.65.82 5.98 1-.33.18-2.5 1-5.98 1s-5.65-.82-5.98-1c.33-.18 2.5-1 5.98-1ZM6 8.45C7.47 8.82 9.55 9 12 9s4.53-.18 6-.55V11c0 .35-2.1 1-6 1s-6-.65-6-1V8.45Zm0 5C7.47 13.82 9.55 14 12 14s4.53-.18 6-.55V16c0 .35-2.1 1-6 1s-6-.65-6-1v-2.55Zm6 5.55c-3.9 0-6-.65-6-1v-.55c1.47.37 3.55.55 6 .55s4.53-.18 6-.55V18c0 .35-2.1 1-6 1Z"/>',
    settings:'<path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65-2-3.46-2.49 1a7.54 7.54 0 0 0-1.7-.99L15 3.25h-4l-.35 2.67c-.61.25-1.18.58-1.7.99l-2.49-1-2 3.46 2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65 2 3.46 2.49-1c.52.41 1.09.74 1.7.99L11 20.75h4l.35-2.67c.61-.25 1.18-.58 1.7-.99l2.49 1 2-3.46-2.11-1.65ZM13 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/>',
    features:'<path d="M7 2h2v3h6V2h2v3h2a2 2 0 0 1 2 2v3h-2V7H5v10h5v2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V2Zm8 10h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z"/>',
    management:'<path d="M4 5h8v2H4V5Zm12-2h2v2h2v2h-2v2h-2V7h-2V5h2V3ZM4 11h2v2H4v-2Zm6-2h2v2h8v2h-8v2h-2v-2H8v-2h2V9ZM4 17h10v2H4v-2Zm14-2h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z"/>',
    system:'<path d="M4 4h16v12H4V4Zm2 2v8h12V6H6Zm3 12h6v2H9v-2Z"/>',
    power:'<path d="M13 3h-2v10h2V3Zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.93 8.93 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83Z"/>',
    refresh:'<path d="M17.65 6.35A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3l-3.35 3.35Z"/>',
    theme:'<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.91-.1-1.35A7 7 0 0 1 12 3Z"/>',
    menu:'<path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/>',
    close:'<path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z"/>',
    chevron:'<path d="m8.6 4.6 7.4 7.4-7.4 7.4L7.2 18l6-6-6-6 1.4-1.4Z"/>',
    search:'<path d="M10 4a6 6 0 1 0 3.87 10.59L19.28 20 20.7 18.6l-5.41-5.41A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>',
    plus:'<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>',
    edit:'<path d="m14.69 4.86 4.45 4.45L8.45 20H4v-4.45L14.69 4.86Zm0 2.83L6 16.38V18h1.62l8.69-8.69-1.62-1.62ZM17.5 2 22 6.5l-1.45 1.45-4.5-4.5L17.5 2Z"/>',
    trash:'<path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3 2 .5 8h2L11 11H9Zm4 0-.5 8h2l.5-8h-2Z"/>',
    save:'<path d="M4 3h14l2 2v16H4V3Zm2 2v14h12V6.83L17.17 5H16v5H8V5H6Zm4 0v3h4V5h-4Zm-1 8h6v4H9v-4Z"/>',
    info:'<path d="M11 10h2v7h-2v-7Zm0-4h2v2h-2V6Zm1-4a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"/>',
    check:'<path d="m9.2 16.2-4.4-4.4L3.4 13.2 9.2 19 21 7.2 19.6 5.8 9.2 16.2Z"/>',
    warning:'<path d="M12 3 2 21h20L12 3Zm0 4.1L18.6 19H5.4L12 7.1ZM11 10h2v5h-2v-5Zm0 6h2v2h-2v-2Z"/>',
    download:'<path d="M11 3h2v9l3-3 1.4 1.4L12 15.8l-5.4-5.4L8 9l3 3V3ZM4 18h16v3H4v-3Z"/>',
    clock:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v4.59l3.2 3.2-1.4 1.42L11 12.41V7Z"/>',
    uptime:'<path d="M9 2h6v2H9V2Zm2 4h2v2.08A7 7 0 1 1 11 8.08V6Zm1 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-1 1h2v3.59l2.2 2.2-1.4 1.42L11 15.41V11Z"/>',
    cpu:'<path d="M9 2h2v3h2V2h2v3h1a3 3 0 0 1 3 3v1h3v2h-3v2h3v2h-3v1a3 3 0 0 1-3 3h-1v3h-2v-3h-2v3H9v-3H8a3 3 0 0 1-3-3v-1H2v-2h3v-2H2V9h3V8a3 3 0 0 1 3-3h1V2Zm-1 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H8Zm2 3h4v4h-4v-4Z"/>',
    memory:'<path d="M4 5h16v12H4V5Zm2 2v8h12V7H6Zm2 2h2v4H8V9Zm3 0h2v4h-2V9Zm3 0h2v4h-2V9ZM6 19h2v3H6v-3Zm5 0h2v3h-2v-3Zm5 0h2v3h-2v-3Z"/>',
    latency:'<path d="M13 2 5 13h6l-1 9 9-12h-6l0-8Zm-2.1 9L12 9.5v4.5h3l-2.1 2.8.35-4.8h-2.35Z"/>',
    shield:'<path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 2.16 6 2.25V11c0 4.11-2.49 7.8-6 8.86C8.49 18.8 6 15.11 6 11V6.41l6-2.25Z"/>',
    clients:'<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9 13c-4.42 0-7 2.18-7 5v2h14v-2c0-2.82-2.58-5-7-5Zm7.5-.5c-.76 0-1.47.08-2.12.22 2.27 1.1 3.62 2.98 3.62 5.28v2h4v-2c0-3.03-2.21-5.5-5.5-5.5Z"/>',
    globe:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5.93 6h-3.08a15.9 15.9 0 0 0-1.3-3.38A8.04 8.04 0 0 1 17.93 8ZM12 4c.83 1.2 1.46 2.55 1.8 4h-3.6A13.2 13.2 0 0 1 12 4ZM4.26 14A8.23 8.23 0 0 1 4 12c0-.69.09-1.36.26-2h3.43a17.6 17.6 0 0 0 0 4H4.26Zm1.81 2h3.08c.3 1.2.74 2.33 1.3 3.38A8.04 8.04 0 0 1 6.07 16Zm3.08-8H6.07a8.04 8.04 0 0 1 4.38-3.38A15.9 15.9 0 0 0 9.15 8ZM12 20a13.2 13.2 0 0 1-1.8-4h3.6A13.2 13.2 0 0 1 12 20Zm2.15-6h-4.3a15.7 15.7 0 0 1 0-4h4.3a15.7 15.7 0 0 1 0 4Zm-.6 5.38c.56-1.05 1-2.18 1.3-3.38h3.08a8.04 8.04 0 0 1-4.38 3.38ZM16.31 14a17.6 17.6 0 0 0 0-4h3.43c.17.64.26 1.31.26 2s-.09 1.36-.26 2h-3.43Z"/>',
    requestCount:'<path d="M5 4h14v16H5V4Zm2 2v12h10V6H7Zm2 2h6v2H9V8Zm0 4h6v2H9v-2Zm0 4h4v2H9v-2Z"/>',
    cacheHit:'<path d="M12 3C7.58 3 4 4.34 4 6v10c0 1.66 3.58 3 8 3 1.16 0 2.26-.09 3.25-.25A5 5 0 0 1 15 17c0-.7.14-1.36.4-1.97-.98.15-2.12.22-3.4.22-3.9 0-6-.65-6-1v-2.55c1.47.37 3.55.55 6 .55 1.92 0 3.63-.11 5-.33v-2.07c-1.3.26-3.04.4-5 .4-3.9 0-6-.65-6-1V7.7c1.47.37 3.55.55 6 .55s4.53-.18 6-.55v2.8c.75.16 1.43.48 2 .91V6c0-1.66-3.58-3-8-3Zm0 2c3.48 0 5.65.82 5.98 1-.33.18-2.5 1-5.98 1s-5.65-.82-5.98-1c.33-.18 2.5-1 5.98-1Zm7.3 8.3-2.55 2.55-1.05-1.05-1.4 1.4 2.45 2.45 3.95-3.95-1.4-1.4Z"/>',
    responseTime:'<path d="M12 4a9 9 0 0 0-9 9h2a7 7 0 1 1 14 0h2a9 9 0 0 0-9-9Zm0 3a6 6 0 0 0-6 6h2a4 4 0 0 1 7.07-2.57L11 14.5l1.41 1.41 4.08-4.08A6 6 0 0 0 12 7Zm-8 8v2h16v-2H4Z"/>',
    blockedRequest:'<path d="M12 2 4 5v6c0 5.25 3.44 9.74 8 11 4.56-1.26 8-5.75 8-11V5l-8-3Zm0 2.16 6 2.25V11c0 4.11-2.49 7.8-6 8.86C8.49 18.8 6 15.11 6 11V6.41l6-2.25Zm-3.3 4.13L7.29 9.7 9.59 12l-2.3 2.3 1.42 1.41 2.29-2.3 2.3 2.3 1.41-1.42-2.3-2.29 2.3-2.3-1.42-1.41-2.29 2.3-2.3-2.3Z"/>',
    clientCount:'<path d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.5 13C4.7 13 2 14.9 2 17.5V20h13v-2.5C15 14.9 12.3 13 8.5 13Zm7.2-.5c-.72 0-1.4.08-2.02.23 2.07 1.08 3.32 2.78 3.32 4.77V20h5v-2.1c0-3.08-2.32-5.4-6.3-5.4Z"/>',
    domainStats:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.92 9h-3.01a15.9 15.9 0 0 0-1.02-4.1A8.03 8.03 0 0 1 18.92 11ZM12 4c.9 1.26 1.56 3.02 1.85 5h-3.7C10.44 7.02 11.1 5.26 12 4ZM5.08 13h3.01c.13 1.48.48 2.9 1.02 4.1A8.03 8.03 0 0 1 5.08 13Zm3.01-2H5.08a8.03 8.03 0 0 1 4.03-4.1A15.9 15.9 0 0 0 8.09 11ZM12 20c-.9-1.26-1.56-3.02-1.85-5h3.7c-.29 1.98-.95 3.74-1.85 5Zm2.07-7H9.93a13.9 13.9 0 0 1 0-2h4.14a13.9 13.9 0 0 1 0 2Zm.82 4.1c.54-1.2.89-2.62 1.02-4.1h3.01a8.03 8.03 0 0 1-4.03 4.1Z"/>',
    more:'<path d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>'
  };
  const icon = (name, cls='') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icons[name] || icons.info}</svg>`;
  const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => Number.isFinite(+v) ? (+v).toLocaleString('zh-CN') : '—';
  const pct = v => Number.isFinite(+v) ? `${(+v).toFixed(2)}%` : '—';
  const compactNum = v => {
    const n=+v;
    if(!Number.isFinite(n))return '—';
    if(Math.abs(n)<10000)return n.toLocaleString('zh-CN');
    return new Intl.NumberFormat('zh-CN',{notation:'compact',compactDisplay:'short',maximumFractionDigits:1}).format(n);
  };
  const fullNum = v => Number.isFinite(+v) ? Math.max(0,Math.floor(+v)).toLocaleString('zh-CN') : '—';
  const compactPct = v => {
    const n=+v;
    if(!Number.isFinite(n))return '—';
    return `${Number.isInteger(n)?n.toFixed(0):n.toFixed(1)}%`;
  };
  const ms = v => Number.isFinite(+v) ? `${(+v).toFixed(2)} ms` : '—';
  const fmtBytesBrief = v => { const n=+v; if(!Number.isFinite(n))return '—'; const u=['B','KB','MB','GB','TB']; let i=0,x=n; while(x>=1024&&i<u.length-1){x/=1024;i++;} const d=i===0?0:(x>=100?0:x>=10?1:2); return `${x.toFixed(d)} ${u[i]}`; };
  const rankCount = (items,limit=1000) => !Array.isArray(items)?'—':items.length>=limit?`${num(limit)}+`:num(items.length);
  const startTimeMarkup = seconds => { const n=+seconds; if(!Number.isFinite(n)||n<=0)return '<span class="overview-start-datetime">—</span>'; const d=new Date(n*1000); if(Number.isNaN(d.getTime()))return '<span class="overview-start-datetime">—</span>'; const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'),hh=String(d.getHours()).padStart(2,'0'),mm=String(d.getMinutes()).padStart(2,'0'); return `<span class="overview-start-datetime">${y}-${m}-${day} ${hh}:${mm}</span>`; };
  const fmtDate = v => { if(!v)return '—'; const d=new Date(v); if(Number.isNaN(d.getTime()))return String(v); if(d.getUTCFullYear()<=1)return '—'; return d.toLocaleString('zh-CN',{hour12:false}); };
  const duration = seconds => { let s=Math.max(0,Math.floor(+seconds||0)); const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);return `${d?d+'天 ':''}${h? h+'小时 ':''}${m}分钟`; };
  const overviewUptimeMarkup = seconds => { const s=Math.max(0,Math.floor(+seconds||0)); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=s%60; const part=(n,u)=>`<span class="overview-duration-part"><span class="overview-duration-num">${n}</span><span class="overview-duration-unit">${u}</span></span>`; if(h)return `${part(h,'小时')}${part(m,'分钟')}`; if(m)return part(m,'分钟'); return part(sec,'秒'); };

  const routeDefs = [
    {section:'监控', id:'overview', label:'运行概览', icon:'overview', subtitle:'实时查看 DNS 运行状态与关键指标'},
    {section:'监控', id:'logs', label:'查询日志', icon:'logs', subtitle:'搜索、筛选并分析 DNS 请求记录'},
    {section:'配置', id:'upstreams', label:'DNS管理', icon:'upstream', subtitle:'管理上游 DNS 服务器并查看请求、采纳与错误统计'},
    {section:'配置', id:'rules', label:'规则管理', icon:'rules', subtitle:'统一维护名单、广告拦截与在线分流规则'},
    {section:'配置', id:'management', label:'系统管理', icon:'management', subtitle:'功能开关、缓存与运行数据管理'},
    {section:'配置', id:'proxy-config', label:'代理配置', icon:'management', subtitle:'编辑本机 Mihomo / sing-box 配置并校验重载'},
  ];

  const api = {
    url: p => `${API_BASE}${p}`,
    async request(path, options={}) {
      const ctrl = new AbortController(); const timer = setTimeout(()=>ctrl.abort(), CONFIG.requestTimeout);
      const method=String(options.method||'GET').toUpperCase();
      const routeSignal=method==='GET'&&state.routeController?state.routeController.signal:null;
      const externalSignal=options.signal||routeSignal;
      let abortForward=null;
      if(externalSignal){
        abortForward=()=>ctrl.abort();
        if(externalSignal.aborted)ctrl.abort();else externalSignal.addEventListener('abort',abortForward,{once:true});
      }
      try {
        const headers = Object.assign({}, options.headers || {});
        const res = await fetch(this.url(path), Object.assign({}, options, {headers, signal: ctrl.signal}));
        const ct = res.headers.get('content-type') || '';
        let body; if (ct.includes('application/json')) body = await res.json(); else body = await res.text();
        if (!res.ok) {
          const err = new Error((body && body.error) || (typeof body==='string' && body) || `HTTP ${res.status}`);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      } finally { clearTimeout(timer); if(externalSignal&&abortForward)externalSignal.removeEventListener('abort',abortForward); }
    },
    json(path, method='GET', body) { return this.request(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}); },
    metrics() { return this.request('/metrics'); },
    status() { return this.request('/api/v1/audit/status'); },
    capacity() { return this.request('/api/v1/audit/capacity'); },
    stats() { return this.request('/api/v2/audit/stats'); },
    rank(type,limit=10) { return this.request(`/api/v2/audit/rank/${type}?limit=${limit}`); },
    logs(params={}) { const qs=new URLSearchParams({page:1,limit:50,...params}); [...qs].forEach(([k,v])=>{if(v===''||v==null)qs.delete(k)}); return this.request(`/api/v2/audit/logs?${qs}`); }
  };


  function toast(message, type='success', detail='') {
    const el=document.createElement('div'); el.className=`toast ${type} toast-enter`;
    el.innerHTML=`<span>${icon(type==='error'?'warning':type==='success'?'check':'info')}</span><div><strong>${esc(message)}</strong>${detail?`<div class="toast-info">${esc(detail)}</div>`:''}</div>`;
    $('#toast-stack').appendChild(el);
    void el.offsetWidth; el.classList.remove('toast-enter');
    setTimeout(()=>{el.classList.add('toast-leave');setTimeout(()=>el.remove(),280)},3920);
  }
  // ── 动效工具：视图错峰入场 / 数字滚动 / 分段滑块 / 复制反馈 ──
  function playViewEnter(){
    if(reduceMotion.matches)return;
    page.classList.remove('view-enter');
    void page.offsetWidth;
    page.classList.add('view-enter');
    setTimeout(()=>page.classList.remove('view-enter'),1050);
  }
  function animateCountUps(root){
    // 先让 displayNumerals 完成「数字 / 单位」分层，再只滚动数字本体：
    // 保持结构不被覆写，避免动画后数字与单位字号失衡。
    window.LocalDNSInterface?.displayNumerals?.();
    if(reduceMotion.matches)return;
    root.querySelectorAll('.sk-val').forEach(el=>{
      const numEl=el.querySelector('.display-number');
      if(!numEl)return;
      const numText=numEl.textContent.trim();
      const target=parseFloat(numText.replace(/,/g,''));
      if(!isFinite(target)||target<=0)return;
      const decimals=(numText.split('.')[1]||'').length, grouped=numText.includes(',');
      const fmtNum=v=>{
        const num=decimals?Number(v.toFixed(decimals)):Math.round(v);
        return grouped?num.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}):num.toFixed(decimals);
      };
      const t0=performance.now(),dur=560;
      const step=now=>{
        if(!numEl.isConnected)return;
        if(reduceMotion.matches){numEl.textContent=numText;return;}
        const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);
        numEl.textContent=fmtNum(target*e);
        if(k<1)requestAnimationFrame(step);
        else{numEl.textContent=numText;el.classList.add('is-bumping');setTimeout(()=>el.classList.remove('is-bumping'),520)}
      };
      numEl.textContent=fmtNum(0);
      requestAnimationFrame(step);
    });
  }
  function syncSegThumb(group){
    const active=group.querySelector('.seg-item.active');
    let thumb=group.querySelector(':scope > .seg-thumb');
    if(!active){if(thumb)thumb.remove();return}
    if(!thumb){thumb=document.createElement('span');thumb.className='seg-thumb';thumb.setAttribute('aria-hidden','true');group.prepend(thumb)}
    thumb.style.width=active.offsetWidth+'px';
    thumb.style.height=active.offsetHeight+'px';
    thumb.style.transform=`translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  }
  function syncAllSegThumbs(){document.querySelectorAll('.seg-group').forEach(syncSegThumb)}
  async function copyToClipboard(text){
    try{ if(navigator.clipboard?.writeText){ await navigator.clipboard.writeText(text); return true; } }catch{}
    // 无剪贴板权限（或非安全上下文）时退回 execCommand
    try{
      const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;
    }catch{return false}
  }
  function setApiStatus(ok, text) {
    const box=$('#sidebar-status'), dot=$('.status-dot',box), strong=$('strong',box);
      dot.className=`status-dot ${ok?'online':'offline'}`; strong.textContent=(window.LocalDNSIdentity?.getName()||'LocalDNS')+(ok?' 运行正常':' 连接异常');
    $('#api-endpoint-label').textContent=text || (API_BASE || location.host);
    window.LocalDNSInterface?.connection(ok, text);
  }
  // 上游组的显示名（只影响界面；接口、配置文件和程序里仍是 domestic / foreign / foreign_ecs / proxy）
  const groupName=g=>({domestic:'国内',foreign:'国外',foreign_ecs:'国外 ECS',proxy:'代理'})[g]||g;
  function destroyCharts(){ state.charts.forEach(c=>{try{c.destroy()}catch{}}); state.charts=[]; }
  function chart(el, cfg){ if(!window.Chart||!el)return null; const c=new Chart(el,cfg); state.charts.push(c); return c; }
  function chartColors(){ const css=getComputedStyle(document.documentElement); return {primary:css.getPropertyValue('--primary').trim(),green:css.getPropertyValue('--green').trim(),orange:css.getPropertyValue('--orange').trim(),pink:css.getPropertyValue('--pink').trim(),cyan:css.getPropertyValue('--cyan').trim(),muted:css.getPropertyValue('--muted').trim(),border:css.getPropertyValue('--border').trim(),text:css.getPropertyValue('--text-2').trim(),surface:css.getPropertyValue('--surface-2').trim()}; }

  function parseProm(text) {
    const out=[];
    String(text||'').split('\n').forEach(line=>{
      line=line.trim(); if(!line||line.startsWith('#'))return;
      const m=line.match(/^([a-zA-Z_:][\w:]*)({([^}]*)})?\s+([^\s]+)$/); if(!m)return;
      const labels={}; if(m[3]) { const re=/(\w+)="((?:\\.|[^"])*)"/g; let x; while((x=re.exec(m[3]))) labels[x[1]]=x[2].replace(/\\"/g,'"').replace(/\\\\/g,'\\'); }
      out.push({name:m[1],labels,value:Number(m[4])});
    }); return out;
  }
  function metricFind(metrics,name,labels={}){ const m=metrics.find(x=>x.name===name&&Object.entries(labels).every(([k,v])=>x.labels[k]===v)); return m?m.value:0; }
  function parseSystem(metrics){ const start=metricFind(metrics,'process_start_time_seconds'); const info=metrics.find(x=>x.name==='localdns_runtime_info'); const ver=metrics.find(x=>x.name==='localdns_info'); return {
    version:ver?.labels?.version||'', platform:info?.labels?.platform||'',
    start, uptime:start?Date.now()/1000-start:0, cpu:metricFind(metrics,'process_cpu_seconds_total'), rss:metricFind(metrics,'process_resident_memory_bytes'), heapIdle:metricFind(metrics,'localdns_heap_free_bytes'),
    runtime:info?`Rust ${String(info.labels?.runtime||'').replace('rust-','')}`:'—', threads:metricFind(metrics,'localdns_threads'), goroutines:metricFind(metrics,'localdns_tasks'), fds:metricFind(metrics,'process_open_fds')
  };}
  function parseCaches(metrics){ const tags=['cache_main','cache_domestic','cache_foreign','cache_foreign_ecs']; return tags.map(tag=>{const q=metricFind(metrics,'localdns_cache_query_total',{tag}),h=metricFind(metrics,'localdns_cache_hit_total',{tag}),l=metricFind(metrics,'localdns_cache_lazy_hit_total',{tag}),size=metricFind(metrics,'localdns_cache_size_current',{tag});return{tag,q,h,l,size,hit:q?h/q*100:0,lazy:q?l/q*100:0};}); }
  const upstreamErrorReasonLabels={
    timeout:'Timeout',upstream_timeout:'Timeout',deadline:'Timeout',
    tls:'TLS',tls_handshake:'TLS',certificate:'TLS',
    socks5:'SOCKS5',socks:'SOCKS5',proxy:'SOCKS5',
    eof_reset:'EOF / Reset',eof:'EOF / Reset',reset:'EOF / Reset',broken_pipe:'EOF / Reset',
    dial_connect:'Dial / Connect',dial:'Dial / Connect',connect:'Dial / Connect',
    refused_unreachable:'Refused / Unreachable',refused:'Refused / Unreachable',unreachable:'Refused / Unreachable',
    http:'HTTP',protocol:'Protocol',unpack:'Protocol',other:'Other'
  };
  function upstreamErrorReasonName(reason){return upstreamErrorReasonLabels[String(reason||'').toLowerCase()]||String(reason||'Other').replace(/_/g,' ')}
  function upstreamMetrics(metrics,group,tag){
    const labels={metrics_tag:group,tag};
    const q=metricFind(metrics,'localdns_upstream_query_total',labels),err=metricFind(metrics,'localdns_upstream_error_total',labels),win=metricFind(metrics,'localdns_upstream_upstream_winner_total',labels),sum=metricFind(metrics,'localdns_upstream_response_latency_millisecond_sum',labels),count=metricFind(metrics,'localdns_upstream_response_latency_millisecond_count',labels);
    const reasonMetricNames=new Set(['localdns_upstream_upstream_error_reason_total']);
    const reasonRows=metrics.filter(x=>reasonMetricNames.has(x.name)&&x.labels.metrics_tag===group&&x.labels.tag===tag&&x.labels.reason);
    const reasonMap={}; reasonRows.forEach(x=>{const key=String(x.labels.reason||'other').toLowerCase();reasonMap[key]=(reasonMap[key]||0)+(Number(x.value)||0)});
    const reasons=Object.entries(reasonMap).map(([reason,value])=>({reason,label:upstreamErrorReasonName(reason),value})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label));
    const lastErrorNames=['localdns_upstream_upstream_last_error_unixtime_seconds'];
    let lastError=0; for(const name of lastErrorNames){lastError=metricFind(metrics,name,labels);if(lastError)break;}
    const ok=metricFind(metrics,'localdns_upstream_success_total',labels);
    return {q,err,win,latencySamples:count,latency:count?sum/count:0,success:(ok+err)?ok/(ok+err)*100:null,adoption:q?win/q*100:0,reasons,lastError,reasonSupported:reasonRows.length>0};
  }
  function upstreamErrorTime(ts){
    if(!ts)return'';
    const d=new Date(Number(ts)*1000); if(Number.isNaN(d.getTime()))return'';
    return d.toLocaleString('zh-CN',{hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function closeUpstreamErrorPopover(){
    const pop=$('#upstream-error-popover'); if(pop)pop.remove();
    document.removeEventListener('click',upstreamErrorOutsideClick,true);
    document.removeEventListener('keydown',upstreamErrorKeydown,true);
  }
  function upstreamErrorOutsideClick(e){const pop=$('#upstream-error-popover');if(pop&&!pop.contains(e.target)&&!e.target.closest('.up-error-detail-trigger'))closeUpstreamErrorPopover()}
  function upstreamErrorKeydown(e){if(e.key==='Escape')closeUpstreamErrorPopover()}
  function openUpstreamErrorPopover(trigger,row){
    closeUpstreamErrorPopover();
    const {g,u,m}=row;
    const reasonTotal=(m.reasons||[]).reduce((n,x)=>n+(Number(x.value)||0),0);
    const detail=m.reasonSupported
      ?(m.reasons.length
        ?`<div class="up-error-reason-list">${m.reasons.map(x=>`<div class="up-error-reason-row"><span>${esc(x.label)}</span><strong>${num(x.value)}</strong></div>`).join('')}</div>`
        :`<div class="up-error-compat"><strong>分类计数异常</strong><span>当前错误总数大于 0，但分类计数均为 0。请检查当前二进制是否提供完整的错误分类指标。</span></div>`)
      :`<div class="up-error-compat"><strong>等待错误分类数据</strong><span>当前错误分类指标不可用；当二进制提供分类指标后，这里会自动显示 Timeout、TLS、SOCKS5、EOF / Reset 等分类。</span></div>`;
    const totalMismatch=m.reasonSupported&&reasonTotal!==Number(m.err||0)?`<div class="up-error-warning">分类合计 ${num(reasonTotal)} 与错误总数 ${num(m.err)} 不一致，请检查后端统计口径。</div>`:'';
    const last=m.lastError?`<div class="up-error-meta-row"><span>最近错误</span><strong>${esc(upstreamErrorTime(m.lastError))}</strong></div>`:'';
    const pop=document.createElement('div'); pop.id='upstream-error-popover'; pop.className='up-error-popover'; pop.setAttribute('role','dialog'); pop.setAttribute('aria-label',`${u.tag} 错误详情`);
    pop.innerHTML=`<div class="up-error-popover-head"><div><strong>${esc(u.tag)} · 错误详情</strong><span>${esc(groupName(g))} · ${esc(u.protocol||'')}</span></div><button type="button" class="up-error-popover-close" aria-label="关闭">×</button></div>${detail}${totalMismatch}<div class="up-error-popover-meta"><div class="up-error-meta-row"><span>总计</span><strong>${num(m.err)}</strong></div>${last}</div><div class="up-error-recent"></div>`;
    document.body.appendChild(pop); pop.querySelector('.up-error-popover-close').onclick=closeUpstreamErrorPopover;
    const recentBox=pop.querySelector('.up-error-recent');
    if(Number(m.err||0)>0) api.json('/api/v1/status').then(st=>{
      const s=(st.upstream_stats||[]).find(x=>x.group===g&&x.tag===u.tag);
      const list=(s&&s.recent_errors)||[];
      if(!list.length) return;
      recentBox.innerHTML=`<div class="up-error-recent-title">最近错误原因</div>${list.map(x=>`<div class="up-error-recent-row"><span>${esc(upstreamErrorTime(x.time))}</span><em>${esc(x.error)}</em></div>`).join('')}`;
    }).catch(()=>{});
    const r=trigger.getBoundingClientRect(),gap=8,pad=12,w=Math.min(340,window.innerWidth-pad*2); pop.style.width=`${w}px`;
    const ph=pop.offsetHeight; let left=Math.min(Math.max(pad,r.left+r.width/2-w/2),window.innerWidth-w-pad); let top=r.bottom+gap;
    if(top+ph>window.innerHeight-pad)top=Math.max(pad,r.top-gap-ph);
    pop.style.left=`${Math.round(left)}px`; pop.style.top=`${Math.round(top)}px`;
    setTimeout(()=>{document.addEventListener('click',upstreamErrorOutsideClick,true);document.addEventListener('keydown',upstreamErrorKeydown,true)},0);
  }


  function navHtml() {
    return `
      <div class="nav-group">
        <div class="nav-group-head"><span>活动</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item active" data-route="overview">
            <svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z"/></svg>
            <span>运行概览</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>观测</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="logs">
            <svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
            <span>查询日志</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>路由</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="upstreams">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>
            <span>DNS 管理</span>
          </button>
          <button type="button" class="nav-item" data-route="rules">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <span>规则管理</span>
          </button>
        </div>
      </div>

      <div class="nav-group">
        <div class="nav-group-head"><span>设置</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></div>
        <div class="nav-items">
          <button type="button" class="nav-item" data-route="management">
            <svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0-4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
            <span>系统管理</span>
          </button>
        </div>
      </div>`;
  }

  function fitRuleLayoutHeight(){
    const layout=$('.rule-layout');
    if(!layout)return;
    if(window.innerWidth<=900){
      layout.style.removeProperty('height');
      layout.style.removeProperty('min-height');
      return;
    }
    const top=layout.getBoundingClientRect().top;
    const available=Math.max(500,Math.floor(window.innerHeight-top-28));
    layout.style.height=`${available}px`;
    layout.style.minHeight='0';
  }

  function initShell(){
    document.title=CONFIG.title; $('#side-nav').innerHTML=navHtml();
    const mobile=[['overview','overview','概览'],['logs','logs','日志'],['upstreams','upstream','DNS'],['rules','rules','规则'],['management','management','管理']];
    $('#mobile-nav').innerHTML=mobile.map(([r,i,l])=>`<button data-route="${r}">${icon(i)}<span>${l}</span></button>`).join('');
    $('#theme-toggle').innerHTML=icon('theme'); $('#refresh-button').innerHTML=icon('refresh'); $('#restart-button').innerHTML=icon('power'); $('#drawer-close').innerHTML=icon('close'); $$('#modal .icon-button').forEach(x=>x.innerHTML=icon('close'));

    // 主题对应的 LocalDNS 品牌图形。
    window.LocalDNSInterface?.updateBrand();
    window.LocalDNSTypography?.setup();
    window.LocalDNSProxyPanel?.setup({notify:toast});

    // 2. 背景与毛玻璃调校器
    const wpLayer = $('#wallpaper-layer');
    const pop = $('#bg-customizer-popover');
    const openBtn = $('#btn-open-bg-customizer');
    if (wpLayer && pop && openBtn) {
      openBtn.onclick = e => {
        e.stopPropagation();
        const isOpen = pop.classList.toggle('open');
        openBtn.setAttribute('aria-expanded', String(isOpen));
      };
      if ($('#btn-close-bg-popover')) {
        $('#btn-close-bg-popover').onclick = () => {
          pop.classList.remove('open');
          openBtn.setAttribute('aria-expanded', 'false');
        };
      }
      document.addEventListener('click', e => {
        if (!pop.contains(e.target) && !e.target.closest('#btn-open-bg-customizer')) {
          pop.classList.remove('open');
          openBtn.setAttribute('aria-expanded', 'false');
        }
      });

      window.LocalDNSWallpaper?.setup({notify:toast});
      if ($('#slider-blur')) {
        $('#slider-blur').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--glass-blur', `${v}px`);
          $('#val-blur').textContent = `${v}px`;
        };
      }
      if ($('#slider-alpha')) {
        $('#slider-alpha').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--glass-alpha', (v / 100).toFixed(2));
          $('#val-alpha').textContent = `${v}%`;
        };
      }
      if ($('#slider-dimmer')) {
        $('#slider-dimmer').oninput = e => {
          const v = e.target.value;
          document.documentElement.style.setProperty('--bg-dimmer', (v / 100).toFixed(2));
          $('#val-dimmer').textContent = `${v}%`;
        };
      }
    }

    // 3. 保留既有粒子偏好；系统减少动画设置始终优先
    state.particles = (storage.get('localdns_particles') ?? storage.get('localdns_particles_v2')) !== 'false';
    const partBtn = $('#btn-toggle-particles');
    if (partBtn) {
      partBtn.classList.toggle('active', state.particles);
      partBtn.setAttribute('aria-pressed', String(state.particles));
      partBtn.onclick = () => {
        state.particles = !state.particles;
        storage.set('localdns_particles', String(state.particles));
        partBtn.classList.toggle('active', state.particles);
        partBtn.setAttribute('aria-pressed', String(state.particles));
        const wrap = $('#topo-stage-wrap');
        if (wrap) {
          wrap.classList.toggle('no-particles', !state.particles);
          window.LocalDNSTopologyFlow?.sync();
        }
      };
    }

    const searchInput = $('#global-search-input');
    if (searchInput) {
      searchInput.onkeydown = e => {
        if (e.key === 'Enter') {
          const q = searchInput.value.trim();
          if (['概览','overview'].includes(q)) return navigate('overview');
          if (['上游','dns','upstreams'].includes(q.toLowerCase())) return navigate('upstreams');
          if (['规则','rules'].includes(q.toLowerCase())) return navigate('rules');
          if (['系统','管理','management'].includes(q.toLowerCase())) return navigate('management');
          state.logs.q = q;
          state.logs.page = 1;
          navigate('logs');
        }
      };
    }

    document.addEventListener('click',e=>{const b=e.target.closest('[data-route]');if(!b)return;navigate(b.dataset.route)});
    $('#refresh-button').onclick=()=>renderRoute(true);
    $('#restart-button').onclick=restartService;
    if (!window.LocalDNSSkin?.toggleTheme) {
      $('#theme-toggle').onclick=()=>{
        const cur=document.documentElement.dataset.theme;
        const next=cur==='light-glass'?'cosmos-glass':'light-glass';
        document.documentElement.dataset.theme=next;
        storage.set('localdnsTheme',next);
        window.LocalDNSInterface?.updateBrand?.();
      };
    }
    window.addEventListener('localdns:skinchange',()=>renderRoute(true,true));
    $('#drawer-close').onclick=closeDrawer; $('#drawer-backdrop').onclick=closeDrawer; $('#modal-close').onclick=modalClose;
    $('#modal').addEventListener('close',()=>{closeSlowTypePopover();$('#modal').classList.remove('overview-detail-modal')});
    // 现代弹窗交互：点击遮罩空白关闭（必须在遮罩上按下再抬起，避免框内拖选误触）
    {
      const modal=$('#modal');let backdropPress=false;
      modal.addEventListener('pointerdown',e=>{backdropPress=e.target===modal});
      modal.addEventListener('click',e=>{if(backdropPress&&e.target===modal)modalClose();backdropPress=false});
      // ESC：统一走 modalClose（含详情样式的清理）；浮层打开时先让浮层自己处理
      modal.addEventListener('cancel',e=>{e.preventDefault();if(!$('#slow-type-popover')&&!$('#upstream-error-popover'))modalClose()});
    }
    // ESC 关侧板；Ctrl/⌘+K 或 / 聚焦全局搜索
    // 滚动条宽度补偿：弹窗/侧板打开时 html 会 overflow:hidden，用 --sbw 顶住内容避免横跳
    {
      const updateSbw=()=>{
        if(document.querySelector('dialog[open]')||document.querySelector('#drawer.open'))return;
        document.documentElement.style.setProperty('--sbw',Math.max(0,window.innerWidth-document.documentElement.clientWidth)+'px');
      };
      updateSbw();window.addEventListener('resize',updateSbw);
    }
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&$('#drawer')&&$('#drawer').classList.contains('open')){closeDrawer();return}
      const ae=document.activeElement;
      const typing=!!ae&&(/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)||ae.isContentEditable);
      if((!typing&&e.key==='/')||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k')){
        const s=$('#global-search-input');
        if(s){e.preventDefault();s.focus();s.select()}
      }
    });
    {
      const s=$('#global-search-input');
      if(s)s.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();if(s.value)s.value='';else s.blur()}});
    }
    document.addEventListener('keydown',e=>{
      if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-copy]')){e.preventDefault();e.target.click();}
    });
    // 动效与微交互：点击后同步分段控件滑块；点击带 data-copy 的内容复制并给行内反馈
    document.addEventListener('click',e=>{
      requestAnimationFrame(syncAllSegThumbs);
      const node=e.target.closest('[data-copy]');
      if(!node)return;
      const text=node.dataset.copy||node.textContent.trim();
      copyToClipboard(text).then(ok=>{
        if(!ok){toast('复制失败','error');return}
        node.classList.add('is-copied');
        setTimeout(()=>node.classList.remove('is-copied'),900);
        toast('已复制','success',text);
      });
    });
    syncAllSegThumbs();
    window.addEventListener('resize',()=>requestAnimationFrame(syncAllSegThumbs));
    window.addEventListener('hashchange',()=>navigate((location.hash.replace(/^#\/?/,'')||'overview'),false));
    window.addEventListener('resize',()=>{if(state.route==='rules')requestAnimationFrame(fitRuleLayoutHeight)});
    window.addEventListener('localdns:layoutchange',()=>{if(state.route==='rules')requestAnimationFrame(fitRuleLayoutHeight)});
    window.addEventListener('unhandledrejection',e=>{const msg=e?.reason?.message||String(e?.reason||'未知错误');toast('操作失败','error',msg);e.preventDefault()});
  }
  function navigate(id,write=true,approved=false){
    if(id==='data'||id==='features')id='management';if(!routeDefs.some(x=>x.id===id))id='overview';
    if(state.route==='proxy-config'&&id==='proxy-config'&&window.LocalDNSProxyConfig?.isDirty())return;
    if(!approved&&state.route==='proxy-config'&&id!==state.route&&!window.LocalDNSProxyConfig?.canLeave(()=>navigate(id,true,true))){if(location.hash!=='#/proxy-config')history.replaceState(null,'','#/proxy-config');return;}
    state.route=id;if(write&&location.hash!==`#/${id}`)history.pushState(null,'',`#/${id}`);renderRoute();
  }
  function updateNav(){ const r=routeDefs.find(x=>x.id===state.route); $('#page-title').textContent=r.label;$('#page-subtitle').textContent=r.subtitle;$$('[data-route]').forEach(x=>x.classList.toggle('active',x.dataset.route===(state.route==='proxy-config'?'management':state.route))); }
  function trackRouteCleanup(fn){state.routeUiCleanup.push(fn)}
  function cleanupRouteUi(){
    const list=state.routeUiCleanup.splice(0);
    list.forEach(fn=>{try{fn()}catch{}});
  }
  // 自动刷新（silent）：不清空页面、不显示“加载中”，新数据取回后原地替换，并保留滚动位置与未提交的输入。
  function viewSnapshot(){
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    const fields=[...page.querySelectorAll('input[id],select[id],textarea[id]')];
    return {
      y:window.scrollY,
      inner:scrollers.map(el=>[el.scrollTop,el.scrollLeft]),
      fields:fields.map(el=>[el.id,el.type==='checkbox'?el.checked:el.value])
    };
  }
  function viewRestore(snap){
    if(!snap)return;
    const el=document.documentElement,prev=el.style.scrollBehavior;
    el.style.scrollBehavior='auto';
    window.scrollTo(0,snap.y);
    el.style.scrollBehavior=prev;
    const scrollers=[...page.querySelectorAll('.rank-list,.table-wrap,.overview-donut-legend,textarea')];
    if(scrollers.length===snap.inner.length)scrollers.forEach((n,i)=>{n.scrollTop=snap.inner[i][0];n.scrollLeft=snap.inner[i][1]});
    snap.fields.forEach(([id,v])=>{const n=document.getElementById(id);if(!n||!page.contains(n))return;if(n.type==='checkbox')n.checked=v;else if(n.value!==v)n.value=v});
  }
  // 浏览器刷新（F5）后恢复滚动位置：页面数据异步加载，加载期间文档很矮，浏览器自带的恢复会失败，
  // 所以自己记下位置（sessionStorage），第一次渲染完成后再滚回去；用户一旦自己滚动就不再强行恢复。
  try{history.scrollRestoration='manual'}catch{}
  let pendingScroll=null;
  try{const v=JSON.parse(sessionStorage.getItem('localdnsScroll')||'null');if(v&&typeof v.route==='string'&&v.y>0)pendingScroll=v}catch{}
  let scrollSaveTimer=0,userScrolled=false;
  const saveScroll=()=>{if(pendingScroll)return;try{sessionStorage.setItem('localdnsScroll',JSON.stringify({route:state.route,y:Math.round(window.scrollY)}))}catch{}};
  window.addEventListener('scroll',()=>{clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(saveScroll,120)},{passive:true});
  window.addEventListener('pagehide',saveScroll);
  for(const ev of ['wheel','touchstart','keydown','mousedown'])window.addEventListener(ev,()=>{userScrolled=true;pendingScroll=null},{passive:true,capture:true});
  function restoreScroll(){
    const want=pendingScroll;
    if(!want)return;
    if(want.route!==state.route){pendingScroll=null;return}
    userScrolled=false;
    const go=()=>{if(userScrolled||pendingScroll!==want)return;window.scrollTo({top:want.y,behavior:'instant'})};
    requestAnimationFrame(()=>requestAnimationFrame(go));
    for(const t of [150,400,900])setTimeout(go,t);
    setTimeout(()=>{if(pendingScroll===want)pendingScroll=null},1200);
  }
  async function renderRoute(force=false,silent=false,approved=false){
    if(state.route==='proxy-config'&&!approved&&window.LocalDNSProxyConfig?.canLeave(()=>renderRoute(force,silent,true))===false)return;
    window.LocalDNSInterface?.rememberDraft();
    cleanupRouteUi();
    window.LocalDNSTopologyFlow?.stop();
    closeUpstreamErrorPopover();
    const seq=(state.renderSeq||0)+1;state.renderSeq=seq;
    if(state.routeController)state.routeController.abort();
    state.routeController=new AbortController();
    const snap=silent?viewSnapshot():null;
    const oldCharts=silent?state.charts.splice(0):null;
    state.silent=silent;
    if(silent){page.style.minHeight=page.offsetHeight+'px'}
    else{destroyCharts();page.style.minHeight=''}
    updateNav(); clearInterval(state.refreshTimer);
    if(!silent)page.innerHTML=loadingPage();
    try {
      const fn={overview:renderOverview,logs:renderLogs,upstreams:renderUpstreams,rules:renderRules,management:renderManagement,'proxy-config':renderProxyConfig}[state.route];
      await fn(force);
      if(seq!==state.renderSeq)return;
      window.LocalDNSInterface?.apply();
      window.LocalDNSWorkspace.finish(page);
      if(!silent){playViewEnter();animateCountUps(page)}
      syncAllSegThumbs();
      state.silent=false;
      viewRestore(snap);
      setApiStatus(true);
    } catch(e){
      if(seq!==state.renderSeq||e?.name==='AbortError')return;
      console.error(e); setApiStatus(false,e.message);
      if(silent){ // 自动刷新失败：保留旧内容，旧图表也留着，只更新连接状态
        if(oldCharts){state.charts=oldCharts.concat(state.charts);oldCharts.length=0}
      } else { page.innerHTML=`<div class="error-panel"><strong>无法加载当前页面</strong><p>${esc(e.message)}</p><button class="button" id="retry-page">${icon('refresh')}重新加载</button></div>`; $('#retry-page').onclick=()=>renderRoute(true);
      }
    }
    if(oldCharts)oldCharts.forEach(c=>{try{c.destroy()}catch{}});
    if(seq!==state.renderSeq)return;
    state.silent=false;
    if(silent)setTimeout(()=>{if(seq===state.renderSeq)page.style.minHeight=''},1500);
    if(!silent)restoreScroll();
    if(['logs','overview'].includes(state.route)){state.refreshTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!busyViewing()&&!(state.route==='logs'&&state.logsPaused))renderRoute(true,true)},CONFIG.refreshInterval*1000)}
  }
  // 正在输入、弹窗或抽屉打开时不自动刷新
  function busyViewing(){
    const a=document.activeElement;
    if(a&&a.closest?.('main')&&['INPUT','TEXTAREA','SELECT'].includes(a.tagName))return true;
    return !!document.querySelector('dialog[open], .drawer.open');
  }
  const loadingPage=()=>`<div class="grid grid-4 metrics-grid-mobile">${[1,2,3,4].map(()=>`<div class="metric-card skeleton" style="height:112px"></div>`).join('')}</div><div class="card skeleton" style="height:340px;margin-top:16px"></div>`;

  function overviewMetricCard(label,value,iconName,tone='primary'){return `<div class="metric-card overview-kpi-card tone-${tone}"><span class="metric-icon">${icon(iconName)}</span><div class="overview-kpi-body"><span class="overview-kpi-label">${esc(label)}</span><div class="metric-value">${value}</div></div></div>`;}
  function card(title,body,{iconName='overview',subtitle='',actions='',className=''}={}){return `<section class="card ${className}"><div class="card-header"><div class="card-title"><span class="icon">${icon(iconName)}</span><div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div><div class="card-actions">${actions}</div></div><div class="card-body">${body}</div></section>`;}
  const empty=(text='暂无数据')=>`<div class="empty-state"><div><div class="empty-icon">${icon('info')}</div><strong>${esc(text)}</strong></div></div>`;
  function rankRows(items,formatter=(x)=>x.key,limit=10){
    if(!items?.length)return empty();
    // Keep compact rankings at their historical limit, but allow the domain ranking
    // to render every row returned by the API. The viewport remains bounded and scrollable.
    const list=Number.isFinite(limit)?items.slice(0,Math.max(0,limit)):items.slice();
    const max=Math.max(1,...list.map(x=>+x.count||0));
    return `<div class="rank-list">${list.map((x,i)=>{const width=Math.max(4,Math.min(100,(+x.count||0)/max*100));return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${i+1}</span><span class="rank-name" title="${esc(formatter(x))}">${esc(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`}).join('')}</div>`;
  }

  function slowTypeLabel(v){
    const raw=String(v??'—').trim().toUpperCase();
    if(raw==='65')return 'HTTPS';
    if(raw==='64')return 'SVCB';
    return raw||'—';
  }
  function slowTypeSort(a,b){
    const order={A:0,AAAA:1,HTTPS:2,SVCB:3};
    const aa=order[a]??50,bb=order[b]??50;
    return aa-bb||a.localeCompare(b);
  }
  function aggregateSlowest(items,limit=10){
    const groups=new Map();
    for(const x of items||[]){
      const domain=String(x?.query_name||'—');
      const client=String(x?.client_ip||'—');
      const key=`${domain.toLowerCase()}\u0000${client}`;
      const duration=Number.isFinite(+x?.duration_ms)?+x.duration_ms:0;
      const type=slowTypeLabel(x?.query_type);
      let g=groups.get(key);
      if(!g){g={query_name:domain,client_ip:client,duration_ms:duration,types:new Map()};groups.set(key,g)}
      if(duration>g.duration_ms){g.duration_ms=duration;g.query_name=domain}
      const prev=g.types.get(type);
      if(!prev||duration>prev.duration_ms)g.types.set(type,{type,duration_ms:duration});
    }
    return [...groups.values()].sort((a,b)=>b.duration_ms-a.duration_ms||a.query_name.localeCompare(b.query_name)).slice(0,limit);
  }
  function slowTypeSummaryHtml(g,index){
    const types=[...g.types.keys()].sort(slowTypeSort),shown=types.slice(0,2);
    // Keep the Type column compact: display at most two QTYPEs.
    // Any additional types remain available in the click-through detail popover.
    const label=shown.map(esc).join(' · ');
    if(types.length<=1)return `<span class="slow-type-single">${label}</span>`;
    return `<button type="button" class="slow-type-detail-trigger" data-slow-group="${index}" aria-haspopup="dialog" title="点击查看全部类型耗时">${label}</button>`;
  }
  function slowTypeDetailRows(g){
    return [...g.types.values()].sort((a,b)=>b.duration_ms-a.duration_ms||slowTypeSort(a.type,b.type));
  }
  const OVERVIEW_SLOW_PAGE_SIZE=10;
  const OVERVIEW_DOMAIN_PAGE_SIZE=10;
  function slowPageRowsHtml(groups,page){
    const totalPages=Math.max(1,Math.ceil((groups?.length||0)/OVERVIEW_SLOW_PAGE_SIZE));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*OVERVIEW_SLOW_PAGE_SIZE;
    return (groups||[]).slice(start,start+OVERVIEW_SLOW_PAGE_SIZE).map((g,local)=>{
      const i=start+local;
      return `<tr class="slow-main-row" data-slow-group="${i}"><td>${esc(g.query_name)}</td><td>${slowTypeSummaryHtml(g,i)}</td><td>${esc(state.aliases[g.client_ip]||g.client_ip)}</td><td><span class="latency-chip ${+g.duration_ms>500?'bad':''}">${ms(g.duration_ms)}</span></td></tr>`;
    }).join('');
  }
  function domainPageRowsHtml(items,page,formatter=(x)=>x.key){
    if(!items?.length)return '';
    const totalPages=Math.max(1,Math.ceil(items.length/OVERVIEW_DOMAIN_PAGE_SIZE));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*OVERVIEW_DOMAIN_PAGE_SIZE;
    const max=Math.max(1,...items.map(x=>+x.count||0));
    return items.slice(start,start+OVERVIEW_DOMAIN_PAGE_SIZE).map((x,local)=>{
      const width=Math.max(4,Math.min(100,(+x.count||0)/max*100));
      return `<div class="rank-row" style="--rank:${width.toFixed(2)}%"><span class="rank-meter"></span><span class="rank-index">${start+local+1}</span><span class="rank-name" title="${esc(formatter(x))}">${esc(formatter(x))}</span><span class="rank-value">${num(x.count)}</span></div>`;
    }).join('');
  }
  function closeSlowTypePopover(){
    const pop=$('#slow-type-popover');if(pop)pop.remove();
    document.removeEventListener('click',slowTypeOutsideClick,true);
    document.removeEventListener('keydown',slowTypeKeydown,true);
  }
  function slowTypeOutsideClick(e){const pop=$('#slow-type-popover');if(pop&&!pop.contains(e.target)&&!e.target.closest('.slow-type-detail-trigger'))closeSlowTypePopover()}
  function slowTypeKeydown(e){if(e.key==='Escape')closeSlowTypePopover()}
  function openSlowTypePopover(trigger,g){
    closeSlowTypePopover();
    const rows=slowTypeDetailRows(g);
    const pop=document.createElement('div');pop.id='slow-type-popover';pop.className='slow-type-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label',`${g.query_name} 查询类型耗时`);
    pop.innerHTML=`<div class="slow-type-popover-head"><strong>类型耗时</strong><button type="button" class="slow-type-popover-close" aria-label="关闭">×</button></div><div class="slow-type-popover-list">${rows.map(x=>`<div class="slow-type-popover-row"><span>${esc(x.type)}</span><strong>${ms(x.duration_ms)}</strong></div>`).join('')}</div>`;
    document.body.appendChild(pop);pop.querySelector('.slow-type-popover-close').onclick=closeSlowTypePopover;
    const r=trigger.getBoundingClientRect(),gap=7,pad=12,w=Math.min(220,window.innerWidth-pad*2);pop.style.width=`${w}px`;
    const ph=pop.offsetHeight;let left=Math.min(Math.max(pad,r.left+r.width/2-w/2),window.innerWidth-w-pad),top=r.bottom+gap;
    if(top+ph>window.innerHeight-pad)top=Math.max(pad,r.top-gap-ph);
    pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;
    setTimeout(()=>{document.addEventListener('click',slowTypeOutsideClick,true);document.addEventListener('keydown',slowTypeKeydown,true)},0);
  }


  const OVERVIEW_DETAIL_PAGE_SIZE=20;
  function detailPagerHtml(page,totalItems,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((totalItems||0)/pageSize));
    const cur=Math.max(0,Math.min(totalPages-1,page||0));
    const pages=[];
    const start=Math.max(0,Math.min(totalPages-5,cur-2));
    for(let i=start;i<Math.min(totalPages,start+5);i++)pages.push(i);
    return `<div class="overview-detail-footer"><span class="overview-detail-count">第 ${cur+1} / ${totalPages} 页 · 共 ${num(totalItems||0)} 条</span><div class="overview-detail-pagination"><button type="button" data-detail-page="${cur-1}" ${cur<=0?'disabled':''}>‹</button>${pages.map(i=>`<button type="button" data-detail-page="${i}" class="${i===cur?'active':''}">${i+1}</button>`).join('')}<button type="button" data-detail-page="${cur+1}" ${cur>=totalPages-1?'disabled':''}>›</button></div></div>`;
  }
  function slowDetailRowsHtml(groups,page,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((groups?.length||0)/pageSize));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*pageSize;
    return (groups||[]).slice(start,start+pageSize).map((g,local)=>{
      const i=start+local;
      const types=[...g.types.keys()].sort(slowTypeSort).map(esc).join(' · ')||'—';
      return `<tr><td class="overview-detail-rank">${i+1}</td><td class="overview-detail-domain" title="${esc(g.query_name)}">${esc(g.query_name)}</td><td class="overview-detail-types" title="${types}">${types}</td><td class="overview-detail-client" title="${esc(state.aliases[g.client_ip]||g.client_ip)}">${esc(state.aliases[g.client_ip]||g.client_ip)}</td><td class="overview-detail-latency"><span class="latency-chip ${+g.duration_ms>500?'bad':''}">${ms(g.duration_ms)}</span></td></tr>`;
    }).join('');
  }
  function domainDetailRowsHtml(items,page,pageSize=OVERVIEW_DETAIL_PAGE_SIZE){
    const totalPages=Math.max(1,Math.ceil((items?.length||0)/pageSize));
    const safe=Math.max(0,Math.min(totalPages-1,page||0));
    const start=safe*pageSize;
    const max=Math.max(1,...(items||[]).map(x=>+x.count||0));
    return (items||[]).slice(start,start+pageSize).map((x,local)=>{
      const rank=start+local+1,count=+x.count||0,width=Math.max(3,Math.min(100,count/max*100));
      return `<tr><td class="overview-detail-rank">${rank}</td><td class="overview-detail-domain" title="${esc(x.key||'—')}">${esc(x.key||'—')}</td><td class="overview-detail-count-cell"><span>${num(count)}</span><i style="--detail-rank:${width.toFixed(2)}%"></i></td></tr>`;
    }).join('');
  }
  function openSlowDetailModal(groups){
    let current=0;
    const render=()=>{
      const body=groups?.length?`<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-slow-table"><thead><tr><th>#</th><th>域名</th><th>类型</th><th>客户端</th><th>耗时</th></tr></thead><tbody>${slowDetailRowsHtml(groups,current)}</tbody></table></div>${detailPagerHtml(current,groups.length)}`:empty('暂无最慢查询数据');
      $('#modal-content').innerHTML=body;
      $$('#modal-content [data-detail-page]').forEach(btn=>btn.onclick=()=>{const next=+btn.dataset.detailPage;if(Number.isFinite(next)&&next!==current){current=next;render();$('#modal-content').scrollTop=0}});
    };
    modalOpen('最慢查询详情',`每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, '',null,false);
    $('#modal').classList.add('overview-detail-modal');
    render();
  }
  function openDomainDetailModal(items){
    let current=0;
    const render=()=>{
      const body=items?.length?`<div class="overview-detail-table-wrap"><table class="overview-detail-table overview-detail-domain-table"><thead><tr><th>#</th><th>域名</th><th>查询次数</th></tr></thead><tbody>${domainDetailRowsHtml(items,current)}</tbody></table></div>${detailPagerHtml(current,items.length)}`:empty('暂无域名排行数据');
      $('#modal-content').innerHTML=body;
      $$('#modal-content [data-detail-page]').forEach(btn=>btn.onclick=()=>{const next=+btn.dataset.detailPage;if(Number.isFinite(next)&&next!==current){current=next;render();$('#modal-content').scrollTop=0}});
    };
    modalOpen('域名排行详情',`每页 ${OVERVIEW_DETAIL_PAGE_SIZE} 条，整页翻页`, '',null,false);
    $('#modal').classList.add('overview-detail-modal');
    render();
  }

  function getNodeIcon(type, color = 'currentColor') {
    const map = {
      monitor: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>`,
      server: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="${color}"/><circle cx="7" cy="17" r="1" fill="${color}"/></svg>`,
      dots: `<svg viewBox="0 0 24 24" fill="${color}" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>`,
      globe: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
      check: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
      split: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5V12a6 6 0 0 0 6 6h3.5"/></svg>`,
      spark: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/></svg>`,
      shield: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
      shieldRed: `<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="1.9" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg>`,
      sliders: `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" aria-hidden="true"><path d="M4 8h9m4 0h3M13 6v4M4 16h3m4 0h9M7 14v4"/></svg>`
    };
    return map[type] || map.monitor;
  }

  function drawTopoCurves(edges) {
    const wrap = document.getElementById('topo-stage-wrap');
    const svg = document.getElementById('topo-svg');
    if (!wrap || !svg) return;
    window.LocalDNSTopologyFlow?.stop();

    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;
    svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);

    let pathsHtml = '', dotsHtml = '';
    const dotSet = new Set();
    const addDot = (x, y, color) => {
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (dotSet.has(key)) return;
      dotSet.add(key);
      dotsHtml += `<circle class="topo-dot-halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" /><circle class="topo-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" fill="${color}" />`;
    };

    // Keep the release's center-to-center geometry; the glow is a separate visual layer.
    edges.forEach((edge, i) => {
      const fromEl = wrap.querySelector(`[data-node-id="${edge.from}"]`);
      const toEl = wrap.querySelector(`[data-node-id="${edge.to}"]`);
      if (!fromEl || !toEl) return;
      const r1 = fromEl.getBoundingClientRect(), r2 = toEl.getBoundingClientRect();
      const x1 = r1.right - wrapRect.left, y1 = r1.top + r1.height / 2 - wrapRect.top;
      const x2 = r2.left - wrapRect.left, y2 = r2.top + r2.height / 2 - wrapRect.top;
      const dx = (x2 - x1) * 0.54;
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (!edge.muted) {
        pathsHtml += `<path class="topo-halo" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" /><path class="topo-glow" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
        pathsHtml += `<path class="topo-particle" data-part-idx="${i}" d="${d}" stroke="${edge.color}" />`;
      }
      pathsHtml += `<path class="topo-edge ${edge.muted ? 'is-muted' : ''}" data-edge-idx="${i}" d="${d}" stroke="${edge.color}" />`;
      addDot(x1, y1, edge.color);
      addDot(x2, y2, edge.color);
    });
    svg.innerHTML = pathsHtml + dotsHtml;

    const nodes = wrap.querySelectorAll('.t-node');
    const applyTraceState = (startId = null) => {
      startId = state.overviewTopoLock || startId;
      const activeNodes = new Set(startId ? [startId] : []);
      const activeEdges = new Set();
      // Walk each direction independently so a selected branch doesn't light up its siblings.
      for (const upstream of [true, false]) {
        const queue = startId ? [startId] : [];
        while (queue.length) {
          const cur = queue.shift();
          edges.forEach((edge, idx) => {
            if ((upstream ? edge.to : edge.from) !== cur) return;
            const next = upstream ? edge.from : edge.to;
            activeEdges.add(idx);
            if (!activeNodes.has(next)) { activeNodes.add(next); queue.push(next); }
          });
        }
      }
      wrap.classList.toggle('has-hover', Boolean(startId));
      nodes.forEach(n => n.classList.toggle('is-active', activeNodes.has(n.dataset.nodeId)));
      svg.querySelectorAll('[data-edge-idx]').forEach(el => el.classList.toggle('is-active', activeEdges.has(+el.dataset.edgeIdx)));
      svg.querySelectorAll('[data-part-idx]').forEach(el => el.classList.toggle('is-active', activeEdges.has(+el.dataset.partIdx)));
    };
    const focusedId = () => wrap.contains(document.activeElement) ? document.activeElement.closest('.t-node')?.dataset.nodeId : null;
    nodes.forEach(node => {
      node.onmouseenter = () => applyTraceState(node.dataset.nodeId);
      node.onmouseleave = () => applyTraceState(focusedId());
      node.onfocus = () => applyTraceState(node.dataset.nodeId);
      node.onblur = event => applyTraceState(event.relatedTarget?.closest('.t-node')?.dataset.nodeId || wrap.querySelector('.t-node:hover')?.dataset.nodeId);
    });
    applyTraceState(focusedId() || wrap.querySelector('.t-node:hover')?.dataset.nodeId);
    window.LocalDNSTopologyFlow?.start(wrap, svg, edges);
  }

  async function renderOverview(){
    await loadAliases().catch(()=>{});
    const switchTags = ['switch1','switch5','switch7','switch6','switch13','switch4','switch2','switch12'];
    const [stats,domains,clients,slowest,sets,metricsRaw,engineStatus,upCfg,switchVals] = await Promise.all([
      api.stats(),
      api.rank('domain',1000),
      api.rank('client',1000),
      api.rank('slowest',1000),
      api.rank('domain_set',64),
      api.metrics(),
      safe(()=>api.request('/api/v1/status'),{}),
      safe(()=>api.request('/api/v1/upstream/config'),{}),
      Promise.all(switchTags.map(t=>safe(()=>api.request(`/plugins/${t}/show`),'B')))
    ]);
    const sw = Object.fromEntries(switchTags.map((t,i)=>[t, String(switchVals[i]||'').trim().toUpperCase()]));
    const enabledCount = Object.values(sw).filter(v => v === 'A').length;

    const metrics = parseProm(metricsRaw), sys = parseSystem(metrics), caches = parseCaches(metrics);
    // 品牌区版本标签按外观设置显示（hidden/custom 时不覆盖用户选择）
    if (sys.version && $('#brand-version-tag')) $('#brand-version-tag').dataset.backendVersion = sys.version;
    if (sys.version && $('#brand-version-tag') && (document.documentElement.dataset.brandVerMode || 'version') === 'version') $('#brand-version-tag').textContent = sys.version;

    // 更新右下角实时状态胶囊
    if ($('#float-stat-top')) $('#float-stat-top').textContent = `↑ 累计 ${compactNum(stats.total_queries)} 次`;
    if ($('#float-stat-bot')) $('#float-stat-bot').textContent = `↓ ${ms(stats.average_duration_ms)}`;

    const cacheDisabled = sw.switch13 === 'B';
    const lazyEnabled   = sw.switch4 === 'A';
    const cMain = caches.find(x=>x.tag==='cache_main') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cDom  = caches.find(x=>x.tag==='cache_domestic') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cFor  = caches.find(x=>x.tag==='cache_foreign') || {hit:0,lazy:0,q:0,h:0,size:0};
    const cEcs  = caches.find(x=>x.tag==='cache_foreign_ecs') || {hit:0,lazy:0,q:0,h:0,size:0};

    const totalCacheQ = caches.reduce((s,c)=>s+(c.q||0),0);
    const totalCacheH = caches.reduce((s,c)=>s+(c.h||0),0);
    const overallHitRate = cMain.q > 0 ? cMain.hit : (totalCacheQ > 0 ? (totalCacheH / totalCacheQ * 100) : 0);
    const cacheValue = cacheDisabled ? '已关闭' : pct(overallHitRate);

    const now = Date.now();
    let cpuPct = sys.uptime > 0 ? Math.max(0, sys.cpu / sys.uptime * 100) : 0;
    if (state.lastCpuTotal != null && state.lastCpuAt != null && sys.cpu >= state.lastCpuTotal && now > state.lastCpuAt) {
      cpuPct = Math.max(0, (sys.cpu - state.lastCpuTotal) / ((now - state.lastCpuAt) / 1000) * 100);
    }
    state.lastCpuTotal = sys.cpu; state.lastCpuAt = now;

    const adguardBlocked = Math.max(0, +engineStatus?.stats?.adguard_blocked || 0);
    const clientCount = Number.isFinite(+stats?.client_count) ? fullNum(+stats.client_count) : rankCount(clients);
    const domainCount = Number.isFinite(+stats?.domain_count) ? fullNum(+stats.domain_count) : rankCount(domains);
    window.LocalDNSInterface?.recordMetrics({total:metrics.find(x=>x.name==='localdns_queries_total')?.value,latency:stats.average_duration_ms,cache:overallHitRate,cacheEnabled:!cacheDisabled,clients:stats.client_count??clients.length,domains:stats.domain_count??domains.length,blocked:adguardBlocked,start:sys.start});
    const allSets = (sets || []).filter(x => x && x.count > 0);
    const ds = allSets.length > 4 ? [...allSets.slice(0,3), {key:'其他',count:allSets.slice(3).reduce((sum,x)=>sum+(+x.count||0),0)}] : allSets;
    const slowGroups = aggregateSlowest(slowest, Infinity);

    // 客户端分流策略状态（对应真实 switch2 / switch12）
    const clientMode = sw.switch2 === 'A' ? 'fakeip' : (sw.switch12 === 'A' ? 'realip' : 'all');

    // === 构造五阶段全链路拓扑真实数据 ===
    const totalQ = Math.max(1, +stats.total_queries || 0);
    // Aliases only name recorded clients; never add inactive aliases as topology nodes.
    const topoClients = window.LocalDNSClients.topology(clients, state.aliases, stats.total_queries, compactNum);

    // 03 分流规则集（6 节点：对应真实 /api/v1/status rules 与 stats）
    const isClaude = document.documentElement.dataset.skin === 'claude';
    const rRules = engineStatus?.rules || {};
    const eStats = engineStatus?.stats || {};
    const topoRules = [
      { id: 'r1', tab: 'diversion', name: 'geosite_cn', sub: `国内大陆域名直连 · ${num(rRules.geosite_cn || 0)} 条规则`, val: compactNum(eStats.domestic || 0), iconColor: isClaude ? '#2D6A4F' : '#10B981', icon: 'globe' },
      { id: 'r2', tab: 'lists', name: 'whitelist / custom_cn', sub: `白名单与自定义国内 · ${num(rRules.force_domestic || 0)} 条规则`, val: `${num(rRules.force_domestic || 0)} 条`, iconColor: isClaude ? '#C96442' : '#60A5FA', icon: 'check' },
      { id: 'r3', tab: 'diversion', name: 'geosite_non_cn', sub: `海外无污染分流 · ${num(rRules.geosite_non_cn || 0)} 条规则`, val: compactNum((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0)), iconColor: isClaude ? '#3D6B66' : '#14B8A6', icon: 'split' },
      { id: 'r4', tab: 'lists', name: 'force_fakeip / 灰名单', sub: `FakeIP 分流映射 · ${num(rRules.force_foreign_fakeip || 0)} 条规则`, val: compactNum(eStats.fakeip || 0), iconColor: isClaude ? '#B45309' : '#F59E0B', icon: 'spark' },
      { id: 'r5', tab: 'adguard', name: 'adguard_block', sub: `广告与追踪器拦截 · ${num(engineStatus?.adguard_rules || 0)} 条规则`, val: compactNum(adguardBlocked), iconColor: isClaude ? '#B91C1C' : '#EF4444', icon: 'shield' },
      { id: 'r6', tab: 'lists', name: 'block / 特殊类型清洗', sub: `黑名单与类型抑制 · ${num(rRules.block || 0)} 条规则`, val: compactNum(eStats.blocked || 0), iconColor: isClaude ? '#857F74' : '#94A3B8', icon: 'sliders' }
    ];

    // 提取真实配置的上游列表及性能指标
    const groupUpstreams = {};
    ['domestic', 'foreign', 'foreign_ecs', 'proxy'].forEach(g => {
      const list = (upCfg?.[g] || []).map(u => ({ g, u, m: upstreamMetrics(metrics, g, u.tag) }));
      groupUpstreams[g] = list;
    });
    const groupAvgMs = g => {
      const active = (groupUpstreams[g] || []).filter(x => x.u.enabled !== false && x.m.latency > 0);
      if (!active.length) return '就绪';
      const avg = active.reduce((s, x) => s + x.m.latency, 0) / active.length;
      return `${avg.toFixed(1)} ms`;
    };

    // 04 上游策略组（5 节点：对应真实 domestic / foreign / foreign_ecs / proxy / 拦截）
    const topoGroups = [
      { id: 'g1', code: 'CN', codeColor: isClaude ? '#2D6A4F' : '#34D399', codeBg: isClaude ? 'rgba(45,106,79,0.12)' : 'rgba(16,185,129,0.14)', name: '国内组 (domestic)', sub: `并发竞速 · ${groupAvgMs('domestic')} · ${num(eStats.domestic || 0)} 次` },
      { id: 'g2', code: 'GL', codeColor: isClaude ? '#3D6B66' : '#2DD4BF', codeBg: isClaude ? 'rgba(61,107,102,0.12)' : 'rgba(20,184,166,0.14)', name: '国外组 (foreign)', sub: `无污染解析 · ${groupAvgMs('foreign')} · ${num(eStats.foreign || 0)} 次` },
      { id: 'g3', code: 'ECS', codeColor: isClaude ? '#C96442' : '#93C5FD', codeBg: isClaude ? 'rgba(201,100,66,0.12)' : 'rgba(59,130,246,0.16)', name: '国外 ECS (foreign_ecs)', sub: `EDNS 子网 · ${groupAvgMs('foreign_ecs')} · ${num(eStats.foreign_ecs || 0)} 次` },
      { id: 'g4', code: 'PX', codeColor: isClaude ? '#B45309' : '#FBBF24', codeBg: isClaude ? 'rgba(180,83,9,0.12)' : 'rgba(245,158,11,0.15)', name: '代理组 (proxy)', sub: `远端解析 · ${groupAvgMs('proxy')} · ${num(eStats.fakeip || 0)} 次` },
      { id: 'g5', code: 'BLK', codeColor: isClaude ? '#B91C1C' : '#F87171', codeBg: isClaude ? 'rgba(185,28,28,0.12)' : 'rgba(239,68,68,0.15)', name: '本地拦截黑洞', sub: `0.0.0.0 / NXDOMAIN · ${num(eStats.blocked || 0)} 拦截` }
    ];

    // 05 上游 DNS 节点（6 节点：5 个真实上游 DNS + 第 6 个拦截直接响应节点）
    const allRealUps = [
      ...(groupUpstreams.domestic || []),
      ...(groupUpstreams.foreign || []),
      ...(groupUpstreams.foreign_ecs || []),
      ...(groupUpstreams.proxy || [])
    ].sort((a, b) => Number(b.u.enabled !== false) - Number(a.u.enabled !== false) || (b.m.win - a.m.win));

    // 优先保证国内、国外、ECS、代理各选代表节点展示在拓扑第 05 列
    const pickedUps = [];
    const pickFrom = (g, count) => {
      const candidates = (groupUpstreams[g] || []).slice().sort((a,b)=>Number(b.u.enabled!==false)-Number(a.u.enabled!==false)||(b.m.win-a.m.win));
      candidates.slice(0, count).forEach(x => { if (pickedUps.length < 5) pickedUps.push(x); });
    };
    pickFrom('domestic', 2);
    pickFrom('foreign', 1);
    pickFrom('foreign_ecs', 1);
    pickFrom('proxy', 1);
    allRealUps.forEach(x => { if (pickedUps.length < 5 && !pickedUps.includes(x)) pickedUps.push(x); });

    const groupToNodeId = { domestic: 'g1', foreign: 'g2', foreign_ecs: 'g3', proxy: 'g4' };
    const topoServers = pickedUps.map((item, idx) => {
      const { g, u, m } = item;
      const latTxt = m.latency > 0 ? `${m.latency.toFixed(1)} ms` : (u.enabled !== false ? '在线' : '未启用');
      const badgeTxt = m.q > 0 ? `${Math.round(m.adoption)}% 采纳` : (u.protocol || 'UDP').toUpperCase();
      const colorMap = isClaude ? {
        domestic: ['#2D6A4F', 'rgba(45,106,79,0.12)'],
        foreign: ['#3D6B66', 'rgba(61,107,102,0.12)'],
        foreign_ecs: ['#C96442', 'rgba(201,100,66,0.12)'],
        proxy: ['#B45309', 'rgba(180,83,9,0.12)']
      } : {
        domestic: ['#34D399', 'rgba(16,185,129,0.15)'],
        foreign: ['#2DD4BF', 'rgba(20,184,166,0.15)'],
        foreign_ecs: ['#93C5FD', 'rgba(59,130,246,0.16)'],
        proxy: ['#FBBF24', 'rgba(245,158,11,0.16)']
      };
      const [badgeColor, badgeBg] = colorMap[g] || ['#CBD5E1', 'rgba(148,163,184,0.14)'];
      return {
        id: `s${idx+1}`,
        groupNode: groupToNodeId[g] || 'g1',
        name: u.tag || `Upstream-${idx+1}`,
        sub: `${u.addr || u.server_addr || '—'} · ${latTxt}`,
        badge: badgeTxt,
        badgeColor,
        badgeBg,
        icon: 'server',
        muted: u.enabled === false
      };
    });
    topoServers.push({
      id: 's6',
      groupNode: 'g5',
      name: '拦截直接响应',
      sub: '零上游消耗 · 立即阻断',
      badge: `${compactNum(eStats.blocked || 0)} 阻断`,
      badgeColor: isClaude ? '#B91C1C' : '#F87171',
      badgeBg: isClaude ? 'rgba(185,28,28,0.12)' : 'rgba(239,68,68,0.16)',
      icon: 'shieldRed'
    });

    const cPrimary = isClaude ? '#C96442' : '#3B82F6';
    const cTeal = isClaude ? '#2D6A4F' : '#14B8A6';
    const cAmber = isClaude ? '#B45309' : '#F59E0B';
    const cGreen = isClaude ? '#2D6A4F' : '#10B981';
    const topoEdges = [
      ...topoClients.filter(c => !c.muted).map(c => [c.id, 'e_core', cPrimary]),

      ['e_core', 'r1', cTeal],
      ['e_core', 'r2', cPrimary],
      ['e_core', 'r3', cTeal],
      ['e_core', 'r4', cAmber],
      ['e_core', 'r5', cTeal],
      ['e_core', 'r6', cTeal],

      ['r1', 'g1', cTeal],
      ['r2', 'g1', cTeal],
      ['r3', 'g2', cTeal],
      ['r3', 'g3', cPrimary],
      ['r4', 'g4', cAmber],
      ['r5', 'g5', cTeal],
      ['r6', 'g5', cTeal],

      ...topoServers.map(s => [s.groupNode, s.id, cGreen])
    ].map(([from, to, color]) => ({
      from, to, color,
      muted: Boolean(topoClients.find(c => c.id === from)?.muted || topoServers.find(s => s.id === to)?.muted)
    }));

    // 分流结果占比环形图数据（基于真实 domain_set 排行 ds）
    const dsTotal = Math.max(1, ds.reduce((n, x) => n + (+x.count || 0), 0));
    const ringColors = isClaude
      ? ['#C96442', '#2D6A4F', '#B45309', '#3D6B66', '#B91C1C']
      : ['#2563EB', '#10B981', '#F59E0B', '#14B8A6', '#EF4444'];
    let dashOffset = 25;
    const ringCircles = ds.slice(0, 4).map((x, i) => {
      const pctVal = Math.max(0, Math.min(100, (+x.count || 0) / dsTotal * 100));
      const circle = `<circle cx="21" cy="21" r="15.915" fill="transparent" stroke="${ringColors[i%ringColors.length]}" stroke-width="4.8" stroke-dasharray="${pctVal.toFixed(1)} ${(100 - pctVal).toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"></circle>`;
      dashOffset -= pctVal;
      return circle;
    }).join('');

    const rankTab = state.overviewRankTab || 'client';
    const rankItems = (rankTab === 'client' ? (clients || []) : (domains || [])).slice(0, 4);
    const rankMax = Math.max(1, ...rankItems.map(x => +x.count || 0));

    page.innerHTML = `
      <div class="view-title-row">
        <div style="display:flex;align-items:baseline;gap:12px">
          <h1>运行概览</h1>
          <span class="mono" style="font-size:12px;color:var(--text-3)">${esc([sys.version || engineStatus?.version || 'FJG20', sys.platform, sys.runtime !== '—' ? sys.runtime : ''].filter(Boolean).join(' · '))}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="glass-btn" id="btn-overview-custom-bg">自定义壁纸与玻璃</button>
        </div>
      </div>

      <section class="console-service-summary" aria-labelledby="service-summary-title">
        <div class="console-service-row">
          <div class="console-service-health">
            <span class="service-health-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path data-service-check d="m7 12 3 3 7-7"/></svg></span>
            <div class="service-health-copy">
              <div class="service-health-title"><h2 id="service-summary-title">DNS 服务运行中</h2><span class="service-connection">已连接</span></div>
              <p class="service-build mono">${esc([sys.version || engineStatus?.version || 'FJG20', sys.platform, sys.runtime !== '—' ? sys.runtime : ''].filter(Boolean).join(' · '))}</p>
            </div>
          </div>
          <div class="service-metric" data-service-metric="start"><div class="service-metric-label"><span>启动时间</span>${icon('clock')}</div><div class="service-value service-start-value">${startTimeMarkup(sys.start)}</div></div>
          <div class="service-metric" data-service-metric="uptime"><div class="service-metric-label"><span>运行时长</span>${icon('uptime')}</div><div class="service-value service-uptime-value">${sys.start?overviewUptimeMarkup(sys.uptime):'—'}</div></div>
          <div class="service-metric" data-service-metric="cpu"><div class="service-metric-label"><span>进程 CPU</span>${icon('cpu')}</div><div class="service-value" data-display-number>${metrics.some(m=>m.name==='process_cpu_seconds_total')?cpuPct.toFixed(1)+'%':'—'}</div></div>
          <div class="service-metric" data-service-metric="memory"><div class="service-metric-label"><span>内存占用</span>${icon('memory')}</div><div class="service-value" data-display-number>${metrics.some(m=>m.name==='process_resident_memory_bytes')?fmtBytesBrief(sys.rss):'—'}</div></div>
        </div>
      </section>

      <!-- 第一层：3 张等宽快捷控制条 (4 + 4 + 4 = 12列)，100% 绑定 LocalDNS 真实功能 -->
      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>
            <span>客户端分流</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="客户端分流策略">
              <button type="button" class="seg-item ${clientMode==='all'?'active':''}" data-client-mode="all" title="所有客户端均按分流规则正常解析">全员分流</button>
              <button type="button" class="seg-item ${clientMode==='fakeip'?'active':''}" data-client-mode="fakeip" title="switch2：只允许指定客户端科学">指定 FakeIP</button>
              <button type="button" class="seg-item ${clientMode==='realip'?'active':''}" data-client-mode="realip" title="switch12：指定客户端不允许科学">指定 RealIP</button>
            </div>
            <button type="button" class="glass-btn" id="manage-alias">别名</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span>缓存与过期</span>
          </div>
          <div class="cb-right">
            <div class="seg-group" role="group" aria-label="缓存功能开关">
              <button type="button" class="seg-item ${!cacheDisabled?'active':''}" id="btn-toggle-switch13" title="点击切换核心缓存 (switch13)">核心缓存 ${!cacheDisabled?'开':'关'}</button>
              <button type="button" class="seg-item ${lazyEnabled?'active':''}" id="btn-toggle-switch4" title="点击切换乐观过期缓存 (switch4)">过期缓存 ${lazyEnabled?'开':'关'}</button>
            </div>
            <button type="button" class="glass-btn" id="btn-flush-all-cache">清空</button>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card control-bar-card">
          <div class="cb-label">
            <span class="dot-online" aria-hidden="true"></span>
            <span style="color:var(--text-1);font-weight:600">运行中 · ${duration(sys.uptime)}</span>
          </div>
          <div class="cb-right">
            <button type="button" class="glass-btn" id="btn-toggle-switch7" title="点击切换 AdGuard 广告屏蔽 (switch7)">AdGuard ${sw.switch7==='A'?'已开启':'已关闭'}</button>
            <span style="font-size:12px;color:var(--text-2);cursor:pointer" data-route="management">${enabledCount}/8 项开启 ›</span>
          </div>
        </div>
      </div>

      <!-- 第二层：6 张等宽微趋势指标卡 (2 × 6 = 12列)，100% 对应 LocalDNS 6 大真实指标 -->
      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="logs">
          <div class="sk-top"><span class="sk-title">累计请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2" aria-hidden="true"><path d="M12 3v14m0 0-4-4m4 4 4-4M4 21h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${num(stats.total_queries)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${cacheDisabled ? '缓存已关闭' : '缓存命中占 ' + pct(overallHitRate)}</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="management">
          <div class="sk-top"><span class="sk-title">缓存命中</span><svg viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" aria-hidden="true"><path d="M12 21V7m0 0-4 4m4-4 4 4M4 3h16"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${cacheValue}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${caches.filter(c => (+c.q || 0) > 0).length} 个活跃缓存池</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-clients">
          <div class="sk-top"><span class="sk-title">客户端数</span><svg viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${clientCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">活跃来源 IP</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="rules">
          <div class="sk-top"><span class="sk-title">拦截请求</span><svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" aria-hidden="true"><path d="M12 3 4 7v5c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V7l-8-4Z"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${fullNum(adguardBlocked)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">${pct(totalQ > 0 ? (adguardBlocked / totalQ) * 100 : 0)} 的请求被拦截</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" data-route="upstreams">
          <div class="sk-top"><span class="sk-title">平均响应</span><svg viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular" style="color:#F59E0B">${ms(stats.average_duration_ms)}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">当前浏览器会话采样</div>
        </div>
      </div>

      <div class="col-2">
        <div class="glass-card spark-kpi-card" id="kpi-card-domains">
          <div class="sk-top"><span class="sk-title">域名统计</span><svg viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg></div>
          <div class="sk-bottom">
            <div class="sk-val tabular">${domainCount}</div>
            <svg class="sk-chart" viewBox="0 0 100 34" fill="none" aria-hidden="true"></svg>
          </div>
          <div class="sk-note">去重域名数</div>
        </div>
      </div>

      <!-- 第三层：UI 2026.10.16.1 的五阶段 DNS 解析路径布局 -->
      <div class="col-12">
        <section class="glass-card topology-glass-card" aria-label="实时 DNS 解析与分流全链路拓扑" title="流光仅示意拓扑路径，不代表单条 DNS 查询记录">
          <div class="topo-stage-wrap ${state.particles === false ? 'no-particles' : ''}" id="topo-stage-wrap">
            <svg class="topo-svg-overlay" id="topo-svg" aria-hidden="true"></svg>

            <div class="topo-grid">
              <div class="topo-col" data-col="1">
                <div class="topo-col-title"><span>01</span>客户端来源</div>
                <div class="topo-col-body">
                  ${topoClients.map(c => `
                    <div class="t-node" data-node-id="${c.id}" data-client-ip="${esc(c.ip)}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(c.icon, '#94A3B8')}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(c.name)}</div>
                          <div class="tn-sub">${esc(c.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val" style="color:${c.valColor}">${esc(c.val)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="2">
                <div class="topo-col-title"><span>02</span>引擎与多级缓存</div>
                <div class="topo-col-body">
                  <div class="t-node t-engine-card" data-node-id="e_core" data-route="management">
                    <div>
                      <div class="tec-top">
                        <span class="tec-big tabular">${cacheDisabled ? '—' : overallHitRate.toFixed(1) + '%'}</span>
                        <span class="tec-badge">${compactNum(stats.total_queries)} 请求</span>
                      </div>
                      <div class="tec-desc">多级内存缓存命中 · ${cacheDisabled ? '核心缓存已关闭' : '4 个活跃缓存池'}</div>
                    </div>

                    <div class="tec-bars">
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">主缓存</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cMain.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cMain.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国内池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cDom.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cDom.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">国外池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cFor.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cFor.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">ECS 池</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, cEcs.hit)}%"></div></div>
                        <span class="tec-bar-pct">${cEcs.hit.toFixed(1)}%</span>
                      </div>
                      <div class="tec-bar-row">
                        <span class="tec-bar-name">乐观过期</span>
                        <div class="tec-bar-track"><div class="tec-bar-fill" style="width:${Math.max(4, Math.max(cMain.lazy, cDom.lazy))}%;background:#F59E0B"></div></div>
                        <span class="tec-bar-pct">${Math.max(cMain.lazy, cDom.lazy).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="topo-col" data-col="3">
                <div class="topo-col-title"><span>03</span>分流规则集</div>
                <div class="topo-col-body">
                  ${topoRules.map(r => `
                    <div class="t-node" data-node-id="${r.id}" data-rule-jump="${r.tab}">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(r.icon, r.iconColor)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(r.name)}</div>
                          <div class="tn-sub">${esc(r.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-val">${esc(r.val)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="4">
                <div class="topo-col-title"><span>04</span>上游策略组</div>
                <div class="topo-col-body">
                  ${topoGroups.map(g => `
                    <div class="t-node" data-node-id="${g.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box" style="color:${g.codeColor};background:${g.codeBg};border-color:${g.codeColor}33">${esc(g.code)}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(g.name)}</div>
                          <div class="tn-sub">${esc(g.sub)}</div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="topo-col" data-col="5">
                <div class="topo-col-title"><span>05</span>上游 DNS 节点</div>
                <div class="topo-col-body">
                  ${topoServers.map(s => `
                    <div class="t-node" data-node-id="${s.id}" data-route="upstreams">
                      <div class="tn-left">
                        <div class="tn-icon-box">${getNodeIcon(s.icon, '#94A3B8')}</div>
                        <div class="tn-meta">
                          <div class="tn-name">${esc(s.name)}</div>
                          <div class="tn-sub">${esc(s.sub)}</div>
                        </div>
                      </div>
                      <span class="tn-pill" style="color:${s.badgeColor};background:${s.badgeBg}">${esc(s.badge)}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 第四层：8列系统运行体征与实时流量趋势 + 4列分流结果占比 = 12列 -->
      <div class="col-8">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">服务运行体征与查询吞吐监控</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="tn-pill" style="color:#93C5FD;background:rgba(59,130,246,0.16)">启动于 ${startTimeMarkup(sys.start)}</span>
              <span class="tn-pill" style="color:#34D399;background:rgba(16,185,129,0.15)">在线 ${duration(sys.uptime)}</span>
            </div>
          </div>
          <div class="traffic-chart-body">
            <div class="console-chart-empty">正在积累趋势数据…</div>
            <div class="tc-metrics-side">
              <div class="tcm-row"><span>国内直连</span><strong>${num(eStats.domestic || 0)}</strong></div>
              <div class="tcm-row"><span>国外无污染</span><strong>${num((+eStats.foreign || 0) + (+eStats.foreign_ecs || 0))}</strong></div>
              <div class="tcm-row"><span>FakeIP 映射</span><strong>${num(eStats.fakeip || 0)}</strong></div>
              <div class="tcm-row"><span>平均耗时</span><strong>${ms(stats.average_duration_ms)}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-4">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">分流结果占比</div>
            <span class="gc-sub mono">按 domain_set 分类</span>
          </div>
          <div class="outbound-donut-body">
            <div class="ring-wrap">
              <svg viewBox="0 0 42 42" width="124" height="124" aria-hidden="true">
                <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(148,163,184,0.14)" stroke-width="4.8"></circle>
                ${ringCircles}
              </svg>
              <div class="ring-center">${compactNum(ds.reduce((n,x)=>n+(+x.count||0),0))}</div>
            </div>
            <div class="ring-legend">
              ${ds.slice(0, 4).map((x, i) => {
                const p = Math.round((+x.count || 0) / dsTotal * 100);
                return `<div class="rl-item">
                  <span class="rl-name" title="${esc(x.key||'未分类')}"><i class="rl-dot" style="background:${ringColors[i%ringColors.length]}"></i>${esc(x.key||'未分类')}</span>
                  <span class="mono" style="color:var(--text-2);text-align:right">${compactNum(x.count)}</span>
                  <span class="mono" style="color:var(--text-3);text-align:right">${p}%</span>
                </div>`;
              }).join('') || `<div style="color:var(--text-3);font-size:12px">暂无分流分类统计</div>`}
            </div>
          </div>
        </div>
      </div>

      <div class="col-12 workspace-rankings">
        ${window.LocalDNSWorkspace.rankings({domains:domains||[],clients:clients||[],sets:sets||[],total:stats.total_queries,aliases:state.aliases})}
      </div>
      <div class="col-4 workspace-lower">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">多级缓存池状态</div>
            <span class="gc-sub" style="cursor:pointer" data-route="management">缓存管理 ›</span>
          </div>
          <div class="rank-col-hint"><span>缓存池</span><span>命中率 · 条目数</span></div>
          <div class="uniform-4rows">
            ${[
              ['全部缓存 (cache_main)', cMain],
              ['国内缓存 (cache_domestic)', cDom],
              ['国外缓存 (cache_foreign)', cFor],
              ['国外 ECS (cache_foreign_ecs)', cEcs]
            ].map(([label, c]) => `
              <div class="u-row-bar">
                <div class="urb-head">
                  <span style="color:var(--text-1)">${label}</span>
                  <span style="color:var(--text-2)">${c.hit.toFixed(1)}% · ${num(c.size)} 条</span>
                </div>
                <div class="urb-track"><div class="urb-fill" style="width:${Math.max(4, c.hit).toFixed(1)}%"></div></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="col-4 workspace-lower">
        <div class="glass-card">
          <div class="gc-head">
            <div class="gc-title">最慢查询与耗时监控</div>
            <button type="button" class="glass-btn" id="slow-detail-button">详情</button>
          </div>
          <div class="uniform-4rows">
            ${slowGroups.slice(0, 4).length ? slowGroups.slice(0, 4).map((g, idx) => {
              const dur = +g.duration_ms || 0;
              const dotColor = dur > 300 ? '#EF4444' : (dur > 80 ? '#F59E0B' : '#10B981');
              const txtColor = dur > 300 ? '#F87171' : (dur > 80 ? '#FBBF24' : '#34D399');
              return `<div class="u-row-pill">
                <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px" title="${esc(g.query_name)} (${esc(state.aliases[g.client_ip]||g.client_ip)})">
                  <i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};margin-right:8px"></i>
                  <strong class="mono" style="color:var(--text-1)">${esc(g.query_name)}</strong>
                </span>
                <span class="mono" style="color:${txtColor};font-weight:600;flex-shrink:0">${ms(dur)}</span>
              </div>`;
            }).join('') : `<div style="color:var(--text-3);font-size:12px;padding:12px 0">暂无慢查询记录</div>`}
          </div>
        </div>
      </div>
    `;

    // 绘制发布版五阶段拓扑连线，并叠加可停止的流光示意。
    const topologyWrap = $('#topo-stage-wrap');
    const redraw = () => { if (topologyWrap?.isConnected && $('#topo-stage-wrap') === topologyWrap) drawTopoCurves(topoEdges); };
    requestAnimationFrame(() => requestAnimationFrame(redraw));
    const onResize = () => requestAnimationFrame(redraw);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('localdns:layoutchange', onResize);
    trackRouteCleanup(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('localdns:layoutchange', onResize);
    });

    // 绑定拓扑节点点击事件
    $$('[data-client-ip]', page).forEach(el => {
      el.onclick = () => {
        const ip = el.dataset.clientIp;
        if (ip) { state.logs.client = ip; state.logs.page = 1; }
        navigate('logs');
      };
    });
    $$('[data-rule-jump]', page).forEach(el => {
      el.onclick = async () => {
        const tab = el.dataset.ruleJump;
        navigate('rules');
        setTimeout(() => {
          const btn = $(`[data-rule-tab="${tab}"]`);
          if (btn) btn.click();
        }, 80);
      };
    });

    // 绑定第一层真实控制条事件
    if ($('#btn-overview-custom-bg')) {
      $('#btn-overview-custom-bg').onclick = e => {
        e.stopPropagation();
        $('#btn-open-bg-customizer')?.click();
      };
    }

    $$('[data-client-mode]', page).forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.clientMode;
        try {
          if (m === 'all') {
            await Promise.all([
              api.json('/plugins/switch2/post', 'POST', { value: 'B' }),
              api.json('/plugins/switch12/post', 'POST', { value: 'B' })
            ]);
            toast('已切换为全员分流模式');
          } else if (m === 'fakeip') {
            await api.json('/plugins/switch2/post', 'POST', { value: 'A' });
            await api.json('/plugins/switch12/post', 'POST', { value: 'B' });
            toast('已启用：指定 Client FakeIP');
          } else if (m === 'realip') {
            await api.json('/plugins/switch12/post', 'POST', { value: 'A' });
            await api.json('/plugins/switch2/post', 'POST', { value: 'B' });
            toast('已启用：指定 Client RealIP');
          }
          renderRoute(true, true);
        } catch (e) {
          toast('切换失败', 'error', e.message);
        }
      };
    });

    const bindSwitchBtn = (sel, tag, curVal, label) => {
      const el = $(sel);
      if (!el) return;
      el.onclick = async () => {
        const nextVal = curVal === 'A' ? 'B' : 'A';
        try {
          await api.json(`/plugins/${tag}/post`, 'POST', { value: nextVal });
          toast(`${label}已${nextVal === 'A' ? '开启' : '关闭'}`);
          renderRoute(true, true);
        } catch (e) {
          toast('操作失败', 'error', e.message);
        }
      };
    };
    bindSwitchBtn('#btn-toggle-switch13', 'switch13', sw.switch13, '核心缓存');
    bindSwitchBtn('#btn-toggle-switch4', 'switch4', sw.switch4, '乐观过期缓存');
    bindSwitchBtn('#btn-toggle-switch7', 'switch7', sw.switch7, 'AdGuard 广告拦截');

    if ($('#btn-flush-all-cache')) {
      $('#btn-flush-all-cache').onclick = async () => {
        if (!confirm('确定清空全部 DNS 缓存？将同时清空全部、国内、国外与国外 ECS 缓存。')) return;
        const ct = ['cache_main', 'cache_domestic', 'cache_foreign', 'cache_foreign_ecs'];
        await Promise.allSettled(ct.map(t => api.request(`/plugins/${t}/flush`)));
        toast('全部 4 个 DNS 缓存池已清空');
        renderRoute(true, true);
      };
    }

    window.LocalDNSWorkspace.bindRanks(page,{domains:domains||[],clients:clients||[],sets:sets||[],aliases:state.aliases});
    // 绑定排行维度切换与详情弹窗
    $$('[data-rank-tab]', page).forEach(btn => {
      btn.onclick = () => {
        state.overviewRankTab = btn.dataset.rankTab;
        renderRoute(true, true);
      };
    });
    if ($('#manage-alias')) $('#manage-alias').onclick = openAliasModal;
    if ($('#kpi-card-clients')) $('#kpi-card-clients').onclick = openAliasModal;
    if ($('#kpi-card-domains')) $('#kpi-card-domains').onclick = () => openDomainDetailModal(domains || []);
    if ($('#domain-detail-button')) {
      $('#domain-detail-button').onclick = () => {
        if ((state.overviewRankTab || 'client') === 'client') openAliasModal();
        else openDomainDetailModal(domains || []);
      };
    }
    if ($('#slow-detail-button')) $('#slow-detail-button').onclick = () => openSlowDetailModal(slowGroups);
    window.LocalDNSWorkspace.topology(page,redraw,sets);
  }

  function logBadge(set){const s=String(set||'未分类');let cls='primary';if(/黑|BAN|BLOCK|拒绝/i.test(s))cls='danger';else if(/白|直连|国内|REAL/i.test(s))cls='success';else if(/灰|代理|订阅/i.test(s))cls='pink';else if(/FAKE/i.test(s))cls='cyan';return `<span class="badge ${cls}">${esc(s)}</span>`;}
  function logRow(x){const ans=(x.answers||[]).map(a=>a.data||a.value).filter(Boolean).join(', ')||x.response_code||'—';return `<tr data-log='${esc(JSON.stringify(x))}'><td>${fmtDate(x.query_time)}</td><td class="td-domain" data-qtype="${esc(String(x.query_type||'').toUpperCase())}" data-qtype-short="${({AAAA:'6',A:'A',CNAME:'C',PTR:'P',HTTPS:'H',TXT:'T',MX:'M',NS:'N',SRV:'S'})[String(x.query_type||'').toUpperCase()]||(String(x.query_type||'')[0]||'?')}" data-blocked="${/黑|BAN|BLOCK|拒绝|拦截/i.test(String(x.domain_set||''))?1:0}"><strong class="copyable" role="button" tabindex="0" data-copy="${esc(x.query_name)}" title="点击复制域名">${esc(x.query_name)}</strong><div style="color:var(--muted);font-size:11px;max-width:360px;overflow:hidden;text-overflow:ellipsis">${esc(ans)}</div></td><td>${esc(x.query_type)}</td><td>${logBadge(x.domain_set)}</td><td>${ms(x.duration_ms)}</td><td><span class="copyable value-chip" role="button" tabindex="0" data-copy="${esc(x.client_ip)}" title="点击复制客户端 IP">${esc(state.aliases[x.client_ip]||x.client_ip)}</span></td><td><span class="badge ${x.response_code==='NOERROR'?'success':'danger'}">${esc(x.response_code)}</span></td><td><button class="icon-button row-action log-detail" type="button" aria-label="查看查询详情" title="查看详情"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></td></tr>`;}
  async function renderLogs(){
    const p=state.logs;
    const data=await api.logs({page:p.page,limit:p.limit,q:p.q,exact:p.exact,query_type:p.type,domain_set:p.set,response_code:p.code,client_contains:p.client});
    const rows=data.logs||[],filters=data.filters||{};
    const choices=(items,selected)=>[...new Set([...(items||[]),selected].filter(Boolean))].sort();
    const options=(items,value,label)=>`<option value="">${label}</option>${choices(items,value).map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('')}`;
    page.innerHTML=`<div class="view-title-row"><div><h1>查询日志</h1></div><div class="workspace-actions"><button type="button" class="glass-btn" id="log-pause" aria-pressed="${!!state.logsPaused}">${state.logsPaused?'继续刷新':'暂停刷新'}</button><button type="button" class="glass-btn" id="audit-control">审计控制</button><button type="button" class="glass-btn" id="alias-control">客户端管理</button></div></div>
    ${card('查询与过滤',`<div class="log-filter-bar"><div class="lf-search"><span class="search-icon">${icon('search')}</span><input id="log-q" value="${esc(p.q)}" placeholder="域名、IP、响应值" aria-label="搜索查询"></div><select id="log-type" aria-label="请求类型">${options(filters.query_types,p.type,'全部类型')}</select><select id="log-set" aria-label="分流结果">${options(filters.domain_sets,p.set,'全部分流')}</select><button type="button" class="lf-more" id="lf-more" aria-expanded="${!!(p.code||p.client||p.exact)}" aria-controls="log-filter-more">更多筛选</button><button type="button" class="lf-reset" id="lf-reset">重置</button><button type="button" class="button primary" id="log-search">查询</button></div><div class="log-filter-more" id="log-filter-more" ${p.code||p.client||p.exact?'':'hidden'}><div class="field"><label for="log-code">响应码</label><select id="log-code">${options(filters.response_codes,p.code,'全部响应码')}</select></div><div class="field"><label for="log-client">客户端</label><input id="log-client" value="${esc(p.client)}" placeholder="客户端 IP"></div><label class="switch"><input id="log-exact" type="checkbox" ${p.exact?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">精确匹配</span></label></div>${window.LocalDNSWorkspace.logTools(p)}`,{iconName:'logs'})}
    ${card('DNS 请求记录',`<div class="table-wrap"><table class="workspace-log-table"><thead><tr><th>时间</th><th>域名 / 响应</th><th>类型</th><th>分流</th><th>耗时</th><th>客户端</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.length?rows.map(logRow).join(''):'<tr><td colspan="8" class="table-empty">没有符合条件的记录</td></tr>'}</tbody></table></div>${paginationHtml(data.pagination)}`,{iconName:'logs',subtitle:`共 ${num(data.pagination?.total_items||0)} 条 · 第 ${num(data.pagination?.current_page||1)} / ${num(data.pagination?.total_pages||1)} 页`})}`;
    $('#log-search').onclick=()=>{Object.assign(p,{page:1,q:$('#log-q').value.trim(),type:$('#log-type').value,set:$('#log-set').value,code:$('#log-code').value,client:$('#log-client').value.trim(),exact:$('#log-exact').checked});renderRoute(true);};
    $('#log-q').onkeydown=e=>{if(e.key==='Enter')$('#log-search').click();};
    $('#lf-more').onclick=()=>{const box=$('#log-filter-more');box.hidden=!box.hidden;$('#lf-more').setAttribute('aria-expanded',String(!box.hidden));};
    $('#lf-reset').onclick=()=>{Object.assign(p,{page:1,q:'',type:'',set:'',code:'',client:'',exact:false});renderRoute(true);};
    $$('.log-detail',page).forEach(b=>b.onclick=()=>openLogPath(JSON.parse(b.closest('tr').dataset.log)));
    $$('.pagination button[data-page]',page).forEach(b=>b.onclick=()=>{p.page=+b.dataset.page;renderRoute(true);});
    $('#audit-control').onclick=openAuditModal;$('#alias-control').onclick=openAliasModal;
    window.LocalDNSWorkspace.bindLogs(page,rows);
  }
  function openLogPath(record){openDrawer('解析路径',record.query_name,logDetailHtml(record));window.LocalDNSQueryPath.bind($('#drawer-content'),record,state.aliases);}
  function paginationHtml(p){if(!p||p.total_pages<=1)return'';const cur=p.current_page,total=p.total_pages;let arr=[];for(let i=Math.max(1,cur-2);i<=Math.min(total,cur+2);i++)arr.push(i);return `<div class="pagination"><button data-page="${cur-1}" ${cur<=1?'disabled':''}>‹</button>${arr.map(i=>`<button data-page="${i}" class="${i===cur?'active':''}">${i}</button>`).join('')}<button data-page="${cur+1}" ${cur>=total?'disabled':''}>›</button></div>`;}
  function logDetailHtml(record){return window.LocalDNSQueryPath.html(record,state.aliases);}

  async function renderUpstreams(){
    const [cfg,tags,metricsRaw,ecsInfo]=await Promise.all([api.request('/api/v1/upstream/config'),api.request('/api/v1/upstream/tags'),api.metrics(),api.request('/api/v1/upstream/ecs')]);
    state.upstreamConfig=cfg;state.upstreamEcs=ecsInfo?.ecs||'';
    const metrics=parseProm(metricsRaw),groups=Array.isArray(tags)?tags:Object.keys(cfg||{}),rows=[];
    groups.forEach(g=>(cfg[g]||[]).forEach((u,i)=>rows.push({g,u,i,m:upstreamMetrics(metrics,g,u.tag)})));
    rows.sort((a,b)=>Number(b.u.enabled!==false)-Number(a.u.enabled!==false));
    page.innerHTML=`<div class="view-title-row"><div><h1>DNS 管理</h1></div><button type="button" class="glass-btn primary" id="up-add">添加上游节点</button></div><div class="col-12">${window.LocalDNSWorkspace.upstreams(rows,groups)}</div>`;
    $$('.up-toggle',page).forEach(x=>x.onchange=()=>toggleUpstream(x.closest('tr'),x.checked));
    $$('.up-edit',page).forEach(x=>x.onclick=()=>openUpstreamModal(x.closest('tr')));
    $$('.up-delete',page).forEach(x=>x.onclick=()=>deleteUpstream(x.closest('tr')));
    $$('.up-error-detail-trigger',page).forEach(x=>x.onclick=e=>{e.stopPropagation();const row=rows.find(r=>r.g===x.dataset.group&&String(r.i)===x.dataset.index);if(row)openUpstreamErrorPopover(x,row);});
    $$('.workspace-upstream-group .table-wrap',page).forEach(w=>w.addEventListener('scroll',closeUpstreamErrorPopover,{passive:true}));
    $('#up-add').onclick=()=>openUpstreamModal();
  }
  async function saveUpstreamCandidate(group,candidate,ecs){const body={plugin_tag:group,upstreams:candidate||[]};if(group==='foreign_ecs'&&typeof ecs==='string')body.ecs=ecs;return api.json('/api/v1/upstream/config','POST',body);}
  async function saveUpstreamGroup(group){return saveUpstreamCandidate(group,state.upstreamConfig[group]||[]);}
  async function toggleUpstream(row,enabled){const g=row.dataset.group,i=+row.dataset.index,old=state.upstreamConfig[g][i].enabled;state.upstreamConfig[g][i].enabled=enabled;try{await saveUpstreamGroup(g);toast('上游状态已保存');renderRoute(true)}catch(e){state.upstreamConfig[g][i].enabled=old;toast('保存失败','error',e.message);renderRoute(true)}}
  async function deleteUpstream(row){if(!confirm('确定删除这个上游 DNS 吗？'))return;const g=row.dataset.group,i=+row.dataset.index,old=state.upstreamConfig[g].slice();state.upstreamConfig[g].splice(i,1);try{await saveUpstreamGroup(g);toast('上游已删除');renderRoute(true)}catch(e){state.upstreamConfig[g]=old;toast('删除失败','error',e.message)}}
  function openUpstreamModal(row){
    const edit=!!row;
    const group=edit?row.dataset.group:Object.keys(state.upstreamConfig||{})[0]||'domestic';
    const idx=edit?+row.dataset.index:-1;
    const u=edit?state.upstreamConfig[group][idx]:{tag:'',protocol:'udp',addr:'',enabled:true};
    const groups=Object.keys(state.upstreamConfig||{});
    // SOCKS5 only for foreign / foreign_ecs; ECS only for foreign_ecs. The timeout takes the place of the fields a group does not have.
    const hasSocks=g=>g==='foreign'||g==='foreign_ecs';
    const fieldsHtml=(g,v)=>{
      const f=(id,label,value,extra='')=>`<div class="field"><label>${label}</label><input id="${id}" ${extra} value="${esc(value)}"></div>`;
      return `<div class="field"><label>名称</label><input id="u-tag" value="${esc(v.tag)}" required></div>
      <div class="field"><label>协议</label><select id="u-protocol">${['udp','tcp','tls','https'].map(x=>`<option ${x===v.protocol?'selected':''}>${x}</option>`).join('')}</select></div>
      ${f('u-addr','服务器地址',v.addr,'required placeholder="223.5.5.5:53 或 https://.../dns-query"')}
      ${f('u-dial','拨号地址',v.dial,'placeholder="可选"')}
      ${hasSocks(g)?f('u-socks','SOCKS5',v.socks,'placeholder="可选"'):''}
      ${g==='foreign_ecs'?f('u-ecs','ECS',v.ecs,'placeholder="一个 IPv4 或 IPv6，可留空；IPv4 默认 /24，IPv6 默认 /56"'):''}
      ${f('u-timeout','查询超时（ms）',v.timeout,'type="number" min="0"')}`;
    };
    const readForm=()=>({tag:$('#u-tag').value,protocol:$('#u-protocol').value,addr:$('#u-addr').value,dial:$('#u-dial').value,socks:$('#u-socks')?$('#u-socks').value:'',ecs:$('#u-ecs')?$('#u-ecs').value:(state.upstreamEcs||''),timeout:$('#u-timeout').value});
    const initial={tag:u.tag||'',protocol:u.protocol||'udp',addr:u.addr||u.server_addr||'',dial:u.dial_addr||'',socks:u.socks5||'',ecs:state.upstreamEcs||'',timeout:u.upstream_query_timeout||0};
    modalOpen(edit?'编辑上游 DNS':'添加上游 DNS','保存后立即生效',`<div class="grid grid-2">
      <div class="field"><label>所属组</label><select id="u-group" ${edit?'disabled':''}>${groups.map(g=>`<option value="${esc(g)}" ${g===group?'selected':''}>${esc(groupName(g))}</option>`).join('')}</select></div>
      <span id="u-fields" style="display:contents">${fieldsHtml(group,initial)}</span>
    </div>`,async()=>{
      const g=$('#u-group').value;
      const v=readForm();
      const item=Object.assign({},u,{tag:v.tag.trim(),protocol:v.protocol,enabled:u.enabled!==false});
      if(!item.tag)throw new Error('名称不能为空');
      item.addr=v.addr.trim();
      item.dial_addr=v.dial.trim();
      if(hasSocks(g))item.socks5=v.socks.trim();else delete item.socks5;
      const timeout=+v.timeout||0;
      if(timeout>0)item.upstream_query_timeout=timeout;else delete item.upstream_query_timeout;
      for(const k of ['bootstrap','enable_http3','enable_pipeline','account_id','access_key_id','access_key_secret','server_addr','ecs_client_ip','ecs_client_mask','ecs_mask'])delete item[k];
      const candidate=(state.upstreamConfig[g]||[]).slice();
      if(edit)candidate[idx]=item;
      else candidate.push(item);
      const ecs=g==='foreign_ecs'?v.ecs.trim():undefined;
      await saveUpstreamCandidate(g,candidate,ecs);
      state.upstreamConfig[g]=candidate;
      if(ecs!==undefined)state.upstreamEcs=ecs;
      toast('上游 DNS 已保存');
      renderRoute(true);
    });
    // choosing another group (when adding) re-lays out the fields and keeps what was typed
    $('#u-group').onchange=()=>{const g=$('#u-group').value;$('#u-fields').innerHTML=fieldsHtml(g,readForm());};
  }

  const ruleProfiles=[['whitelist','白名单'],['blocklist','黑名单'],['greylist','灰名单'],['force_realip','强制 RealIP'],['ddns_domains','DDNS 域名'],['pcdn_domains','PCDN 域名'],['pcdn_regex_v4','PCDN IPv4 规则'],['pcdn_regex_v6','PCDN IPv6 规则'],['client_ip','客户端 IP'],['direct_ip','直连 IP'],['rewrite','重定向']];
  async function renderRules(){
    page.innerHTML=`
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>规则管理</h1><span class="gc-sub">统一维护本地名单、AdGuard 广告拦截与 SRS 在线分流规则</span></div>
      <div class="seg-group" id="rule-top-tabs">
        <button type="button" class="seg-item active" data-rule-tab="lists">名单管理</button>
        <button type="button" class="seg-item" data-rule-tab="adguard">广告拦截 (AdGuard)</button>
        <button type="button" class="seg-item" data-rule-tab="diversion">在线分流 (SRS)</button>
      </div>
    </div>
    <div id="rule-tab-body" class="col-12"></div>`;
    $$('[data-rule-tab]').forEach(x=>x.onclick=()=>{$$('[data-rule-tab]').forEach(y=>y.classList.toggle('active',y===x));renderRuleTab(x.dataset.ruleTab)});
    await renderRuleTab('lists');
  }
  async function renderRuleTab(tab){const body=$('#rule-tab-body');body.innerHTML=loadingPage();if(tab==='lists')return renderListRules(body);if(tab==='adguard')return renderAdguard(body);return renderDiversion(body);}
  async function renderListRules(body){
    if(!ruleProfiles.some(x=>x[0]===state.ruleTag))state.ruleTag=ruleProfiles[0][0];
    const tag=state.ruleTag,profile=ruleProfiles.find(x=>x[0]===tag)||ruleProfiles[0];
    let text='',loadError=null;
    try{text=await api.request(`/plugins/${tag}/show?all=1`)}catch(e){loadError=e}
    const menu=`<div class="rule-menu">${ruleProfiles.map(([t,n])=>`<button data-rule-tag="${t}" class="${t===tag?'active':''}"><span>${n}</span><span class="rule-count"></span></button>`).join('')}</div>`;
    if(loadError){
      body.innerHTML=`<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>读取失败时禁止保存，现有规则不会被覆盖。</p></div><button class="button" id="rule-retry">${icon('refresh')}重试</button></div><div class="error-panel"><strong>规则列表加载失败</strong><p>${esc(loadError.message)}</p></div></div></div></section>`;
      $$('[data-rule-tag]').forEach(x=>x.onclick=()=>{state.ruleTag=x.dataset.ruleTag;renderListRules(body)});$('#rule-retry').onclick=()=>renderListRules(body);requestAnimationFrame(fitRuleLayoutHeight);return;
    }
    const trimmed=String(text).trim();
    body.innerHTML=`<section class="card"><div class="rule-layout">${menu}<div class="rule-editor"><div class="section-header"><div><h2>${profile[1]}</h2><p>一行一条；完整读取后才允许保存</p></div><div class="section-header-actions"><button class="button small" id="rule-download">${icon('download')}下载列表</button><button class="button primary" id="rule-save">${icon('save')}保存</button></div></div><textarea id="rule-text" class="rule-textarea" spellcheck="false">${esc(trimmed)}</textarea><div class="rule-editor-footer"><span id="rule-lines">共 ${trimmed?trimmed.split('\n').length:0} 行</span></div></div></div></section>`;
    $$('[data-rule-tag]').forEach(x=>x.onclick=()=>{state.ruleTag=x.dataset.ruleTag;renderListRules(body)});
    $('#rule-text').oninput=()=>$('#rule-lines').textContent=`共 ${$('#rule-text').value.split('\n').filter(Boolean).length} 行`;
    $('#rule-save').onclick=async()=>{const button=$('#rule-save'),value=$('#rule-text').value;const values=value.split('\n').map(x=>x.trim()).filter(Boolean);button.disabled=true;try{await api.json(`/plugins/${tag}/post`,'POST',{values});window.LocalDNSInterface?.ruleSaved(tag,value);toast(`${profile[1]}已保存`)}catch(e){toast('保存失败','error',e.message)}finally{if(button.isConnected)button.disabled=false}};
    $('#rule-download').onclick=()=>downloadText(`${tag}.txt`,$('#rule-text').value);requestAnimationFrame(fitRuleLayoutHeight);
  }

  async function renderAdguard(body){
    let rules=[];
    try{rules=(await api.request('/plugins/adguard/rules')).slice()}catch(e){body.innerHTML=`<div class="error-panel"><strong>广告规则读取失败</strong><p>${esc(e.message)}</p></div>`;return}
    rules.sort((a,b)=>Number(Boolean(b.enabled))-Number(Boolean(a.enabled)));
    const sourceErrors=rules.filter(r=>r.last_error);
    body.innerHTML=card('广告拦截规则',`${sourceErrors.length?`<div class="error-panel">${sourceErrors.map(r=>`${esc(r.name)}：${esc(r.last_error)}`).join('；')}</div>`:''}<div class="table-wrap adguard-table-wrap mobile-card-table"><table class="adguard-rules-table adguard-card-table"><colgroup><col class="col-enabled"><col class="col-name"><col class="col-url"><col class="col-count"><col class="col-auto"><col class="col-updated"><col class="col-actions"></colgroup><thead><tr><th>启用</th><th>名称</th><th>订阅地址</th><th>规则数</th><th>自动更新</th><th>上次更新</th><th>操作</th></tr></thead><tbody>${rules.length?rules.map(r=>`<tr data-id="${esc(r.id)}"><td class="ad-enabled-cell mobile-toggle-cell"><label class="switch"><input class="ad-enable" type="checkbox" ${r.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></td><td class="ad-name-cell mobile-name-cell" title="${esc(r.name)}"><strong>${esc(r.name)}</strong></td><td class="ad-url-cell mobile-url-cell" data-label="订阅地址" title="${esc(r.url)}"><span class="table-ellipsis mobile-ellipsis">${esc(r.url)}</span></td><td class="ad-count-cell mobile-count-cell" data-label="规则数">${num(r.rule_count)}</td><td class="ad-auto-cell mobile-auto-cell" data-label="自动更新">${r.auto_update?'是':'否'}</td><td class="ad-updated-cell mobile-updated-cell" data-label="上次更新">${fmtDate(r.last_updated)}</td><td class="ad-actions-cell mobile-actions-cell"><div class="table-row-actions card-actions"><button class="button small ad-update">更新</button><button class="button small ad-edit">编辑</button><button class="button small danger ad-delete">删除</button></div></td></tr>`).join(''):`<tr><td colspan="7" class="table-empty">暂无规则</td></tr>`}</tbody></table></div>`,{iconName:'rules',actions:'<button class="button" id="ad-update-all">更新全部</button><button class="button primary" id="ad-add">'+icon('plus')+'添加订阅</button>'});
    const findRule=tr=>rules.find(r=>String(r.id)===tr.dataset.id);
    $$('.ad-enable').forEach(x=>x.onchange=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{await updateAdguard(rule,{enabled:x.checked});toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}`);await renderAdguard(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.ad-update').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule)return;x.disabled=true;try{const r=await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}/update`,{method:'POST'});toast(`广告规则“${rule.name}”更新完成`,'success',`规则数：${num(r?.rule_count||0)}`);await renderAdguard(body)}catch(e){toast(`“${rule.name}”更新失败`,'error',e.message)}finally{x.disabled=false}});
    $$('.ad-edit').forEach(x=>x.onclick=()=>openAdguardModal(findRule(x.closest('tr')),body));
    $$('.ad-delete').forEach(x=>x.onclick=async()=>{const rule=findRule(x.closest('tr'));if(!rule||!confirm(`确定删除广告规则“${rule.name}”？`))return;x.disabled=true;try{await api.request(`/plugins/adguard/rules/${encodeURIComponent(rule.id)}`,{method:'DELETE'});toast('广告规则已删除');await renderAdguard(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#ad-update-all').onclick=async()=>{const btn=$('#ad-update-all');btn.disabled=true;try{const r=await api.request('/plugins/adguard/update',{method:'POST'});const errors=Array.isArray(r?.errors)?r.errors:[];if(errors.length){toast(`广告规则更新完成，失败 ${errors.length} 条`,'error',errors.map(x=>`${x.name}：${x.error}`).join('；'))}else toast(`广告规则更新完成：${Number(r?.updated_sources||0)} 条`);await renderAdguard(body)}catch(e){toast('广告规则更新失败','error',e.message)}finally{btn.disabled=false}};
    $('#ad-add').onclick=()=>openAdguardModal(null,body);
  }
  async function updateAdguard(rule,patch){
    const next=Object.assign({},rule,patch);
    delete next.last_error;
    await api.json(`/plugins/adguard/rules/${rule.id}`,'PUT',next);
  }
  function openAdguardModal(rule,body){
    rule=rule||{name:'',url:'',files:'',enabled:true,auto_update:true,update_interval_hours:24};
    modalOpen(rule.id?'编辑广告规则':'添加广告规则','订阅下载后保存为 TXT（保留 AdGuard 语法），所有启用的订阅合并为 rules/compiled/adguard.txt。',`<div class="stack"><div class="field"><label>名称</label><input id="ad-name" value="${esc(rule.name)}"></div><div class="field"><label>订阅地址</label><input id="ad-url" value="${esc(rule.url)}" placeholder="https://example.com/adblock.txt"></div><div class="field"><label>源缓存文件（可选）</label><input id="ad-files" value="${esc(rule.files||'')}" placeholder="留空时从 URL 自动生成"><p class="form-note">统一保存到 rules/online/adguard/，后缀固定为 .txt；留空时从 URL 路径提取文件名，query/fragment 不会写入文件名。</p></div><div class="grid grid-2"><label class="switch"><input id="ad-enabled" type="checkbox" ${rule.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="ad-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="ad-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div></div>`,async()=>{
      const payload={name:$('#ad-name').value.trim(),url:$('#ad-url').value.trim(),files:$('#ad-files').value.trim(),enabled:$('#ad-enabled').checked,auto_update:$('#ad-auto').checked,update_interval_hours:+$('#ad-hours').value||24};
      if(!payload.name||!payload.url)throw new Error('名称和地址不能为空');
      if(rule.rule_count!==undefined)payload.rule_count=rule.rule_count;
      if(rule.last_updated)payload.last_updated=rule.last_updated;
      if(rule.id)await api.json(`/plugins/adguard/rules/${rule.id}`,'PUT',Object.assign({},rule,payload,{last_error:undefined}));else await api.json('/plugins/adguard/rules','POST',payload);
      toast(`广告规则已${rule.id?'更新':'添加'}`);
      await renderAdguard(body);
    });
  }
  const diversionDefs=[
    {tag:'custom_cn',type:'custom_cn',label:'国内规则',domainRules:true},
    {tag:'custom_non_cn',type:'custom_non_cn',label:'国外规则',domainRules:true},
    {tag:'geoip_cn',type:'geoip_cn',label:'GeoIP CN',domainRules:false},
    {tag:'geosite_cn',type:'geosite_cn',label:'Geosite CN',domainRules:true},
    {tag:'geosite_non_cn',type:'geosite_non_cn',label:'Geosite 非 CN',domainRules:true}
  ];
  const diversionDefByTag=tag=>diversionDefs.find(x=>x.tag===tag);
  const diversionDefByType=type=>diversionDefs.find(x=>x.type===type);
  const diversionFormatLabel=r=>window.LocalDNSRuleConversion.label(r);
  function diversionPayload(rule){
    const target=diversionDefByType(rule.type);
    const payload={
      name:String(rule.name||'').trim(), type:String(rule.type||'').trim(),
      files:String(rule.files||'').trim(), url:String(rule.url||'').trim(),
      dataset:String(rule.dataset||'').trim(),
      auto_update:Boolean(rule.auto_update), update_interval_hours:+rule.update_interval_hours||24,
      enabled:rule.enabled!==false
    };
    if(target&&target.domainRules!==false)payload.enable_regexp=true;
    if(!payload.dataset)delete payload.dataset;
    if(rule.rule_count!==undefined&&rule.rule_count!==null)payload.rule_count=+rule.rule_count||0;
    if(rule.last_updated)payload.last_updated=rule.last_updated;
    if(rule.detected_format)payload.detected_format=rule.detected_format;
    return payload;
  }
  async function saveDiversionRule(rule,original=null){
    const target=diversionDefByType(rule.type);if(!target)throw new Error('请选择有效的规则类型');
    const payload=diversionPayload(window.LocalDNSRuleConversion.withMetadata(rule,original));if(!payload.name)throw new Error('名称不能为空');if(!payload.url)throw new Error('订阅地址不能为空');
    const response=await api.json(`/plugins/${target.tag}/config/${encodeURIComponent(payload.name)}`,'PUT',payload);
    const saved=await window.LocalDNSRuleConversion.finishSave(response,()=>api.request(`/plugins/${target.tag}/update/${encodeURIComponent(payload.name)}`,{method:'POST'}));
    if(original&&(original.tag!==target.tag||original.name!==payload.name)){
      await api.request(`/plugins/${original.tag}/config/${encodeURIComponent(original.name)}`,{method:'DELETE'});
    }
    return saved;
  }
  function openDiversionDatasetPrompt(rule,datasets,body,original=rule){
    const options=(Array.isArray(datasets)?datasets:[]).map(x=>String(x||'').trim()).filter(Boolean);
    if(!options.length){toast('更新失败','error','数据源要求选择数据集，但没有返回可用数据集');return;}
    modalOpen('请选择数据集 / Tag','检测到多数据集 DAT。选择一次后会作为隐藏元数据保存，后续自动更新将直接复用。',`<div class="stack"><div class="field"><label>数据集 / Tag</label><select id="div-dataset-choice">${options.map(x=>`<option value="${esc(x)}" ${x===rule.dataset?'selected':''}>${esc(x)}</option>`).join('')}</select></div><p class="form-note">此选择只在多数据集 DAT 需要时出现，不会重新加入常驻的格式或匹配设置。</p></div>`,async()=>{
      const dataset=$('#div-dataset-choice').value;
      const saved=await saveDiversionRule({...rule,dataset},original);
      window.LocalDNSWorkspace.clearRuleDraft(original);
      toast('识别与转换完成','success',window.LocalDNSRuleConversion.message(saved));
      await renderDiversion(body);
    });
  }
  async function updateDiversionRule(rule,body){
    try{
      const result=await api.request(`/plugins/${rule.tag}/update/${encodeURIComponent(rule.name)}`,{method:'POST'});
      const source=window.LocalDNSRuleConversion.updated(result);if(source)Object.assign(rule,source);
      toast('规则更新完成','success',window.LocalDNSRuleConversion.message(result));
      await renderDiversion(body);
      return result;
    }catch(err){
      if(err.body?.code==='dataset_required'&&Array.isArray(err.body.datasets)){
        openDiversionDatasetPrompt(rule,err.body.datasets,body);
        return null;
      }
      throw err;
    }
  }
  async function renderDiversion(body){
    const all=await Promise.all(diversionDefs.map(async def=>{const result=await safeResult(()=>api.request(`/plugins/${def.tag}/config`));return result.ok?{def,items:result.data,error:null}:{def,items:[],error:result.error}}));
    const errors=all.filter(x=>x.error);
    const rows=all.flatMap(({def,items})=>(Array.isArray(items)?items:[]).map(i=>({
      ...i,tag:def.tag,group:def.label,type:i.type||def.type,enabled:i.enabled!==false,
      dataset:String(i.dataset||''),detected_format:String(i.detected_format||''),
      auto_update:Boolean(i.auto_update),update_interval_hours:+i.update_interval_hours||24
    })));
    rows.sort((a,b)=>Number(b.enabled)-Number(a.enabled));
    body.innerHTML=card('在线分流规则',window.LocalDNSWorkspace.diversion(rows,errors,diversionFormatLabel),{iconName:'rules',actions:'<button class="button" id="div-update-all">更新全部</button><button class="button primary" id="div-add">'+icon('plus')+'添加规则</button>'});
    window.LocalDNSWorkspace.bindDiversion(body);
    $$('.div-detail',body).forEach(button=>button.onclick=()=>{const el=button.closest('[data-tag][data-name]'),r=rows.find(r=>r.tag===el.dataset.tag&&String(r.name)===el.dataset.name);if(r)window.LocalDNSWorkspace.ruleDetails(r,()=>openDiversionModal(r,body),diversionFormatLabel);});
    const findRow=tr=>rows.find(r=>r.tag===tr.dataset.tag&&String(r.name)===tr.dataset.name);
    $$('.div-enable').forEach(x=>x.onchange=async()=>{const tr=x.closest('[data-tag][data-name]'),rule=findRow(tr);if(!rule)return;x.disabled=true;try{const next={...rule,enabled:x.checked};await saveDiversionRule(next,rule);rule.enabled=x.checked;toast(`规则“${rule.name}”已${x.checked?'启用':'关闭'}，配置已保存`);await renderDiversion(body)}catch(e){x.checked=!x.checked;toast('状态保存失败','error',e.message)}finally{x.disabled=false}});
    $$('.div-update').forEach(x=>x.onclick=async()=>{const rule=findRow(x.closest('[data-tag][data-name]'));if(!rule)return;x.disabled=true;try{await updateDiversionRule(rule,body)}catch(e){toast('更新失败','error',e.message)}finally{x.disabled=false}});
    $$('.div-edit').forEach(x=>x.onclick=()=>{const rule=findRow(x.closest('[data-tag][data-name]'));if(rule)openDiversionModal(rule,body)});
    $$('.div-delete').forEach(x=>x.onclick=async()=>{if(!confirm('确定删除此在线规则？配置文件中的对应项目也会被删除。'))return;const tr=x.closest('[data-tag][data-name]');x.disabled=true;try{await api.request(`/plugins/${tr.dataset.tag}/config/${encodeURIComponent(tr.dataset.name)}`,{method:'DELETE'});toast('规则及对应配置已删除');await renderDiversion(body)}catch(e){toast('删除失败','error',e.message)}finally{x.disabled=false}});
    $('#div-add').onclick=()=>openDiversionModal(null,body);
    $('#div-update-all').onclick=async()=>{
      const targets=rows.filter(r=>r.enabled&&r.url);
      if(!targets.length){toast('没有可更新的已启用规则','info');return}
      const btn=$('#div-update-all');btn.disabled=true;
      try{
        const byTag=new Map();
        targets.forEach(r=>{if(!byTag.has(r.tag))byTag.set(r.tag,[]);byTag.get(r.tag).push(r)});
        const jobs=[];
        for(const [tag,group] of byTag){
          const def=diversionDefByTag(tag);
          if(def){
            jobs.push(api.request(`/plugins/${tag}/update-all`,{method:'POST'}).then(data=>({kind:'batch',count:group.length,data}),error=>({kind:'failed',count:group.length,error})));
          }else{
            group.forEach(r=>jobs.push(api.request(`/plugins/${r.tag}/update/${encodeURIComponent(r.name)}`,{method:'POST'}).then(data=>({kind:'single',count:1,data}))));
          }
        }
        const result=await Promise.allSettled(jobs);
        let failed=0,datasetNeeded=0,completed=0,details=[];
        result.forEach(x=>{
          if(x.status==='rejected'){
            failed++;
            if(x.reason?.body?.code==='dataset_required')datasetNeeded++;
            details.push(x.reason?.message||'未知错误');
            return;
          }
          const item=x.value;if(item.kind==='failed'){failed+=item.count;details.push(item.error?.message||'更新失败');return;}
          completed+=item.kind==='batch'?Number(item.data?.updated||0):item.count;
          if(item.kind==='batch'){
            failed+=Number(item.data?.failed||0);
            datasetNeeded+=Number(item.data?.dataset_required||0);
            if(Array.isArray(item.data?.errors))details.push(...item.data.errors.map(e=>`${e.name}：${e.error}`));
          }
        });
        const detailText=details.join('；');
        if(datasetNeeded)toast(`更新完成 ${completed} 条；${datasetNeeded} 条需要单独选择数据集`,'error',detailText);
        else if(failed)toast(`更新任务完成，失败 ${failed} 条`,'error',detailText);
        else toast(`已更新 ${completed} 条在线分流规则`);
        await renderDiversion(body);
      }finally{btn.disabled=false}
    };
  }
  function openDiversionModal(rule,body){
    const original=rule?{...rule}:null;
    rule=rule||{name:'',type:'custom_cn',url:'',files:'',enabled:true,dataset:'',auto_update:true,update_interval_hours:24};
    rule.dataset=String(rule.dataset||'');
    modalOpen(original?'编辑在线分流规则':'添加在线分流规则','远程规则由后端按内容自动识别，并统一转换为 SRS；无需手工选择源格式或匹配方式。',`<div class="stack"><div class="grid grid-2"><div class="field"><label>名称</label><input id="div-name" value="${esc(rule.name)}" placeholder="例如：direct_tld_cn"></div><div class="field"><label>规则类型</label><select id="div-type">${diversionDefs.map(d=>`<option value="${d.type}" ${d.type===rule.type?'selected':''}>${esc(d.label)}</option>`).join('')}</select></div></div><div class="field"><label>订阅地址</label><input id="div-url" value="${esc(rule.url||'')}" placeholder="https://example.com/rules"></div><div class="field"><label>源缓存文件（可选）</label><input id="div-files" value="${esc(rule.files||'')}" placeholder="留空时自动生成"><p class="form-note">每个订阅源下载后统一转换为 SRS，存放在 rules/online/规则组/；同组来源合并去重后生成 rules/compiled/规则组.srs，运行时只加载这个文件。</p></div><div class="grid grid-2"><label class="switch"><input id="div-enabled" type="checkbox" ${rule.enabled!==false?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用</span></label><label class="switch"><input id="div-auto" type="checkbox" ${rule.auto_update?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">自动更新</span></label></div><div class="field"><label>更新间隔（小时）</label><input id="div-hours" type="number" min="1" value="${rule.update_interval_hours||24}"></div><p class="form-note">支持的来源按内容自动识别；只有多数据集 DAT 才会在更新时要求选择一次数据集。所有成功识别的来源最终统一转换为 SRS 后加载。</p></div>`,async()=>{const payload={name:$('#div-name').value.trim(),type:$('#div-type').value,url:$('#div-url').value.trim(),files:$('#div-files').value.trim(),dataset:rule.dataset,enabled:$('#div-enabled').checked,auto_update:$('#div-auto').checked,update_interval_hours:+$('#div-hours').value||24};let saved;try{saved=await saveDiversionRule(payload,original);}catch(err){if(err.body?.code==='dataset_required'&&Array.isArray(err.body.datasets)){return ()=>openDiversionDatasetPrompt({...payload,tag:payload.type},err.body.datasets,body,original);}throw err;}window.LocalDNSWorkspace.clearRuleDraft(original);toast('保存与转换完成','success',window.LocalDNSRuleConversion.message(saved));await renderDiversion(body);});
    window.LocalDNSWorkspace.trackRuleDraft(original);
  }

  const cacheName=t=>({cache_main:'全部缓存',cache_domestic:'国内缓存',cache_foreign:'国外缓存',cache_foreign_ecs:'国外 ECS 缓存'})[t]||t;
  function requeryHtml(s,c){
    if(!s)return {actions:'',body:empty('Requery 插件不可用')};
    const taskState=String(s.task_state||s.status||'idle').toLowerCase();
    const running=s.running===true||['running','processing','cancelling'].includes(taskState);
    const stateText={idle:'空闲',running:'运行中',processing:'运行中',cancelling:'正在取消',failed:'运行失败',error:'运行失败'}[taskState]||(running?'运行中':'空闲');
    const stateClass=['failed','error'].includes(taskState)?'danger':(running?'primary':'success');
    const pr=s.progress||{};
    const hasProgress=pr.processed!==undefined||pr.total!==undefined;
    const lastRun=s.last_run_end_time||s.last_run_start_time||s.last_run?.finished_at||s.last_run?.started_at;
    const lastCount=s.last_run_domain_count;
    const tile=(k,v)=>`<div class="mg-tile"><span>${k}</span><strong>${v}</strong></div>`;
    const statusRow=`<div class="rq-status"><span class="mg-chip"><span class="mg-lab">当前状态</span><span class="badge ${stateClass}">${stateText}</span></span><span class="mg-chip"><span class="mg-lab">定时任务</span><span class="badge ${c?.scheduler?.enabled?'success':''}">${c?.scheduler?.enabled?'已启用':'未启用'}</span></span></div>`;
    const actions=`<button class="button small" id="requery-scheduler" title="定时任务设置"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h9M18 8h2M4 16h4M13 16h7"/><circle cx="15.5" cy="8" r="2"/><circle cx="10.5" cy="16" r="2"/></svg>定时设置</button>${running?'<button class="button small danger" id="requery-cancel">取消任务</button>':'<button class="button small primary" id="requery-trigger" title="开始全新任务"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4.5 19 12 7 19.5Z"/></svg>全新任务</button>'}`;
    const body=statusRow+`<div class="mg-tiles">${tile('进度',hasProgress?`${num(pr.processed??0)} / ${num(pr.total??0)}`:'—')}${tile('上次处理域名',lastCount===undefined||lastCount===null?'—':num(lastCount)+' 条')}${tile('上次运行',fmtDate(lastRun))}${tile('下次执行',fmtDate(s.next_run_time))}${tile('间隔',c?.scheduler?.interval_minutes?num(c.scheduler.interval_minutes)+' 分钟':'—')}</div>`;
    return {actions,body};
  }
  function openRequeryScheduler(c){
    c=c||{};
    const sc=c.scheduler||{};
    const dateDays=sc.date_range_days||c.execution_settings?.date_range_days||30;
    let local='';
    if(sc.start_datetime){const d=new Date(sc.start_datetime);if(!Number.isNaN(d.getTime())){const n=new Date(d.getTime()-d.getTimezoneOffset()*60000);local=n.toISOString().slice(0,16)}}
    modalOpen('分流刷新定时任务','定期扫描近期查询域名并刷新自动分流缓存',`<div class="stack"><label class="switch"><input id="rq-enabled" type="checkbox" ${sc.enabled?'checked':''}><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-label">启用定时任务</span></label><div class="grid grid-2"><div class="field"><label>执行间隔（分钟）</label><input id="rq-interval" type="number" min="1" value="${esc(sc.interval_minutes||10080)}"></div><div class="field"><label>域名刷新天数</label><input id="rq-days" type="number" min="1" value="${esc(dateDays)}"></div></div><div class="field"><label>首次执行时间</label><input id="rq-start" type="datetime-local" value="${esc(local)}"></div><p class="form-note">10080 分钟等于 7 天。首次执行时间留空且启用时，后端会以保存时刻作为调度锚点并返回真实下次执行时间。</p></div>`,async()=>{
      const enabled=$('#rq-enabled').checked;
      const interval=+$('#rq-interval').value||0;
      const days=+$('#rq-days').value||0;
      if(enabled&&interval<=0)throw new Error('启用定时任务时，执行间隔必须大于 0');
      if(days<1)throw new Error('域名刷新天数必须大于 0');
      const raw=$('#rq-start').value;
      const payload={enabled,interval_minutes:interval,start_datetime:raw?new Date(raw).toISOString():'',date_range_days:days};
      await api.json('/plugins/requery/scheduler/config','POST',payload);
      toast('定时任务配置已更新');
      renderRoute(true);
    });
  }
  function countsHtml(c){
    if(c&&c.ok===false){
      const detail=c.error?.message?`<div class="muted" style="margin-top:8px">${esc(c.error.message)}</div>`:'';
      return empty('统计读取失败')+detail;
    }
    if(c&&c.ok===true)c=c.data;
    if(!c)return empty('暂无统计');
    let raw=c;
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.prototype.hasOwnProperty.call(raw,'data')) raw=raw.data;
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      if(Array.isArray(raw.items)) raw=raw.items;
      else if(Array.isArray(raw.counts)) raw=raw.counts;
      else if(Array.isArray(raw.source_file_counts)) raw=raw.source_file_counts;
    }
    const entries=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?Object.entries(raw).map(([name,value])=>value&&typeof value==='object'?{name,...value}:{name,count:value}):[]);
    if(!entries.length)return empty('暂无统计');
    return `<div class="table-wrap"><table><thead><tr><th>列表</th><th>条目数</th></tr></thead><tbody>${entries.map(x=>`<tr><td>${esc(x.alias||x.name||x.file||x.path||'未知')}</td><td>${num(x.count??x.rule_count??x.entries??x.value??0)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function multiPluginAction(paths,msg){await Promise.all(paths.map(p=>api.request(`/plugins/${p}`)));toast(msg);renderRoute(true)}
  async function clearShuntData(){
    const warning='确定完全清空自动分流数据？\n\n将清空：\n• 域名全集及 A/AAAA Activity\n• 自动生成的 FakeIP / RealIP / NODATA 分流记忆\n• 刷新分流缓存的历史进度与统计\n\n定时任务设置不会改变。\n清空后将从零重新收集域名并生成分流规则。';
    if(!confirm(warning))return;
    try{
      await api.request('/plugins/requery/reset',{method:'POST'});
      toast('自动分流数据已完全清空，将从零重新收集');
      renderRoute(true);
    }catch(e){
      toast('清空自动分流数据失败','error',e.message);
      renderRoute(true);
    }
  }

  const switchProfiles=[
    {tag:'switch1',name:'请求屏蔽',desc:'对无解析结果的请求进行屏蔽'}, {tag:'switch5',name:'类型屏蔽',desc:'屏蔽 SOA、PTR、HTTPS 等请求'},
    {tag:'switch7',name:'广告屏蔽',desc:'启用 AdGuard 在线规则'}, {tag:'switch6',name:'IPv6 屏蔽',desc:'屏蔽 AAAA 请求类型'},
    {tag:'switch13',name:'核心缓存',desc:'启用最终结果的全部缓存'}, {tag:'switch4',name:'过期缓存',desc:'启用国内及国外缓存的过期响应'},
    {tag:'switch2',name:'指定 Client FakeIP',desc:'只允许指定客户端科学'}, {tag:'switch12',name:'指定 Client RealIP',desc:'指定客户端不允许科学'}
  ];


  async function renderProxyConfig(){
    const seq=state.renderSeq;
    const cleanup=await window.LocalDNSProxyConfig.mount(page,{notify:toast,navigate});
    if(seq!==state.renderSeq)cleanup();else trackRouteCleanup(cleanup);
  }

  async function renderManagement(){
    const renderSeq=state.renderSeq;
    const isCurrent=()=>state.route==='management'&&state.renderSeq===renderSeq;
    const tags=switchProfiles.map(x=>x.tag);
    const skeletonBlock=(height=150)=>`<div class="skeleton" style="height:${height}px;border-radius:12px"></div>`;

    page.innerHTML=`
    <div class="view-title-row">
      <div style="display:flex;align-items:baseline;gap:12px"><h1>系统管理</h1><span class="gc-sub">多级缓存池、核心功能开关与 Requery 自动分流刷新管理</span></div>
    </div>
    <div class="management-stack">
      <section class="proxy-panel-management" aria-label="代理面板设置">
        <div><h2 data-proxy-panel-name>代理面板</h2><code data-proxy-panel-address></code></div>
        <a class="button small" data-proxy-panel-link target="_blank" rel="noopener noreferrer">打开面板</a>
        <button type="button" class="button small" data-route="proxy-config">编辑配置</button>
        <button type="button" class="button small" data-proxy-panel-settings>面板设置</button>
      </section>
      <div id="management-cache-slot" style="display:contents">${card('缓存管理',skeletonBlock(130),{iconName:'data',className:'data-cache-panel'})}</div>
      <div id="management-feature-slot" style="display:contents">${card('功能开关',skeletonBlock(300),{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'})}</div>
      <div class="management-bottom">
        <div id="management-counts-slot" style="display:contents">${card('域名列表统计',skeletonBlock(150),{iconName:'rules',subtitle:'查看自动分流列表的当前条目数',className:'data-counts-card'})}</div>
        <div id="management-requery-slot" style="display:contents">${card('刷新分流缓存',skeletonBlock(270),{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',className:'data-requery-card'})}</div>
      </div>
    </div>`;

    window.LocalDNSProxyPanel?.sync();
    const switchPromise=Promise.all(tags.map(t=>safe(()=>api.request(`/plugins/${t}/show`),'error'))).then(results=>Object.fromEntries(tags.map((t,i)=>[t,String(results[i]).trim()])));
    const metricsPromise=api.metrics();
    const reqStatusPromise=safe(()=>api.request('/plugins/requery/status'),null);
    const reqCfgPromise=safe(()=>api.request('/plugins/requery/scheduler/config'),null);
    const countsPromise=safeResult(()=>api.request('/plugins/requery/stats/source_file_counts'));

    switchPromise.then(status=>{
      if(!isCurrent())return;
      const featureHtml=`<div class="feature-grid management-feature-grid">${switchProfiles.map(p=>`<div class="feature-card management-feature-card"><div><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></div><div class="feature-footer"><span class="badge ${status[p.tag]==='A'?'success':''}">${status[p.tag]==='A'?'已启用':'已关闭'}</span><label class="switch"><input data-switch="${p.tag}" type="checkbox" ${status[p.tag]==='A'?'checked':''} ${status[p.tag]==='error'?'disabled':''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div></div>`).join('')}</div>`;
      const featureSlot=$('#management-feature-slot');
      if(featureSlot)featureSlot.innerHTML=card('功能开关',featureHtml,{iconName:'features',subtitle:'常用运行功能集中管理',className:'management-feature-panel'});
      $$('[data-switch]').forEach(x=>x.onchange=async()=>{try{const tag=x.dataset.switch,val=x.checked?'A':'B';await api.json(`/plugins/${tag}/post`,'POST',{value:val});if(x.checked&&(tag==='switch2'||tag==='switch12')){const other=tag==='switch2'?'switch12':'switch2';await api.json(`/plugins/${other}/post`,'POST',{value:'B'});}toast('功能状态已保存');renderRoute(true)}catch(e){x.checked=!x.checked;toast('切换失败','error',e.message)}});
    });

    Promise.all([switchPromise,metricsPromise]).then(([status,metricsRaw])=>{
      if(!isCurrent())return;
      const metrics=parseProm(metricsRaw),caches=parseCaches(metrics);
      const cacheEnabled=String(status.switch13||'').trim().toUpperCase()==='A';
      const activeCacheTag='cache_main';
      const activeCacheLabel=cacheName(activeCacheTag),activeForeignTag='cache_foreign_ecs';
      const visibleCacheTags=[activeCacheTag,'cache_domestic','cache_foreign',activeForeignTag];
      const visibleCaches=visibleCacheTags.map(tag=>caches.find(c=>c.tag===tag)).filter(Boolean);
      const cacheCards=visibleCaches.map(c=>`<div class="cache-card cache-card-compact" style="min-width:0;padding:10px 11px 11px;border-radius:11px"><div class="cache-card-head" style="display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important"><h3 title="${esc(cacheName(c.tag))}" style="flex:1 1 auto!important;min-width:0!important;margin:0!important;padding:0!important;font-size:13px!important;line-height:30px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important">${cacheName(c.tag)}</h3><div class="cache-card-actions" style="display:flex!important;flex:0 0 auto!important;flex-direction:row!important;align-items:center!important;justify-content:flex-end!important;gap:5px!important;white-space:nowrap!important;margin:0!important;padding:0!important"><button class="button small cache-view" data-tag="${c.tag}" style="flex:0 0 auto!important;min-width:48px!important;height:30px!important;min-height:30px!important;padding:4px 9px!important;margin:0!important">查看</button><button class="button small danger cache-clear" data-tag="${c.tag}" style="flex:0 0 auto!important;min-width:48px!important;height:30px!important;min-height:30px!important;padding:4px 9px!important;margin:0!important">清空</button></div></div><div class="cache-stats cache-stats-flat" style="display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;margin-top:7px!important"><div class="cache-stat" title="完整数值：${num(c.q)}" style="min-width:0!important;min-height:40px!important;padding:5px 9px!important;border-radius:9px!important;display:flex!important;flex-direction:column!important;justify-content:center!important"><span>请求总数</span><strong>${num(c.q)}</strong></div><div class="cache-stat" title="完整数值：${num(c.size)}" style="min-width:0!important;min-height:40px!important;padding:5px 9px!important;border-radius:9px!important;display:flex!important;flex-direction:column!important;justify-content:center!important"><span>条目数</span><strong>${num(c.size)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.hit)}" style="min-width:0!important;min-height:40px!important;padding:5px 9px!important;border-radius:9px!important;display:flex!important;flex-direction:column!important;justify-content:center!important"><span>命中率</span><strong>${compactPct(c.hit)}</strong></div><div class="cache-stat" title="完整数值：${pct(c.lazy)}" style="min-width:0!important;min-height:40px!important;padding:5px 9px!important;border-radius:9px!important;display:flex!important;flex-direction:column!important;justify-content:center!important"><span>过期命中</span><strong>${compactPct(c.lazy)}</strong></div></div></div>`);
      const cacheHeaderActions=`<div class="cache-header-actions"><span class="badge success cache-active-badge">${activeCacheLabel} · ${cacheEnabled?'当前使用':'当前模式'}</span><span class="badge ${cacheEnabled?'success':'danger'}">● 核心缓存${cacheEnabled?'已开启':'已关闭'}</span><button class="button small danger" id="cache-clear-all">全部清空</button></div>`;
      const slot=$('#management-cache-slot');if(!slot)return;
      slot.innerHTML=`<section class="card data-cache-panel"><div class="card-header"><div class="card-title"><span class="icon">${icon('data')}</span><div><h2>缓存管理</h2><p>仅显示当前模式对应的全部缓存与国外缓存，界面更紧凑</p></div></div>${cacheHeaderActions}</div><div class="card-body"><div class="cache-grid data-cache-grid">${cacheCards.join('')}</div></div></section>`;
      $('#cache-clear-all')?.addEventListener('click',async()=>{if(!confirm('确定清空全部 DNS 缓存？将同时清空经典、智能、国内与国外缓存。'))return;const ct=caches.map(c=>c.tag);const result=await Promise.allSettled(ct.map(tag=>api.request(`/plugins/${tag}/flush`)));const failed=result.filter(x=>x.status==='rejected').length;failed?toast(`已清空 ${result.length-failed} 个缓存，${failed} 个失败`,'error'):toast(`全部 ${result.length} 个缓存已清空`);renderRoute(true)});
      $$('.cache-clear').forEach(x=>x.onclick=async()=>{if(!confirm(`确定清空 ${cacheName(x.dataset.tag)}？`))return;await api.request(`/plugins/${x.dataset.tag}/flush`);toast('缓存已清空');renderRoute(true)});
      $$('.cache-view').forEach(x=>x.onclick=async()=>{const text=await api.request(`/plugins/${x.dataset.tag}/show`);openDrawer(cacheName(x.dataset.tag),'缓存内容',`<pre>${esc(text)}</pre>`)});
    }).catch(e=>{if(isCurrent()&&$('#management-cache-slot'))$('#management-cache-slot').innerHTML=card('缓存管理',`<div class="error-panel">加载失败：${esc(e.message)}</div>`,{iconName:'data',className:'data-cache-panel'});});

    Promise.all([reqStatusPromise,reqCfgPromise]).then(([reqStatus,reqCfg])=>{
      if(!isCurrent())return;
      const slot=$('#management-requery-slot');if(!slot)return;
      const rq=requeryHtml(reqStatus,reqCfg);slot.innerHTML=card('刷新分流缓存',rq.body,{iconName:'refresh',subtitle:'重新扫描域名并更新自动生成的分流列表',actions:rq.actions,className:'data-requery-card'});
      $('#requery-trigger')?.addEventListener('click',async()=>{await api.request('/plugins/requery/trigger',{method:'POST'});toast('刷新任务已开始');renderRoute(true)});
      $('#requery-cancel')?.addEventListener('click',async()=>{await api.request('/plugins/requery/cancel',{method:'POST'});toast('已请求取消');renderRoute(true)});
      $('#requery-scheduler')?.addEventListener('click',()=>openRequeryScheduler(reqCfg));
    });

    countsPromise.then(counts=>{
      if(!isCurrent())return;
      const slot=$('#management-counts-slot');if(!slot)return;
      slot.innerHTML=card('域名列表统计',countsHtml(counts),{iconName:'rules',subtitle:'查看自动分流列表的当前条目数',actions:'<button class="button small" id="save-shunt" title="保存分流规则">保存</button><button class="button small danger" id="clear-shunt" title="清空分流规则">清空</button>',className:'data-counts-card'});
      const countsCard=$('#management-counts-slot .data-counts-card');
      if(countsCard){countsCard.style.height='';countsCard.style.minHeight='';}
      $('#save-shunt')?.addEventListener('click',()=>multiPluginAction(['domain_stats/save','realip/save','fakeip/save','nodata/save'],'分流规则已保存'));
      $('#clear-shunt')?.addEventListener('click',()=>clearShuntData());
    });
  }

  async function restartService(){if(!confirm(`确定重启 ${window.LocalDNSIdentity?.getName()||'LocalDNS'}？短时间内 DNS 服务会中断。`))return;await api.json('/api/v1/system/restart','POST',{delay_ms:500});toast((window.LocalDNSIdentity?.getName()||'LocalDNS')+' 正在重启');state.startTs=null;setTimeout(()=>renderRoute(true),4000);}
  async function openAuditModal(){
    const [s,c]=await Promise.all([api.status(),api.capacity()]);
    modalOpen('审计控制','控制 DNS 查询日志的记录状态与容量',`
      <div class="kv-list"><div class="kv-row"><span class="kv-key">当前状态</span><span class="kv-value"><span class="badge ${s.capturing?'success':'danger'}">${s.capturing?'运行中':'已停止'}</span></span></div></div>
      <div class="field" style="margin-top:16px"><label>日志容量 <span class="settings-compact-note">最大记录数，当前 ${num(c.capacity)} 条</span></label>
        <div class="settings-refresh-row"><input id="audit-cap" type="number" min="100" value="${c.capacity}"><button class="button primary" id="audit-cap-save">保存</button></div></div>
      <div class="grid grid-2" style="margin-top:16px"><button class="button ${s.capturing?'danger':'success'}" id="modal-audit-toggle">${s.capturing?'关闭审计':'开启审计'}</button><button class="button danger" id="modal-audit-clear">清空日志</button></div>`,null,false);
    $('#audit-cap-save').onclick=async()=>{const v=Math.floor(+$('#audit-cap').value);if(!Number.isFinite(v)||v<100){toast('日志容量不能小于 100');return}await api.json('/api/v1/audit/capacity','POST',{capacity:v});toast('日志容量已保存');modalClose();renderRoute(true)};
    $('#modal-audit-toggle').onclick=async()=>{await api.request(`/api/v1/audit/${s.capturing?'stop':'start'}`,{method:'POST'});toast('审计状态已更新');modalClose();renderRoute(true)};
    $('#modal-audit-clear').onclick=async()=>{if(!confirm('确定清空日志？'))return;await api.request('/api/v1/audit/clear',{method:'POST'});toast('日志已清空');modalClose();renderRoute(true)};
  }
  async function loadAliases(){try{state.aliases=await api.request('/plugins/client_name')||{}}catch{state.aliases={}}}
  async function openAliasModal(){
    try {
      await window.LocalDNSClients.open({
        request:(...args)=>api.request(...args), rank:(...args)=>api.rank(...args),
        modal:modalOpen, notify:toast,
        onSaved:next=>{state.aliases=next;renderRoute(true);}
      });
    } catch(error) { toast('客户端管理读取失败','error',error.message); }
  }

  function openDrawer(title,subtitle,html){const wasOpen=$('#drawer').classList.contains('open');$('#drawer-title').textContent=title;$('#drawer-subtitle').textContent=subtitle;$('#drawer-content').innerHTML=html;$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#drawer-backdrop').classList.add('open');if(!wasOpen)window.LocalDNSInterface?.drawerOpened()}
  function closeDrawer(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#drawer-backdrop').classList.remove('open');window.LocalDNSInterface?.drawerClosed()}
  function modalOpen(title,subtitle,html,onSave,showActions=true){window.LocalDNSWorkspace.modalChanging();$('#modal-title').textContent=title;$('#modal-subtitle').textContent=subtitle||'';$('#modal-content').innerHTML=html;$('#modal-actions').innerHTML=showActions?`<button class="button" id="modal-cancel" type="button" value="cancel">取消</button><button class="button primary" id="modal-save" type="button">保存</button>`:'';const d=$('#modal');window.LocalDNSInterface?.semantics(d);d.showModal();const cancel=$('#modal-cancel');if(cancel)cancel.onclick=modalClose;if(onSave&&showActions)$('#modal-save').onclick=async()=>{if(!$('#modal-form').reportValidity())return;const b=$('#modal-save');b.disabled=true;$('#modal-error')?.remove();try{const next=await onSave();modalClose();if(typeof next==='function')next()}catch(e){window.LocalDNSInterface?.formError(e.message);toast('操作失败','error',e.message)}finally{b.disabled=false}};}
  function modalClose(){window.LocalDNSWorkspace.modalChanging();closeSlowTypePopover();const d=$('#modal');d.classList.remove('overview-detail-modal');if(d.open)d.close()}
  function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},100)}
  function downloadText(name,text){downloadBlob(name,new Blob([text],{type:'text/plain;charset=utf-8'}))}
  async function safeResult(fn){try{return{ok:true,data:await fn()}}catch(error){return{ok:false,error}}}
  async function safe(fn,fallback){try{return await fn()}catch{return fallback}}

  window.LocalDNSWorkspace.setup({state,apiBase:API_BASE,loadLogs:options=>api.logs(options),navigate,renderRoute,modalOpen,openDrawer,closeDrawer,downloadText,toast,ms,pct,fmtDate,groupName,trackRouteCleanup});
  window.LocalDNSCollections.setup({apiBase:API_BASE,toast});
  window.addEventListener('localdns:collectionlayoutchange',closeUpstreamErrorPopover);
  initShell(); CONFIG.refreshInterval=Math.min(300,Math.max(5,Number(CONFIG.refreshInterval)||30)); window.LocalDNSInterface?.setup({apiBase:API_BASE,refreshInterval:CONFIG.refreshInterval}); loadAliases().catch(()=>{}); navigate(location.hash.replace(/^#\/?/,'')||'overview',false);
})();
