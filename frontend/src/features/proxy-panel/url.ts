export function validPanelURL(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(text)) throw new Error('请输入以 http:// 或 https:// 开头的完整地址。');
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('面板地址格式不正确，请检查主机和端口。'); }
  if (!url.hostname || url.username || url.password) throw new Error('请使用不含用户名和密码的面板地址。');
  return url.href;
}

export function panelIconCandidates(value: unknown, dark: boolean): string[] {
  const url = new URL(validPanelURL(value));
  url.search = ''; url.hash = '';
  if (/\.[a-z0-9]+$/i.test(url.pathname)) url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  else if (!url.pathname.endsWith('/')) url.pathname += '/';
  const names = dark ? ['favicon-dark.svg', 'favicon.svg', 'apple-touch-icon.png', 'favicon.ico'] : ['favicon.svg', 'apple-touch-icon.png', 'favicon.ico'];
  return [...new Set([...names.map(name => new URL(name, url).href), new URL('/favicon.ico', url).href])];
}
