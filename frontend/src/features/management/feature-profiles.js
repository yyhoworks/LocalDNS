/** Descriptions follow the core's actual feature semantics, including OFF behavior. */
export const switchProfiles = [
  {
    tag: 'switch1', key: 'request_blocking', group: 'filter', name: '请求屏蔽',
    desc: '控制屏蔽名单、PCDN 与无结果请求', on: '屏蔽名单、PCDN 与无结果请求', off: '关闭请求屏蔽，正常解析请求',
  },
  {
    tag: 'switch5', key: 'block_special_qtypes', group: 'filter', name: '类型屏蔽',
    desc: '控制特殊 DNS 记录类型', on: '屏蔽所有域名的 HTTPS、SVCB、SOA、PTR', off: '仍屏蔽 FakeIP 域名的 HTTPS、SVCB',
  },
  {
    tag: 'switch7', key: 'adguard', group: 'filter', name: '广告屏蔽',
    desc: '控制 AdGuard 广告规则', on: '使用 AdGuard 在线规则拦截广告', off: '不使用 AdGuard 广告规则',
  },
  {
    tag: 'switch6', key: 'block_aaaa', group: 'filter', name: 'IPv6 屏蔽',
    desc: '控制 AAAA 请求', on: '屏蔽全部 AAAA 请求，仅返回 IPv4', off: '正常解析 AAAA 请求',
  },
  {
    tag: 'switch13', key: 'full_cache', group: 'cache', name: '核心缓存',
    desc: '控制最终解析结果的缓存', on: '缓存最终解析结果', off: '每次请求均经过分流解析',
  },
  {
    tag: 'switch4', key: 'route_cache', group: 'cache', name: '过期缓存',
    desc: '控制过期缓存的响应方式', on: '先返回保留的旧结果，后台刷新', off: '缓存过期后等待上游的新结果',
  },
  {
    tag: 'prefetch', key: 'prefetch', group: 'cache', optional: true, name: '缓存预取',
    desc: '控制内核的缓存预取', on: '允许内核执行缓存预取', off: '停止预取，保留正常缓存读写',
  },
  {
    tag: 'switch2', key: 'client_policy', value: 'listed_proxy_only', group: 'client', name: '指定 Client FakeIP',
    desc: '控制客户端名单之外的分流', on: '客户端名单之外的设备全部直连', off: '不限制名单之外设备的代理解析',
  },
  {
    tag: 'switch12', key: 'client_policy', value: 'listed_direct', group: 'client', name: '指定 Client RealIP',
    desc: '控制客户端名单之内的分流', on: '客户端名单之内的设备全部直连', off: '不强制名单之内的设备直连',
  },
];
