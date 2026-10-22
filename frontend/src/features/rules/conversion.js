export let ruleConversionService;
export function initialize() {

  'use strict';
  const formats = {srs:'SRS',dat:'DAT',mrs:'MRS',mmdb:'MMDB',singbox_geosite:'DB',clash_yaml:'YAML',singbox_json:'JSON',txt:'TXT',
    surge:'Surge',dnsmasq:'DNSMasq',hosts:'Hosts',quantumult_x:'Quantumult X'};
  function label(rule) {
    const format = formats[String(rule.detected_format || '').trim().toLowerCase()];
    return format ? (format === 'SRS' ? 'SRS' : format + ' → SRS') : '格式未记录';
  }
  function updated(result) {
    const source = result?.source || result;
    return source && typeof source === 'object' && typeof source.name === 'string' ? source : null;
  }
  function message(result) {
    const source = updated(result);
    if (!source) return '规则更新完成';
    const parts = [];
    if (source.detected_format) parts.push(label(source));
    if (source.rule_count !== undefined && source.rule_count !== null && Number.isFinite(Number(source.rule_count))) {
      parts.push(`${Number(source.rule_count).toLocaleString('zh-CN')} 条规则`);
    }
    return parts.join(' · ') || (result?.changed === false ? '规则未变化' : '规则更新完成');
  }
  function withMetadata(rule, original) {
    const result = {...rule};
    const same = original && ['url','files','type','dataset'].every(k => String(rule[k] || '').trim() === String(original[k] || '').trim());
    for (const k of ['detected_format','rule_count','last_updated']) {
      if (same && result[k] === undefined && original[k] !== undefined) result[k] = original[k];
      if (original && !same) delete result[k];
    }
    return result;
  }
  async function finishSave(result, refresh) {
    const source = updated(result);
    // FJGAC may save a pending DAT subscription and ask for its dataset only on update.
    if (source?.detected_format) return source;
    const response = await refresh();
    const converted = updated(response);
    // FJGLI confirms a completed update with changed, including an unchanged source,
    // and may omit format/count metadata. Older pending responses still need it.
    if (!converted || (!converted.detected_format && typeof response.changed !== 'boolean')) throw new Error('配置已保存，但来源尚未识别，请检查订阅地址后重试更新。');
    return converted;
  }
  ruleConversionService = {label, updated, message, withMetadata, finishSave};

}
