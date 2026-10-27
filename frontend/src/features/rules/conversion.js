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
    if (result?.savedButUnrecognized) return '配置已保存，但来源尚未识别';
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
  async function finishSave(result, refresh, options = {}) {
    const source = updated(result);
    // FJGAC may save a pending DAT subscription and ask for its dataset only on update.
    if (source?.detected_format) return source;
    // Lightweight saves (options.configOnly, e.g. enable/disable toggles) stop
    // here: the refresh below performs a real subscription update against the
    // provider, which a config-only toggle must never trigger.
    if (options.configOnly) return source || result;
    const response = await refresh();
    const converted = updated(response);
    // FJGLI confirms a completed update with changed, including an unchanged source,
    // and may omit format/count metadata. Older pending responses still need it.
    // PUT 本身已成功：未识别不再抛错（抛错会让调用方按失败呈现且不刷新列表，
    // 还会跳过改名后的旧配置清理），改返回标记，由调用方走成功/警告通道并刷新列表。
    if (!converted || (!converted.detected_format && typeof response.changed !== 'boolean')) return {savedButUnrecognized:true};
    return converted;
  }
  // 改名/换组保存后删除旧配置：失败自动重试一次。两次都失败返回 false，
  // 由调用方如实提示「新配置已保存，旧配置未能删除」并提供重试入口，
  // 不再把已成功的保存整体误报为失败。
  async function deleteOriginalWithRetry(remove) {
    try { await remove(); return true; }
    catch { try { await remove(); return true; } catch { return false; } }
  }
  ruleConversionService = {label, updated, message, withMetadata, finishSave, deleteOriginalWithRetry};

}
