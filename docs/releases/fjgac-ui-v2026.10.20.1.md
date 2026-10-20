# FJGAC / UI 2026.10.20.1

## DNS 趋势与采样修复

- 趋势图支持 QPS、主缓存命中率和上游平均延迟，逐项切换查看。
- 默认 1 小时，可选 15 分钟、1 小时、6 小时和 24 小时；当前浏览器保留最近 24 小时历史，刷新后恢复。
- 实时采样与浏览器历史读写并行，进入概览即开始采集。首次约 2 秒补采，之后每 5 秒更新；实机首次约 2.8 秒出图，实际耗时取决于网络与页面加载。
- 长时段按指标权重汇总并保留峰值，支持鼠标、手机点选和键盘检查。
- 合入 clone-fan 的 [PR #4](https://github.com/yyhoworks/LocalDNS/pull/4)，保留拓扑交互并遵循系统减少动态效果偏好。

历史保存在当前浏览器，并按 DNS API 地址隔离。关闭网页、离开概览或后台休眠期间不采样，未采集时段留空；其他设备没有这份浏览器历史。

## 下载与更新

- `LocalDNS_FJGAC_UI_2026.10.20.1_Full.zip`：新安装完整包，包含 FJGAC 核心及当前 UI。
- `LocalDNS_UI_2026.10.20.1_Update.zip`：已有安装更新 UI。
- `SHA256SUMS.txt`：两个发行包的 SHA-256 校验值。

已安装网页更新执行端的用户，可在「版本与更新」升级 UI；也可使用一键安装器更新。UI 更新保留现有 DNS 核心、配置、规则、站点配置、Logo 和字体。DNS 核心仍为 FJGAC，本版不增加服务器采样组件。

[安装说明](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.20.1/INSTALL.md) · [DNS 趋势说明](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.20.1/docs/DNS_TRENDS.md) · [采样修复验证](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.20.1/docs/validation/dns-trends-startup-fix-2026.10.20.md)
