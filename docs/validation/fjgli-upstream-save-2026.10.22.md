# FJGLI 上游保存修复验收

日期：2026-10-22。UI：2026.10.22.2。

## 原因

旧界面使用 `POST /api/v1/upstream/config` 和 `plugin_tag` 请求字段。FJGLI 保留该路径，但把字段改为 `group`，旧字段返回 HTTP 400。此前兼容模块直接转发全部上游请求，遗漏了请求体转换。

## 修复及验证

- 上游读请求继续直接转发；写请求识别核心能力。FJGLI 保存时移除 `plugin_tag` 并写入 `group`，旧核心保持原格式。
- 不丢弃节点配置及 ECS；冲突的分组字段拒绝提交；错误请求不重复尝试。
- 新增四组上游及旧核心兼容测试，兼容模块共 11 项，完整前端共 114 项测试；类型检查、ESLint、构建完整性验证通过。
- 在 `.7` 复现旧请求的 HTTP 400 和 `unknown field "plugin_tag"`。
- 将实际 TypeScript `BackendClient` 和 `HttpClient` 编译后连接 VM，分别读取并按原值保存 domestic、foreign、foreign_ecs、proxy，均成功；逐次回读配置等价，ECS 不变。
- 原上游配置已单独备份。部署只更新 UI，保留 DNS 核心、运行进程及全部用户配置。

旧版跨核心迁移范围与限制仍参见 [FJGLI 迁移验收](fjgli-upgrade-2026.10.22.md)。
