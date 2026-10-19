# LocalDNS 前端架构

日期：2026-10-19。对应实施计划 Phase 0–7；实际基线为 `8d4b9deed5cdbebde50701dbdc11faae45e35ead`，UI `2026.10.19.7` / DNS 核心 `FJGAC`。

## 目录与启动

```text
frontend/
  index.html                 HTML Shell 与应用入口
  src/entry/app.ts           显式初始化组合根
  src/core/
    api/                     唯一 HTTP 实现、错误、运行时契约
    lifecycle/               CleanupScope、LatestView、取消兼容
    router/                  路由解析、mount、canLeave 与资源清理
    persistence/             本地/会话偏好、IndexedDB 与共享默认配置
    security/                DOMPurify 安全模板边界
    events/                  类型化事件总线
    context.js               配置与会话 UI 上下文
  src/features/
    shell/                   导航、顶栏、搜索与连接状态
    overview/                指标、拓扑、采样、排行与详情
    logs/                    查询模型、API、显示模型、客户端管理
    upstreams/               独立读取/写入 API、健康与错误分类
    management/              缓存、开关、任务、统计与服务操作
    appearance/              皮肤、字体、壁纸与材质
    rules/                   名单、草稿、转换、冲突核对与工作台
    version/ identity/ proxy-panel/
  src/shared/                交互组件、格式、图表、指标与工作区组合
  src/styles/                tokens、base、components、features 与工具层
  tests/                     特征、基础设施与安全测试、API fixture
  scripts/                   构建完整性与临时重建验证
_src/ui/                     公共资源；不包含业务入口或手写业务 bundle
dist/ui/                     构建生成的完整静态目录；不提交
```

组合根通过 ESM imports 和明确初始化调用连接依赖，业务模块不通过 window 查找服务。HTML 最终加载运行时 `config.js`、本地 Chart.js 和一个哈希应用入口；CSS 由构建入口生成。`window.LOCALDNS_UI_CONFIG` 是保留的配置接口，`window.Chart` 是必要 vendor，不属于已删除的 `window.LocalDNS*` 服务层。

迁移后的业务模块保留 JS，新增基础设施与查询模型采用严格 TS。没有引入框架或重型状态库；当前 JS 未开启 `checkJs`，不声称全部业务已静态类型化。

## 路由与资源所有权

统一接口为 `RouteModule.mount(container, context)`，context 包含 signal、CleanupScope、navigate 和 notify。五个现有 hash 路由保留；外观是 Shell 面板，版本检查与代理入口也是 Shell/管理能力，不另造路由。

每次刷新/切换创建新的路由作用域：取消旧读取、销毁定时器与监听、关闭抽屉/弹窗/临时浮层、停止拓扑动画。图表实例由适配器统一持有并销毁，静默刷新单独暂存旧图表，以便读取失败时保留当前画面。已取消页面的响应不会覆盖新页面。

规则路由的 async `canLeave` 等待继续/放弃决定，保留原文、面板和批量粘贴草稿保护。内部名单/标签使用 `LatestView` 子作用域，切换后取消旧读取；过期结果不会写回当前标签。概览到规则标签的跳转等待 mount 完成，不再依赖固定延时。

全应用 Shell 的监听与集合布局 MutationObserver 有意持续到页面关闭；不把它们当作路由监听反复注册。规则工作台自己的 observer/快捷键随路由清理。

## API 和状态

```text
HttpClient → 兼容便利 API / Feature API → 契约与规范化 → 显示模型 → 安全 DOM
```

`HttpClient` 是唯一 fetch 传输实现，统一处理超时、取消、JSON/文本与错误正文。关键契约接受未知扩展字段，拒绝非法集合与已知字段类型。日志将查询参数映射到既有 API 字段，显示模型与原始详情/导出记录分离；上游 Feature API 读取配置/ECS/分组并聚合指标，写入独立保留原有后端字段。概览与管理复用纯指标模型，规则保留现有转换和保存边界。

| 状态类别 | 所有权 |
| --- | --- |
| 服务器快照 | 页面加载；上游 mount 闭包、规则视图、日志结果与别名快照；离开后释放 |
| 会话 UI | 当前 hash、筛选、页码、暂停刷新、规则标签、抽屉/面板；跨路由保留日志查询 |
| 用户偏好 | Preferences / AppearanceRepository；保持旧键、数据库及静态共享默认配置 |

概览 CPU 差分和浏览器趋势属于功能专属采样模型，不放入全局服务器 store。手机日志默认 25 条，桌面 50 条；不新增 URL 参数协议。保存的筛选与排列仍使用既有偏好键。

已提交写入不等同于可回滚的读取请求：路由离开不能保证服务器尚未保存。写入完成后由原页面作用域检查决定是否更新 UI。名单保存保留“重读→比对→DNS 写入”，后端无条件写入能力，因此仍有并发核对与实际写入之间的竞争窗口。

## 持久化与 DOM 安全

localStorage/sessionStorage/IndexedDB 通过 Repository 访问，数据库继续使用 `localdns-appearance/settings`。失败不报告为成功；迁移保留来源，避免长期双写。名称、Logo、字体共享继续读取静态 `custom/settings.json`，网页修改为本机预览，导出后由现有 Python 工具导入。

动态 HTML 只进入 `core/security/safe-dom.ts` 的 DOMPurify 边界，纯文本使用 textContent 或已有转义函数。安全层按目标上下文解析 tbody、SVG、select，并恢复 select 选中项。域名、日志、规则、错误与客户端名称均视为不可信输入。DOMPurify 许可证随包交付。

## 样式与发布

源样式使用 `reset,tokens,base,components,features,utilities,overrides` 层；主题、间距、控件高度、颜色、圆角、阴影、动画和 z-index 有明确 token。原补丁回收到所属文件；必要 important 的反向层优先级集中处理。构建时编译层级，保留原有布局和设计语言。由于未压缩且层级编译增加特异性，CSS 当前约 430 kB，未将体积压缩混入行为重构。

完整构建由 `build-meta.json` 记录输入和每个输出的 SHA-256；`verify:generated` 临时重建对照。打包读取该静态目录，保留 `/ui/`、`config.js`、安装路径与版本来源；完整包从已核验的公开基础 ZIP 派生，保护内核、默认配置、规则与服务。基础 CSP 及命令见 [开发说明](../DEVELOPMENT.md)。

## 与计划旧清单的差异

| 计划项目 | 当前基线及处理 |
| --- | --- |
| Phase 4G 代理配置编辑器、CodeMirror、Diff、9098、分片编辑 | 基线 `.7` 已移除，N/A；不恢复已删产品。代理面板外链、类型/URL、品牌入口已迁移 |
| Phase 4F 服务器备份/备份失败阻止保存/恢复草稿 | 基线无备份服务，N/A；保留当前 DNS 重读核对、保存失败留草稿和未保存保护 |
| 长期服务器采样 | 基线已移除，N/A；保留当前会话的 `/metrics` 采样，离开概览停止轮询 |
| 合并 `tools/proxy-config-ui` workspace | 该工程与依赖已在基线删除，N/A；新 frontend lockfile 为当前唯一构建依赖 |
| Phase 1 稳定 IIFE 文件及旧 script 顺序 | 已作为过渡阶段验证；Phase 6–7 按计划改为哈希 ESM 入口并删除兼容层 |

不修改 DNS 核心、服务端协议、版本号或真实设备状态。结果和可复验测试矩阵见 [最终验证](frontend-phase-07-validation.md)。
