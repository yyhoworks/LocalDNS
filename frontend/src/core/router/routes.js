// @ts-check
const routeDefs = [
    {section:'概览', id:'overview', label:'运行概览', icon:'overview', subtitle:'实时查看 DNS 运行状态与关键指标'},
    {section:'观测', id:'logs', label:'查询日志', icon:'logs', subtitle:'搜索、筛选并分析 DNS 请求记录'},
    {section:'分流', id:'upstreams', label:'DNS管理', icon:'upstream', subtitle:'管理上游 DNS 服务器并查看请求、采纳与错误统计'},
    {section:'分流', id:'rules', label:'规则管理', icon:'rules', subtitle:'统一维护名单、广告拦截、在线分流与自动分流规则'},
    {section:'系统', id:'management', label:'系统管理', icon:'management', subtitle:'功能开关、缓存与运行数据管理'},
    {section:'分流', id:'proxy-config', label:'代理配置', icon:'globe', subtitle:'管理 Mihomo / sing-box 配置，支持 HTTP 获取与保存应用'},
  ];
export { routeDefs };
