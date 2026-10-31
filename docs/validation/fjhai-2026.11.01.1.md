# UI 2026.11.01.1 / 概览缓存开关验证

## 改动

概览「快捷控制」的「核心缓存 / 乐观过期」从同一组分段控件拆成两个独立开关，复用后台「启用」的 `.switch` 组件；绑定由按钮点击改为 `change` 事件，提交期间禁用、失败回滚。只改前端：`features/overview/index.js` 与 `styles/components/controls.css`。

## 本地检查

- `npm run --prefix frontend check`：构建、严格类型检查、24 个测试文件共 208 项测试、lint、干净重建文件对照与字体子集检查全部通过。
- Node 26 下测试沿用上一版设置：`NODE_OPTIONS=--no-experimental-webstorage`。
- 用真实构建产物经只读代理（`tools/preview_ui.cjs`，后端 192.168.8.2:9099）复核 glass 深 / 浅、claude 浅色与 390px 四种组合；双开、混合、双关、读取失败四种状态渲染正确，无横向溢出。
- 只读代理拦截写入时点击开关会回滚勾选状态并提示「操作失败」，确认失败分支可用，未向生产提交写请求。

## 生产验收

- 统一升级任务 `891d38b8e9fbd6e55cd2c9bf` 成功结束：UI `2026.10.31.6` → `2026.11.01.1`，内核仍为 `FJHAI`。
- DNS 进程 PID 5873 与启动 tick 不变；升级前后 `/api/v1/status` 正常，回环 UDP / TCP DNS 均有应答，上游分组 4 个。
- 36 个 UI 文件：新增 2、移除 1、变更 3。`/ui/version.json`、`assets/app-D0OSKPpj.js`（771,865 B）、`assets/index-DCmM8ALJ.css`（624,304 B）经实际 HTTP 读取与构建一致。
- 生产页面 1440 / 390、glass 深 / 浅与 claude 浅色逐项截图；glass 深色与本地构建产物截图 SHA-256 相同（`6c201b5b…`），四项开关状态均为「开」。
- 备份：`/opt/localdns/ui-backup-2026.11.01.1-20261101-001655-7bae9f2b.tar.gz`；上一版目录：`/opt/localdns/ui.previous-2026.11.01.1-20261101-001655-7bae9f2b`；升级任务 `canRollback: true`。
- 未执行开关切换，生产缓存状态与升级前一致。
