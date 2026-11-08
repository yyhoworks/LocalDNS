const domestic = ['电信', '联通', '移动', '广电', '阿里', '腾讯', '百度', '114'];
const foreign = ['Cloudflare', 'Google', 'Quad9', 'OpenDNS'];

export function providerOptions(group: string): readonly string[] {
  if (group === 'domestic') return domestic;
  if (group === 'foreign' || group === 'foreign_ecs') return foreign;
  return [];
}

/** Preserve all unmanaged node fields; provider is supported only by the verified new core. */
export function withProvider<T extends Record<string, unknown>>(
  node: T, group: string, value: string, supported: boolean,
): T {
  if (!supported || group === 'proxy') return node;
  const provider = value.trim();
  if (!provider) throw new Error('请选择或填写服务商；同一服务商请使用相同名称。');
  return { ...node, provider };
}
