# 概览内容块自定义 · 修复与预发布验证

目标环境：192.168.8.2（Alpine-YoPilot，UI 2026.11.01.9 / 内核 FJMOS）。
分支：`fix/overview-block-reorder`（PR #32 的 head），修复提交 `9aed79b`。

## 修复内容

1. **默认顺序改写布局**：`OVERVIEW_BLOCKS` 的顺序与样式表既有的 order 设计不一致（把快捷控制排在服务之前、拓扑排在图表之前），`applyBlockOrder` 每次渲染都写 inline order，导致从没改过顺序的用户也会看到概览布局变化。默认顺序改为与 `overview.css` / `base.css` 的 order 规则一致。
2. **排序在静默刷新后丢失**：原实现用 `queueMicrotask` 补应用，但 shell 增强（`interface.js` 的 `overview()`）由 router 的 `apply()` 在 `await route.mount()` 之后同步执行，晚于该微任务；增强后新建的 `details.console-shortcuts` 没有 inline order，30 秒静默刷新后跳回样式表值。改为 `MutationObserver` 观察 `#page-content` 子节点变化后补应用，离开概览路由时断开。
3. **入口不可见**：概览页标题行由 `shared/workspace.js` 的 `finish()` 对 overview 路由设 `hidden`，`#29` 放在标题行里的「自定义显示」按钮在成品页面上不存在。入口改到顶部工具栏（`icon-action-btn` + overview 图标），仅概览路由显示。
4. 复选框补回 `aria-label`，读屏不再把描述小字读进名字。

## 部署

- 用构建产物覆盖 `/opt/localdns/ui`，保留运行时 `config.js`（升级服务入口）与 `custom/`（站点设置、Logo、壁纸、流量数据）。
- 备份：`/opt/localdns/ui-backup-overview-fix-20261102-102100.tar.gz`（部署前的 2026.11.01.9 原样，49 个条目）。
- 上传包：`/var/tmp/ui-overview-fix-20261102b.tar.gz`（md5 与本地一致）。
- `version.json` 未改动（仍为 2026.11.01.9），便于升级面板继续按正式版比较。
- DNS 内核与升级服务未重启，部署前后 PID 9571 / 9573 不变。

部署后文件（SHA-256）：

| 文件 | SHA-256 |
| --- | --- |
| `ui/index.html` | `03a7523c3f8461fca7d5842ff95c929dfe343ec51dc6dc2a4ef336f8edfa397c` |
| `ui/assets/app-DfA2GVV0.js` | `465fe8c4c7082257c790a5ee4c7592c63f8501019c73710e3af39bbb17c63cef` |
| `ui/build-meta.json` | `0bd838f28f2d9c99aba8d8c34d8f515d828724a42949576b2b7a7fb40afeb2b8` |
| `ui/config.js`（保留） | `7ab78a8fa7edf8bb84a7887701c7a520c6ed0a76be7c9ebcf7819ce3b3c0bc9a` |
| `ui/custom/settings.json`（保留） | `dd467ff07380c4050fd1ac767a2527c3e97084c9fe27381ed9caadb6dd8bfaed` |

## 验证

- 前端 `npm run check`：构建、类型、269 项测试（31 文件）、ESLint、干净重建一致性、字体子集全部通过。
- 服务端 `http://127.0.0.1:9099/ui/` 返回的 `index.html` 与本地构建同摘要；`/ui/assets/app-DfA2GVV0.js` 可正常取回。
- Edge（Playwright，1440×1100）连真实后端实测：
  - 入口在顶部工具栏可见（38×38，`aria-label="自定义概览显示内容"`），`#/logs` 上 `display:none`，回到 `#/overview` 恢复。
  - 默认渲染顺序：服务状态 → 快捷控制条 → 趋势图 → 结果占比 → 拓扑 → 排行 → 缓存 → 慢查询，与改动前的设计顺序一致。
  - 把「慢查询排行」上移到第一位后，`console-shortcuts` 等增强后新建的节点都拿到 inline order；等待一次 30 秒静默重渲染后顺序保持不变（修复前此处会跳回）。
  - 「恢复默认」同时复位显隐与顺序，按钮回到禁用态。
  - 全程无 pageerror。

## 已知限制

- 服务状态与指标卡在 shell 增强后同处一个 section，作为整体移动；在弹层里互换这两项不会改变页面布局（PR 中已说明，未在本轮改动）。
- 仅在 jsdom 与无头 Edge 中验证，未覆盖 Safari/Firefox 与真机触控。

回退：`tar -xzf /opt/localdns/ui-backup-overview-fix-20261102-102100.tar.gz -C /opt/localdns`。
