# ADR 0002：统一 API、契约与页面数据边界

- 状态：接受，Phase 0–7 已实施（2026-10-19 更新）
- 基线：`8d4b9deed5cdbebde50701dbdc11faae45e35ead`

## 决策

- 唯一传输实现为 `core/api/http-client.ts`。DNS API 由 `api.js` 提供已有便利方法；版本、静态资源与采样使用同一 HttpClient 实现的实例，不形成第二套 fetch 封装。
- 统一处理 JSON / `+json` / 文本、HTTP 错误正文、网络故障、超时和 AbortSignal。超时持续到响应体读取结束。读取默认跟随当前路由；已经提交的写入允许完成，页面结果使用原作用域 guard，避免把客户端取消误报为服务器未保存。
- `contracts.ts` 校验日志集合/筛选/分页、统计、排行、客户端别名和上游配置等关键结构，接受未知扩展字段，格式错误在进入模板前报告。
- 日志查询由独立模型映射既有后端字段；Feature API 将已校验记录映射显示模型，保留原记录用于详情与导出。上游读取聚合配置、分组、ECS 和指标，写入 API 独立保留原参数名。
- 服务端数据由页面加载。上游配置由 mount 闭包拥有，别名快照随路由清理；全局上下文仅用于会话 UI 与配置。概览的 CPU 增量与浏览器趋势是专属采样模型，不放入共享服务器 store。
- 本地/session Storage、IndexedDB 经 Repository 访问。保持旧键和数据库 schema；迁移失败保留来源，事务 commit 后才报告成功，避免升级时损坏偏好。
- 纯文本使用 `textContent` 或转义；HTML 模板只通过统一的 DOMPurify 安全层。它按目标元素上下文解析 table/SVG/select，保留选中项语义。不新增外部运行时脚本或 CDN。

## 安全验证边界

`tools/preview_ui.cjs` 只允许指定的 GET 读取接口。所有非 GET 和有副作用的 GET（包括 flush）返回 403。规则、上游等写入回归只使用独立 fixture，不放开预览写权限。

名单保存沿用 DNS API 先重读、再比较、后写入的冲突语义。DNS API 没有原子条件写入，无法保证两台设备同时写入的事务隔离；不能把这一重构描述成修复了后端并发协议。

Prometheus 两个纯函数保留基线特征，不顺带修正规格。版本 GitHub 检查为已有可选功能，不是加载运行时代码的依赖。完整协议、测试入口与限制见 [架构](../refactor/frontend-architecture.md) 和 [最终验证](../refactor/frontend-phase-07-validation.md)。
