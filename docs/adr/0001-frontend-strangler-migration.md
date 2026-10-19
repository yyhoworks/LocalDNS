# ADR 0001：渐进迁移并切换完整静态构建

- 状态：接受，Phase 0–7 已实施（2026-10-19 更新）
- 基线：`8d4b9deed5cdbebde50701dbdc11faae45e35ead`
- 过程记录：[Phase 0+1 验证](../refactor/frontend-phase-01-validation.md)

## 背景

基线通过多个同步经典脚本和 `window.LocalDNS*` 互相协作。第一阶段保留 IIFE 入口，引入锁定的 TypeScript/Vite/Vitest/ESLint 工具链和 Prometheus 特征测试。用户随后明确要求实施 Phase 0–7，允许完成路由与发布构建切换。

## 最终决策

1. `frontend/index.html`、`frontend/src/entry/app.ts` 和显式 ESM 为唯一维护入口。业务按功能模块组织；基础设施用严格 TS，迁移 JS 保留行为并参与 lint。
2. 五个 hash 路由统一实现 `RouteModule.mount(container, context)`；`CleanupScope` 管理请求、监听、定时器和临时 UI，规则通过 async `canLeave` 保护草稿，内部标签/名单使用可替换的子作用域。
3. 启动依赖通过明确的初始化调用连接，删除经典业务脚本、服务全局和 legacy 入口。保留 `LOCALDNS_UI_CONFIG` 配置与必要 Chart.js vendor。
4. CSS 按 tokens/base/components/features/utilities 分层，构建时编译 cascade layers；不同时改版视觉。
5. Vite 生成完整 `dist/ui/`、内容哈希资源和 HTML。普通 bundle 不提交；`_src/ui/` 保留公共字体、图片、共享默认设置、运行时配置和版本副本。
6. 元数据记录构建源及全部输出 SHA-256；干净重建必须相同。打包工具读取已验证构建，原完整包保护逻辑继续生效。
7. 保持 `/ui/`、现有 hash、API、偏好键、静态离线运行和版本不变；无需服务器安装 Node.js。

## 范围修正

基线已删除代理配置编辑器、CodeMirror、9098、服务器备份与长期采样，不恢复这些历史产品。当前代理外链入口、会话采样和 DNS 名单写入保持。[架构文档](../refactor/frontend-architecture.md) 说明与计划的对应关系。

## 回滚与后果

发布前可整体回滚重构源变更并恢复旧打包入口；部署后使用上一完整 UI 备份回退。HTML 与哈希资源必须作为同一静态目录替换。无服务器数据格式迁移，无偏好长期双写。本次没有执行部署或版本发布。

构建机现在需要 Node 工具链；运行服务器仍不需要。ESM 提取不等于全量业务 TypeScript 重写；现有行为通过特征、契约、浏览器和打包测试约束。详细验证与未验证环境见 [最终验证](../refactor/frontend-phase-07-validation.md)。
