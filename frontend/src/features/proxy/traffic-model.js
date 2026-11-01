import { fmtBytesBrief } from '../../shared/format/number.js';

export const DAY = 86400000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
export function bytesPair(value) {
  if (!value || typeof value !== 'object' || !['down','up'].every(key=>typeof value[key]==='number'&&Number.isSafeInteger(value[key])&&value[key]>=0)) return null;
  return { down:value.down, up:value.up };
}
export const byteTotal = value => (value?.down||0)+(value?.up||0);
export function sumBytes(values) { return values.reduce((sum,value)=>({down:sum.down+(value?.down||0),up:sum.up+(value?.up||0)}),{down:0,up:0}); }
export function serverDate(data, now=Date.now()) { return new Date(now+(data?.offset||0)*60000).toISOString().slice(0,10); }
export function parseSummary(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.updated!=='string' || !Number.isFinite(Date.parse(raw.updated))) return null;
  const today=bytesPair(raw.today);if(!today)return null;
  const offset=Number(raw.utc_offset_minutes);
  const suffix=/([+-])(\d{2}):(\d{2})$/.exec(raw.updated);
  const inferred=suffix?(Number(suffix[2])*60+Number(suffix[3]))*(suffix[1]==='-'?-1:1):0;
  return { ...today,total:byteTotal(today),updated:String(raw.updated),date:validDate(raw.date)?raw.date:String(raw.updated).slice(0,10),
    since:validDate(raw.since)?raw.since:'',source:raw.source==='sing-box'?'sing-box':'Mihomo',offset:Number.isFinite(offset)&&Math.abs(offset)<=840?offset:inferred,
    publishInterval:Math.max(5,Math.min(300,Number(raw.publish_interval_seconds)||30)),
    yesterday:bytesPair(raw.yesterday),week:bytesPair(raw.week),month:bytesPair(raw.month),lifetime:bytesPair(raw.total),version:Number(raw.version)||1 };
}
export function freshness(data, now=Date.now()) {
  if(!data)return 'empty';
  if(data.date!==serverDate(data,now))return 'expired';
  const age=now-Date.parse(data.updated);
  return age>Math.max(120000,data.publishInterval*4000)||age< -300000?'stale':'ready';
}
function dimensionMap(raw, limit) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const entries=Object.entries(raw).slice(0,2050).filter(([,v])=>bytesPair(v));
  const sum=sumBytes(entries.map(([,v])=>v));
  if(sum.down>limit.down||sum.up>limit.up)return {};
  return Object.fromEntries(entries.map(([key,v])=>[key.slice(0,256),bytesPair(v)]));
}
export function parseDetail(raw) {
  const summary=parseSummary(raw);if(!summary||!Array.isArray(raw.daily))return null;
  const days=new Map();
  for(const entry of raw.daily.slice(-401)){
    const amount=bytesPair(entry);if(!amount||!validDate(entry.date))continue;
    const hourEntries=Object.entries(entry.hourly||{}).filter(([key,value])=>/^\d{2}$/.test(key)&&Number(key)<24&&bytesPair(value));
    days.set(entry.date,{...amount,date:entry.date,coverage:['full','partial','unknown'].includes(entry.coverage)?entry.coverage:'unknown',
      first:typeof entry.first==='string'?entry.first:'',last:typeof entry.last==='string'?entry.last:'',gaps:Number(entry.gaps)||0,
      hourly:Object.fromEntries(hourEntries),devices:dimensionMap(entry.devices,amount),providers:dimensionMap(entry.providers,amount),nodes:dimensionMap(entry.nodes,amount)});
  }
  return {...summary,days,aliases:raw.aliases&&typeof raw.aliases==='object'?raw.aliases:{},dimensionsSince:String(raw.dimensions_since||'')};
}
export function rangeRows(data, range='week', now=Date.now()) {
  const today=serverDate(data,now),end=new Date(today+'T00:00:00Z').getTime()-(range==='yesterday'?DAY:0);
  const count=range==='today'||range==='yesterday'?1:range==='month'?Number(today.slice(-2)):range==='30days'?30:7;
  return Array.from({length:count},(_,i)=>{const date=new Date(end-(count-1-i)*DAY).toISOString().slice(0,10);return data?.days.get(date)||{date,missing:true};});
}
const unknownLabels={devices:'未识别设备',providers:'未识别订阅',nodes:'未识别节点'};
export function rankings(data, rows, dimension='devices', top=20) {
  const entries=new Map();
  for(const row of rows){
    if(row.missing)continue;
    const classified=Object.entries(row[dimension]||{});
    for(const [key,value] of classified)entries.set(key,sumBytes([entries.get(key),value]));
    const sum=sumBytes(classified.map(([,v])=>v));
    const remaining={down:Math.max(0,row.down-sum.down),up:Math.max(0,row.up-sum.up)};
    if(byteTotal(remaining))entries.set('__history__',sumBytes([entries.get('__history__'),remaining]));
  }
  const output=[...entries].map(([key,value])=>{
    const alias=data.aliases[key];
    const name=key==='__history__'?'历史未分类':key==='__unknown__'?unknownLabels[dimension]:key==='__other__'?'其他':dimension==='devices'&&typeof alias==='string'&&alias.trim()?alias:key;
    return {...value,key,name,meta:dimension==='devices'&&name!==key&&!key.startsWith('__')?key:'',total:byteTotal(value)};
  }).filter(row=>row.total>0).sort((a,b)=>b.total-a.total||a.key.localeCompare(b.key));
  if(output.length>top){const remainder=sumBytes(output.splice(top-1));output.push({...remainder,key:'__remainder__',name:'其他',meta:'其余记录合计',total:byteTotal(remainder)});}
  return output;
}
export function trafficCSV(rows, today) {
  const lines=[['日期','下载字节','上传字节','合计字节','采集状态'],...rows.map(row=>[row.date,row.missing?'':row.down,row.missing?'':row.up,row.missing?'':byteTotal(row),row.missing?'未采集':row.date===today?'今日未结束':row.coverage==='unknown'?'覆盖未知':row.coverage==='partial'?'部分采集':'已采集'])];
  return '\uFEFF'+lines.map(line=>line.join(',')).join('\r\n')+'\r\n';
}
export const formatBytes = value => fmtBytesBrief(value);
