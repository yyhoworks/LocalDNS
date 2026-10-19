# Phase 0 + Phase 1 验证记录

> 历史阶段快照。用户随后确认完成 Phase 0–7；当前实现与最终验证见 [完整验证记录](frontend-phase-07-validation.md)。下文的过渡路径和范围保留用于追溯。

日期：2026-10-19（Asia/Shanghai）。基线：`8d4b9deed5cdbebde50701dbdc11faae45e35ead`。工作分支：`codex/frontend-build-safety`。

## Summary

完成基线与两份 ADR、独立前端工程、原 app 的可重复 IIFE 构建、两个 Prometheus 纯函数迁移、特征测试、生成物校验、打包和浏览器 smoke。现有 HTML、CSS、运行时配置、其他业务脚本、版本和后端均未改动。

本轮实施项完成，下面列出实际验证边界；没有把 Safari 实机或其他页面的完整功能验证计作通过。未部署、未修改真实后端、未发布版本。

## Files changed

| 分类 | 文件 |
| --- | --- |
| 源码与工具链 | `frontend/package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`eslint.config.mjs`、`src/legacy/app.js`、`src/shared/metrics/prometheus.ts`、根 `.gitignore` |
| 生成物 | `_src/ui/assets/js/app.js` |
| 测试与校验 | `frontend/tests/prometheus.test.ts`、`frontend/scripts/verify-generated.mjs`、`tools/test_countup.cjs`、`tools/verify_frontend_build.cjs` |
| 文档 | `docs/DEVELOPMENT.md`、`docs/adr/0001-frontend-strangler-migration.md`、`docs/adr/0002-frontend-api-boundary.md`、`docs/refactor/frontend-baseline.md`、本文 |

## Architecture decisions

- 使用经典 IIFE 保持同步 script 加载、原有闭包、全局协作者和 `LocalDNSShared.ready` 边界；未设置 bundle name，没有新增运行时全局 API。
- Rollup 显式配置单入口、`inlineDynamicImports`、无压缩、无 source map、关闭 tree-shaking。输出固定为 `app.js`，不清空同目录其他脚本。
- 继续提交并从 `_src/ui` 打包生成物，让部署和 Python 打包环境保持不依赖 Node.js。
- `verify:generated` 在系统临时目录重建，要求只输出 `app.js`，用 VM 编译检查经典脚本语法，逐字节比较当前生成物，清理时检查临时目录边界。
- 两个函数保留原正则、标签解码次序、输入/数字转换及缺失返回值。`+Inf`、异常文本仍得到 NaN，`Infinity` 仍保留，带时间戳的行仍被忽略。新模块不读取 window 或网络。

## Validation

环境：Windows，Node 24.20.0、npm 11.19.0、Python 3.13.15；依赖使用锁文件。最终安装审计为 0 vulnerabilities。npm 对 esbuild postinstall 的本机 allowScripts 提示未导致安装或构建失败。

| 实际命令 / 检查 | 结果 | 未运行原因或范围 |
| --- | --- | --- |
| `npm ci --prefix frontend` | 通过，136 个包安装完成 | 使用最终锁文件 |
| `npm run --prefix frontend build` | 通过，单个 `app.js` | 不压缩、无 map，约 187.47 kB |
| `npm run --prefix frontend check` | 通过 | typecheck、41 条 Vitest 测试、ESLint 零警告、临时重建比对 |
| `python tools/test_package_ui.py` | 通过，8 tests | 内核归档结构/路径/架构测试，不运行核心 |
| `python tools/package_ui.py` | 通过 | 仅 UI 包，无安装/部署 |
| `node --test tools/test_countup.cjs tools/test_traffic.cjs tools/test_rule_conversion.cjs tools/test_query_path.cjs tools/test_rank_latency.cjs tools/test_overview_insights.cjs tools/test_clients.cjs tools/test_wallpaper.cjs` | 通过，Node 报告 16 tests | 8 个测试文件，部分文件内部使用多条 assert；壁纸使用已有 fake-indexeddb |
| `node tools/verify_frontend_build.cjs`（设置下列两个环境变量） | 通过，8 个浏览器场景 | 2 个脚本版本 × 2 个视口 × 2 个动态效果偏好；全部为夹具 |
| legacy 源码逐字节对比 | 通过 | 相对基线仅新增 import 并删除两个原函数，其他字节保持 |
| `index.html`、`config.js`、两份版本文件逐字节对比基线 | 通过 | 两份版本 JSON 语义一致；原有 LF/CRLF 差别保持 |
| 历史 `verify_ui_merge.cjs` 等整套视觉回归 | 未执行 | 涵盖历史布局和无关页面；本轮运行纯前端回归及针对迁移的新 smoke，不声称全部历史验证通过 |
| Safari 实机 | 未执行 | 当前 Windows 环境没有 Safari；构建固定 `safari14.1` 语法目标，不补 Web API polyfill |

浏览器比较命令在 PowerShell 中实际使用：

```powershell
$env:LOCALDNS_PLAYWRIGHT='C:/Users/dev/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
$env:LOCALDNS_FRONTEND_BASELINE='8d4b9deed5cdbebde50701dbdc11faae45e35ead'
node tools/verify_frontend_build.cjs
```

UI 包位置：`dist/fjgac-ui-v2026.10.19.7/LocalDNS_UI_2026.10.19.7_Update.zip`。SHA-256：`bd033e9f217c75297bbe58bb7b8d47655d92667123582cab7960a4c02fb20dca`。Python 打包脚本未改动，仍使用已提交静态文件。

## Browser QA

### Browser 工具：Chrome + 真实后端只读读取

- URL：`http://127.0.0.1:8795/ui/`、`#/logs`、`#/overview`。
- 预览：现有 `tools/preview_ui.cjs`，仅经允许列表代理 GET；未对真实后端执行写入。
- 视口：1440×1000、390×844。
- 标题：`LocalDNS 控制台`；服务摘要可见，6 个 KPI 已渲染；桌面和手机均完成概览 → 查询日志 → 概览。
- 页面无 Vite 覆盖层；横向溢出均为 0；Chrome 捕获的 warn/error 为空。
- 本地证据（忽略、不提交）：`dist/frontend-browser-live/chrome-mobile.png`、`chrome-dom.txt`。
- 首次视口控制曾超时，按 Browser 恢复流程重新读取页面后继续；后续验证完成。

### Playwright：Edge + 隔离夹具 / Git 基线

- URL：本次 `http://127.0.0.1:63449/ui/`（随机端口，测试结束后关闭）。
- 浏览器：Edge `155.0.4283.62`，headless；Playwright 路径见实际命令。
- 视口：1440×1000、390×844；各跑 `reduce` 与 `no-preference`，分别加载原 app 和生成 app。
- 所有场景均成功切换概览 → 查询日志 → 概览，标题正常、页面非空、资源正常，app 返回 200。
- DOM 文字、关键布局矩形、script 顺序和 window 枚举属性与基线一致；两个指标函数没有暴露到 window。
- 页面 error、控制台 error/warn、HTTP 资源错误均为空；所有场景横向溢出为 0。
- 减少动态效果时流光数量为 0；普通模式原/新脚本均显示 9 条流光；两个视口在 reduce 下的首屏 PNG 字节完全一致。
- 整页截图留作人工证据。初次对比时浏览器整页截图在一个 1px 高的拼接边缘产生差异，未把整页 PNG 字节作为验收断言；首屏 PNG、页面内容和布局分别比较。
- POST、PUT、DELETE 与 GET `/plugins/cache_main/flush` 均由只读预览返回 403；夹具后端共收到 296 个请求，全部为 GET。探测不会转发到真实后端。
- 本地证据（忽略、不提交）：`dist/frontend-build-verification/report.json`，`{baseline,generated}-{1440,390}-{reduce,no-preference}.json/.png` 和相应 `-full.png`。

## Remaining risks

- 其他经典脚本仍依赖全局对象和加载顺序；页面生命周期和 CSS 分层尚未迁移。
- legacy JS 暂未进行全量类型检查或 lint；本轮只检查新的 TS、配置和校验脚本。
- Safari 和较旧 Chrome/Edge 仅有构建语法目标，未在这些实机版本验证；原有 Web API 要求继续存在。
- 真实后端只验证概览与查询日志读取路径，未把其他页面或任何真实写入计作通过。

## Diff review

- 无版本、Release tag、CHANGELOG 或发布说明改动；根/UI 版本文件原字节保持。
- 无 DNS 核心、后端、API、9098 服务、HTML、CSS 或运行时配置改动。
- legacy 除两个函数迁移外原样保留，无无关格式化；生成物较大 diff 来自构建器排版。
- `node_modules`、包、截图、DOM、报告和临时目录均被忽略；保留原有 8 个未跟踪文档，未纳入本轮文件。
