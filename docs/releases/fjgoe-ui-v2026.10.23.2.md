# FJGOE / UI 2026.10.23.2

升级至 **FJGOE** 内核，新增 `amd64-v2` 指令集架构二进制与自适应多核 CPU 支持，并完成「重启内核」双入口（组合方案 A + C）界面优化。

- **FJGOE 自适应多核 CPU 内核**：支持自适应多核调度；日常使用推荐分配双核即可满足性能需求，四核环境可获得更高 QPS 压测吞吐。
- **新增 `amd64-v2` 架构二进制（四档平台覆盖）**：`LocalDNS_FJGOE_Binaries/` 新增 `localdns-amd64-v2`，打包、一键安装器与完整更新工具全面支持四档平台选择：
  - `amd64-v1`：SSE、SSE2 等基础指令（兼容所有 x86-64）
  - `amd64-v2`：SSE3、SSSE3、SSE4.1、SSE4.2、POPCNT 等（适合 J4125 等软路由处理器）
  - `amd64-v3`：AVX、AVX2、FMA、BMI1、BMI2 等（主流新架构）
  - `arm64`：Linux ARM64（`aarch64`）
- **「重启内核」双入口组合优化（方案 A + C）**：
  - **方案 A（系统管理首屏双卡）**：将 `DNS 核心服务` 卡片移至 `系统管理` 页首屏第一行，与 `代理面板` 并列展示，配有运行状态徽章与琥珀色「重启内核」按钮，无需滚动到底部即可直达。
  - **方案 C（左侧导航栏底部常驻）**：在左侧导航栏底部状态区集成全局「重启内核」按钮（支持展开与折叠态），任意页面均可一键平滑重启 DNS 内核。

**升级与备份说明**：
- 跨核心更新至 `FJGOE` 请使用完整包中的 `upgrade-localdns.py`（或手动按备份流程操作）：先将原运行目录下的 `/opt/localdns/config/upstreams`（上游配置）、`/opt/localdns/rules/manual`（自定义规则）、`/opt/localdns/config/settings/client_aliases.json`（客户端别名）及 `/opt/localdns/config/subscriptions`（广告与分流订阅）下载备份，再部署新版本并恢复原有设置，详见 [完整更新指南](../FJGLI_UPGRADE.md)。
