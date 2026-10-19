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
export { esc, num, pct, compactNum, fullNum, compactPct, ms, fmtBytesBrief, rankCount, startTimeMarkup, fmtDate, duration, overviewUptimeMarkup };
