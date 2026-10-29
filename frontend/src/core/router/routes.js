// @ts-check
const routeDefs = [
  {
    id: 'overview',
    label: '概览',
    icon: 'overview',
    navSvg: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 14a4 4 0 1 1 4-4 4 4 0 0 1-4 4Z"/>',
    subtitle: '实时查看 DNS 运行状态与关键指标',
    keywords: ['概览', '运行概览', 'overview']
  },
  {
    id: 'logs',
    label: '日志',
    icon: 'logs',
    navSvg: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    subtitle: '搜索、筛选并分析 DNS 请求记录',
    keywords: ['日志', '查询日志', 'logs']
  },
  {
    id: 'upstreams',
    label: '解析',
    icon: 'upstream',
    navSvg: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    dot: true,
    subtitle: '管理上游 DNS 服务器并查看请求、采纳与错误统计',
    keywords: ['解析', '上游', 'dns', 'dns管理', 'upstreams']
  },
  {
    id: 'rules',
    label: '分流',
    icon: 'rules',
    navSvg: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    subtitle: '统一维护名单、广告拦截与在线分流规则',
    keywords: ['分流', '规则', '规则管理', 'rules']
  },
  {
    id: 'devices',
    label: '设备',
    icon: 'clients',
    navSvg: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    subtitle: '统一管理内网客户端分流策略（全员分流 / 指定 FakeIP / 指定 RealIP）、受控名单与设备别名',
    keywords: ['设备', '客户端', '别名', 'devices', 'clients']
  },
  {
    id: 'proxy-config',
    label: '代理',
    icon: 'system',
    navSvg: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/>',
    subtitle: '管理 Mihomo / sing-box 配置，支持 HTTP 获取与保存应用',
    keywords: ['代理', '代理配置', 'proxy', 'proxy-config']
  },
  {
    id: 'management',
    label: '系统',
    icon: 'management',
    navSvg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0-4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    subtitle: '功能开关、缓存与运行数据管理',
    keywords: ['系统', '系统管理', '管理', '设置', 'management']
  }
];
export { routeDefs };
