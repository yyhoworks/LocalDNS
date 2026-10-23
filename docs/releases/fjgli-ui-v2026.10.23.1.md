# FJGLI / UI 2026.10.23.1

合入全量深审修复（[PR #6](https://github.com/yyhoworks/LocalDNS/pull/6)），增加本地配套服务令牌鉴权并修复多处前后端半应用状态与边界问题。

- **本地服务令牌鉴权与默认回环（H1 / H2）**：`localdns-proxy-config`（1.6.0）与 `ui_updater.py` 写操作新增 `Authorization: Bearer <token>` 常量时间校验；全新安装默认监听 `127.0.0.1` 并自动生成 64 位随机令牌写入 `0600` 配置，UI 对应面板新增令牌输入框；存量未配令牌部署升级后保持兼容并输出启动告警。
- **配置服务与工具链加固（M3 / M4 / M10 / M11）**：配置服务 HTTP 导入新增 `importAllowCIDRs`（默认拒绝私网地址，恒拒链路本地与云元数据，禁止 HTTPS 降级重定向）；sing-box 分片组合并上限统一为 `8MiB`；核心安装器与 `install-ui.sh` 补齐临时文件摘要校验与清单外多余文件对账，`configure-ui.py` 增加目录切换崩溃恢复。
- **前端半应用状态与平台层修复（M1 / M2 / M5 / M6 / M7 / M8 / M9）**：规则改名删除旧配置失败时自动重试并提供一键重试入口；分流模式切换改为串行+回读校验与失败自动回滚；纯启停保存加 `configOnly` 标记避免误触发在线规则拉取；`FJGLI` 翻译层完整透传查询参数（如 `?all=1`）；修复 `api.logs()` 相邻空参数漏删；概览首屏请求分项降级、拓扑百分比口径统一。
- **工程与校验链（M12 / M13 / M14）**：`npm run check` 支持全新克隆先构建再校验；新增 GitHub Actions CI（前端 `check` + Python 工具单测 + Go 服务测试）；`src/core` 开启 `@ts-check`。

**已安装 FJGLI 的设备只需更新 UI，无需更换核心或重启 DNS。** 从 FJGAC / FJGIR 跨核心升级仍使用 [完整更新指南](../FJGLI_UPGRADE.md)。

验证：127 项前端单测、58 项 Python 工具链单测、Go 配置服务测试全绿，构建产物与源码指纹及 SHA-256 清单一致。
