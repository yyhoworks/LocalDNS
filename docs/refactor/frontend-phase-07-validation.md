# Phase 0–7 前端重构验证记录

日期：2026-10-19（Asia/Shanghai）。基线：`8d4b9deed5cdbebde50701dbdc11faae45e35ead`。工作分支：`codex/frontend-build-safety`。用户明确选择完成 Phase 0–7。

## 交付范围

| 阶段 | 实现与证据 |
| --- | --- |
| 0 基线与安全网 | 基线 SHA、原始 8 份未跟踪文档清单、三视口 Git 对照、API fixture；预览拒绝真实写入 |
| 1 工具链 | 精确依赖与 lockfile、TypeScript/Vite/Vitest/ESLint、Prometheus 特征测试和干净重建检查；早期 IIFE 过渡已记录 |
| 2 基础设施 | 单一 HttpClient/ApiError、运行时契约、CleanupScope、RouteContext、偏好与 IndexedDB Repository、DOMPurify、共享弹窗/抽屉/通知和图表适配器 |
| 3 Shell | 显式模块初始化、旧 hash 兼容、统一 mount/cleanup、全局搜索、外观/导航、顶栏、版本入口和焦点恢复 |
| 4 功能迁移 | 五个当前路由、外观面板、版本/品牌/代理入口；日志查询/显示模型，上游读写 API、页面快照；规则草稿、冲突检测与子视图取消 |
| 5 CSS | tokens 与 cascade layers、按组件/功能归属回收补丁、兼容编译；三视口和主题/导航对照保持设计语言 |
| 6 发布构建 | 完整 `dist/ui/`、哈希资源、生成 HTML、源与输出 SHA-256、已验证构建打包、UI Update/Full 清单核验 |
| 7 删除兼容层 | 删除 legacy、旧经典业务脚本、旧 CSS 与 window 服务依赖，保留旧偏好读取迁移；更新 README、开发、ADR 与架构文档 |

当前基线已删除的代理编辑器/CodeMirror/9098、服务器规则备份、长期采样与 proxy-config workspace 为 N/A，不恢复历史产品。逐项对应及理由见 [架构文档](frontend-architecture.md)。Phase 1 的稳定 IIFE 路径属于已完成的过渡实现，最终已按 Phase 6–7 切换。

## 实际环境

- Windows、Node 24.20.0、npm 11.19.0、Python 3.13.15。
- Playwright + 已安装的 Microsoft Edge `155.0.4283.62`，headless。
- 三视口：1440×1000、1024×768、390×844；规则编辑器另含短手机视口。
- 所有功能写入使用浏览器内隔离 fixture；没有向真实 DNS 后端执行写操作，没有部署/发布。

## 自动化结果

| 检查 | 结果 | 主要覆盖 |
| --- | --- | --- |
| `npm run --prefix frontend check` | 通过 | 严格 TS、85 项 Vitest、ESLint、临时干净重建与输出指纹一致 |
| 八个既有 Node 回归 harness | 16/16 通过 | 动画、客户端、趋势、规则转换、查询路径、排行耗时、概览/版本、壁纸持久化与失败保留 |
| `python tools/test_package_ui.py` | 14/14 通过 | ZIP 路径/架构/重复项、完整构建、过期/篡改/缺失/新增输入拒绝 |
| `python tools/test_shared_ui.py` | 6/6 通过 | 静态共享配置导入与安全边界 |
| `python tools/test_oneclick_installer.py` | 14/14 通过 | 安装路径、配置保留及失败处理 |
| `npm audit --prefix frontend --audit-level=low` | 0 漏洞 | 当前锁定依赖 |
| `verify_frontend_build.cjs` + Git SHA | 通过 | 三视口×两种动态效果偏好；概览→日志→概览、无溢出/资源错误/新增 warn/error；减少动态效果的三个首屏 PNG 与基线逐字节相同 |
| `verify_frontend_routes.cjs` | 通过 | 五路由 Loading/Success/Empty/Error/Retry；过滤、详情抽屉、弹窗/焦点、不可保存未读取规则、过期日志和不可信文本 |
| `verify_frontend_matrix.cjs` + Git SHA | 通过 | 两皮肤×深浅主题×两桌面导航，三视口；100 个页面组合与基线文本/几何/颜色/字体相同，200 张全页对照图 |
| matrix 生命周期/偏好检查 | 通过 | 集合排列保存后 reload、查询状态恢复、手机25/桌面50条、离开概览后无采样/Chart/流光/临时浮层，规则内部延迟返回隔离 |
| `verify_frontend_actions.cjs` | 通过 | 上游新增/编辑/启停/删除、失败留表单、保存期间禁用、失败回退、删除取消不写；日志分页恢复；缓存清空二次确认 |
| `verify_rules_editor.cjs` | 11 组通过 | 面板继续/放弃、键盘/IME、批量粘贴、路由/刷新保护、原文、拖动撤销、读取失败、1000条筛选、双皮肤导航短屏 |
| `verify_rules_workbench.cjs` | 通过 | DNS 保存失败保留草稿、跨名单隔离、并发修改拒绝、原文往返、批量删除撤销、空闲无 DOM 变动 |
| `verify_shared_ui.cjs` | 10 组通过 | 独立浏览器共享、按需字体、图标回退、真实 Python 导入、无9098请求/意外写入 |
| 可配置 CSP 响应头 | 通过 | preview 参数实际返回 Content-Security-Policy；生产策略需按部署来源配置 |

矩阵保存完整截图，断言文本、主要容器几何、颜色和字体；不声称所有全页 PNG 完全相同。逐像素一致性只针对 build 验收中三个减少动态效果的首屏 PNG。错误路径会触发预期的错误 UI，正常路径矩阵没有新增控制台 error/warn。

报告与截图位于忽略的 `dist/frontend-build-verification/`、`frontend-routes-verification/`、`frontend-matrix-verification/`、`frontend-actions-verification/`、`rules-editor-verification/`、`rules-workbench-verification/`、`shared-ui-verification/`。命令与环境变量见 [开发说明](../DEVELOPMENT.md)。

## 最终构建与包

- 应用：`assets/app-CWQD8Glg.js`；CSS：`assets/index-CzgwvK6q.css`。
- 源指纹：`6220ced9a579b183c8cc0a656658315f3bdf07a70e812037f1a17783037ab1fc`。
- 输入清单133项，输出清单27项，含 `build-meta.json` 共28个 UI 文件；资源不依赖 CDN，服务器无需 Node。
- 根 `VERSION.json` 与 `_src/ui/version.json` 均与 Git 基线原字节一致。下列是使用原版号的本地重构验收候选包，不代表发布了新正式版。

生成命令：

```sh
python tools/package_ui.py --full-base dist/refactor-published-base.zip --base-sha256 38352a0d9eee6a2e36f43e784e03e936c4a9cf1bcd49db86f84e555074bf61c2
```

基础 ZIP SHA-256 来自已核验的公开 Release，另存为 `refactor-published-base.zip` 避免被候选包覆盖。完整包保护逻辑未放宽。

| 候选包 | 文件数 | SHA-256 |
| --- | --- | --- |
| `LocalDNS_UI_2026.10.19.7_Update.zip` | 46 | `a28597576e302a598de222bcbdc19237faa671e9743716719191e43e5e2e885b` |
| `LocalDNS_FJGAC_UI_2026.10.19.7_Full.zip` | 132 | `44e92bbd4d539839ca1f801cafda496fbea8eab2d00427e7fc5eb25fdfd9a45c` |

两包位于 `dist/fjgac-ui-v2026.10.19.7/`，CRC、MANIFEST.sha256、SHA256SUMS.txt 与 UI 全部28文件字节核对通过。完整包85项受保护内容（包括三架构内核、DNS 默认配置、规则和服务）与基础包相同。机器可读结果位于 `dist/frontend-package-verification/report.json`。打包工具自身也在写包后核验全部内容和执行权限。

## 已知边界

- 实际浏览器验收为 Windows Edge。未运行 Safari/iOS、Chrome90/Edge90、Safari14.1 或旧设备；语法目标和 cascade layer 编译不能替代实机验证。
- Node20/22 是声明支持范围；实际执行环境仅 Node24。独立验证脚本已不依赖 Node 原生加载 TS。
- 业务模块迁移为 ESM JS，严格 TS 覆盖基础设施与新增查询模型；没有声称已全量开启 `checkJs`。
- DNS 写入继续使用现有协议。先核对再保存仍不是原子条件更新，无法解决后端未提供的事务隔离。
- 保持当前样式与原有动态 inline style；提供基础 CSP 配置，没有实现 nonce/strict CSP。
- 未压缩的 CSS 在层级兼容编译后约430kB；不将压缩优化混入此次行为迁移。
- 本记录为提交与部署前的验收快照。后续提交与部署由用户另行授权；原有8份未跟踪用户文档保留。
