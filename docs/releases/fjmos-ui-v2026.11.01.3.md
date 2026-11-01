# FJMOS / UI 2026.11.01.3 — 内核升级到 FJMOS

发行标签 `fjmos-ui-v2026.11.01.3`。UI 内容与 2026.11.01.2 相同（七格指标 + 代理流量卡 + 分流刷新变化报告），本版把内核从 FJHAI 换到 FJMOS，并同步版本元数据。

## 内核升级

按上游 `特别注意.html` 的要求，只替换可执行文件，不动配置与规则：

1. 备份：`bin/localdns` 另存为 `bin/localdns.fjhai-<时间戳>`，并把 `bin/localdns`、`config`、`rules/manual` 打成 `pre-fjmos-<时间戳>.tar.gz`；
2. 停止 `localdns` 服务，用 `LocalDNS_FJMOS_Binaries/localdns-amd64-v3` 覆盖 `bin/localdns`（SHA-256 `b9bf3927…1293`，与本机架构一致）；
3. 启动服务，`/api/v1/status` 返回 `"version":"FJMOS"`；
4. DNS 冒烟：`www.baidu.com` 与 `github.com` 均正常返回。

配置目录没有替换，所以上游、自定义规则、订阅、客户端别名与功能开关全部保留（`/api/v1/features` 复核：`client_policy: listed_proxy_only` 等与升级前一致）。旧内核二进制留在原处，回滚只需换回文件并重启服务。

## 版本元数据

`VERSION.json` 的 `backendVersion` 改为 FJMOS，`uiVersion` 2026.11.01.3，标签 `fjmos-ui-v2026.11.01.3`；服务器 `core-version.json` 同步更新。

## 验证

在真实页面上用 CDP 复核（1500×950）：

- 概览：`.console-kpi-row` 内 7 张卡、7 列；代理流量卡 `data-state="ready"`，显示「598 MB / 今日 ↓40.9 ↑557 MB」；
- 系统管理 → 分流刷新 → 「变化报告」按钮存在，点击打开「上次刷新的变化」，内核尚未跑过刷新时显示「还没有运行记录」（`/api/v1/route-refresh/changes` 返回 `{"summary":null}`，属于正常空态）；
- 版本弹窗：「当前内核：FJMOS」，升级服务「已连接」，内核 ZIP 上传入口可用。

## 注意

手动部署 UI 会覆盖 `ui/config.js`，而升级服务地址是 `install_ui_updater.py` 追加在这个文件末尾的。部署后必须确认 `localdns-ui-updater` 标记块还在，否则「在线升级」会连不上——本次已修复并写进部署脚本。
