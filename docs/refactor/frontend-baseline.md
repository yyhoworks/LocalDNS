# 前端重构基线（Phase 0 + Phase 1）

> 历史阶段快照。用户随后确认完成 Phase 0–7；当前实现与最终验证见 [完整验证记录](frontend-phase-07-validation.md)。下文的过渡路径和范围保留用于追溯。

## 仓库与范围

- 检查日期：2026-10-19（Asia/Shanghai）。
- 起始分支：`main`。
- 基线 SHA：`8d4b9deed5cdbebde50701dbdc11faae45e35ead`。
- 起始 `git status --short`：8 个未跟踪文档，位于 `docs/releases/local-ui-v2026.10.19.{1..5}.md` 和 `docs/validation/{overview-alignment-2026.10.19.4,ui-audit-2026.10.19.2,ui-fixes-2026.10.19.3}.md`；保留原样。
- 当前版本：UI `2026.10.19.7` / 后端 `FJGAC`。根与 UI 的版本 JSON 内容相同，基线文件换行不同，本轮两个文件均保持原字节。
- 启动任务书列出的 `tools/build_proxy_config_ui.cjs` 和 `tools/proxy-config-ui/package.json` 当前不存在。README 和 DEVELOPMENT 记录其已在 `.7` 移除，本轮不重建。
- 没有发现适用的 `AGENTS.md`。

仅建立前端构建、测试、文档和首个纯函数模块；不修改 DNS 核心、API、9098、页面、CSS、文字、布局、用户流程、版本或发布说明。

## script 加载顺序

来源：基线 `_src/ui/index.html`。全部是同步经典脚本，无 `async`、`defer`、`type="module"`；下列顺序和原有 query string 保持不变。

| 位置 | 顺序（相对 `/ui/`，省略版本查询参数） |
| --- | --- |
| head | `assets/js/shared-ui.js` → `appearance.js` → `skin.js` → `navigation.js` |
| body 尾部 | `config.js` → `assets/js/chart.umd.min.js` → `traffic.js` → `traffic-client.js` → `identity.js` → `rule-conversion.js` → `console.js` → `wallpaper.js` → `font-uploads.js` → `topology-flow.js` → `query-path.js` → `rank-latency.js` → `overview-insights.js` → `version-check.js` → `workspace.js` → `collection-layouts.js` → `clients.js` → `proxy-panel.js` → `rule-save.js` → `app.js` → `appearance-panel.js` → `material.js` → `navbar.js` → `rules-view.js` → `rules-workbench.js` |

除 `config.js` 外，表中缩写的脚本均在 `assets/js/`。`app.js` 的标签仍为 `assets/js/app.js?v=20261019-7`。

## app 全局依赖和初始化

- 配置：`window.LOCALDNS_UI_CONFIG`（`config.js`），在 app 运行时读取一次。
- 必需协作者：`LocalDNSShared`（`shared-ui.js`，其 `ready` Promise 控制初始化）、`LocalDNSWorkspace`（`workspace.js`）、`LocalDNSCollections`（`collection-layouts.js`）、`LocalDNSClients`（`clients.js`）、`LocalDNSOverview`（`overview-insights.js`）、`LocalDNSQueryPath`（`query-path.js`）、`LocalDNSRuleConversion`（`rule-conversion.js`）、`LocalDNSRuleSave`（`rule-save.js`）。部分只在对应页面/操作中直接调用。
- 可选调用：`LocalDNSInterface`（`console.js`）、`LocalDNSIdentity`（`identity.js`）、`LocalDNSTypography`（`appearance.js` / `font-uploads.js`）、`LocalDNSWallpaper`、`LocalDNSSkin`、`LocalDNSTopologyFlow`、`LocalDNSProxyPanel`、`LocalDNSRules`（后加载的 `rules-view.js`）。
- 图表通过 `window.Chart` 检查后调用 Chart.js。其余使用浏览器 DOM、fetch、AbortController、URLSearchParams、matchMedia、storage、history、requestAnimationFrame 等原有 Web API。
- app IIFE 立即注册处理器，末尾立即 setup workspace/collections；在 `LocalDNSShared.ready.then(...)` 中执行 `initShell`、限制刷新周期、设置 interface、读取 aliases 并导航。构建不能引入异步模块加载或延迟这个边界。

## 打包与验证入口

`python tools/package_ui.py` 直接读取 `VERSION.json` 和 `_src/ui`，校验两份版本 JSON，生成 `dist/<releaseTag>/` 下 UI ZIP、文件清单和 SHA-256。传入已验证 `--full-base` 才生成完整包。本轮保留此入口，不在 Python 内安装 npm 依赖。

| 基线命令 | 前提 / 范围 |
| --- | --- |
| `python tools/test_package_ui.py` | Python；8 个内核归档结构、安全路径和架构测试，不启动核心 |
| `python tools/package_ui.py` | Python；使用已提交静态文件，不需要 Node.js |
| `node tools/test_countup.cjs` | Node；原测试从 app 文本提取函数，构建器排版后需改读 legacy 维护入口 |
| `node --test tools/test_traffic.cjs tools/test_rule_conversion.cjs tools/test_query_path.cjs tools/test_rank_latency.cjs tools/test_overview_insights.cjs tools/test_clients.cjs` | Node；纯前端回归，无真实后端写入 |
| `node --test tools/test_wallpaper.cjs` | 额外依赖 `deployment/tools/wallpaper-test-deps/node_modules/fake-indexeddb` |
| `node tools/verify_ui_merge.cjs` | Playwright 可被 require、Edge、`LOCALDNS_PREVIEW_BACKEND`；含历史布局假设，非新建单元测试 |
| `node tools/verify_navigation.cjs` | Playwright、Edge、可用的真实后端；经只读代理 |
| `node tools/verify_overview_insights.cjs` / `verify_appearance_layout.cjs` | Playwright、Edge、真实后端，含历史布局验收 |
| `node tools/verify_rules_workbench.cjs` / `verify_rules_editor.cjs` | Playwright、Edge；规则写入在隔离夹具内 |
| `node tools/verify_shared_ui.cjs` | Playwright、Edge、Python、`LOCALDNS_TEST_BACKEND`；共享配置和导入仅写本地夹具 |

本机 Node `24.20.0`、npm `11.19.0`、Python `3.13.15`；现有 bundled Playwright、Edge 与 fake-indexeddb 可用。`127.0.0.1:9099` 无服务；现有局域网后端的审计状态 GET 返回 200，后续仅经只读代理访问。

## 迁移和回滚

见 [ADR 0001](../adr/0001-frontend-strangler-migration.md)、[ADR 0002](../adr/0002-frontend-api-boundary.md)。维护 `frontend/src`、提交生成物、临时重建比对；回滚整个本轮改动即可恢复旧静态 app，无数据迁移。其他经典脚本和页面生命周期留到后续阶段。

## 本轮验证记录

实际命令、结果、浏览器证据和未验证范围见 [Phase 0 + Phase 1 验证记录](frontend-phase-01-validation.md)。

新命令为 `npm ci --prefix frontend`、`npm run --prefix frontend build`、`npm run --prefix frontend check`。独立生成物比对为 `npm run --prefix frontend verify:generated`。浏览器夹具 smoke 为 `node tools/verify_frontend_build.cjs`（需 Playwright 和 Edge）；可选 `LOCALDNS_FRONTEND_BASELINE` 开启 Git 基线对比。

构建器：Vite 7.3.7 / Rollup，TypeScript 5.9.3、Vitest 4.1.12、ESLint 10.13.0。单文件 IIFE 不设置 bundle name，未生成新的 window 包装名；保留内层旧 IIFE。语法目标固定 ES2020、Chrome/Edge 90、Safari 14.1。基线未声明正式浏览器最低版本，这里仅明确构建语法下限，不新增 polyfill 或改变原有 Web API 要求；Safari 实机验证尚未执行。
