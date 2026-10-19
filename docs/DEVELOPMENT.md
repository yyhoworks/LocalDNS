# 开发说明

## 概览、外观与版本检查（2026.10.19.5）

`overview-insights.js` 提供中文处理结果、稳定分类色、缓存池名称与耗时等级；`version-check.js` 读取安装元数据并缓存 GitHub 最新正式版，正式渠道比较自身版本，本地渠道使用基准正式版。

`appearance-panel.js` 在保留既有控件和处理器的前提下组织三栏面板；`ui-refinements.css` 统一间距、触摸区域和组件布局。排行不再参与通用手机记录卡增强；桌面慢查询通过尺寸包含使缓存内容决定行高，列表独立滚动，透明表头随内容滚动。

新增 `test_overview_insights.cjs`、`verify_overview_insights.cjs` 和 `verify_appearance_layout.cjs`。核验范围见 [正式版验证记录](validation/ui-2026.10.19.5.md)。

## 名单编辑器修复（2026.10.18.19）

面板打开后保存字段快照，直到「应用到名单」前不改行模型。关闭时显式继续 / 放弃；路由、名单和标签切换与刷新通过 `LocalDNSRules.canLeave(next)` 统一保护未应用的字段。Ctrl+S 在面板内应用草稿，在名单页保存；服务端写入仍沿用备份与冲突核对流程。

隐藏面板设为 inert，打开时隔离背景并圈定焦点。批量粘贴使用原生 dialog，去重覆盖现有名单与同批内容；离开页面清理 body 上的浮层。中文输入期间 Enter 不触发提交。IP / CIDR / rewrite 新建条目直接使用 raw 格式。

运行 `node tools/verify_rules_editor.cjs` 检查取消 / 放弃、字段脏判断、停用前缀、快捷键、中文输入、原文规则、分组、批量粘贴、拖动撤销、加载失败、路由 / 刷新保护、1000 行搜索及双皮肤短屏焦点。所有写入均为夹具；与 `verify_rules_workbench.cjs` 的备份和保存验证配套使用。审查范围和限制见 [审查记录](validation/rules-editor-2026.10.18.19.md)。

## 清单工作台（2026.10.18.18）

`rules-view.js` 基于 clone-fan PR #3，等待 console 草稿初始化后挂载；保存回调限定名单标识，浮层与快捷键跟随页面生命周期。`rules-workbench.js` 接入已确认的双皮肤工具条；CSS 限定在 rules 路由。`rule-backups.js` 统一服务器备份、保存前核对和恢复为草稿，最终写入继续使用 DNS API。`rule_backups.go` 只保存快照与提供只读恢复，不允许指定任意文件路径。

运行 `node tools/verify_rules_workbench.cjs` 检查原文保留、备份失败阻止写入、跨名单延迟保存、恢复草稿、并发修改提示、IP/CIDR 往返、批量删除撤销、空闲 DOM 及双皮肤导航适配。所有写入均为夹具。Linux Go 测试覆盖服务重启、权限、保留数量与越界路径。

## 代理面板入口（2026.10.18.12 本地预览）

2026.10.18.17：`traffic-client.js` 独立读取服务器采样并自动恢复连接，不再依赖概览页刷新或 sessionStorage。后端 `traffic.go` 每 5 秒采集真实累计计数，小时分段持久化，API 按 1h / 6h / 1d / 3d / 7d 聚合。`singbox_group.go` 对整个启动输入集合做版本校验、隔离副本合并与原生检查；JSONC 分片的语法交由核心判断。`node tools/verify_server_traffic_fragments.cjs` 覆盖自动恢复、新浏览器历史、全部时间范围和分片集合版本。Linux 测试设置 `LOCALDNS_SINGBOX_TEST_BINARY` 可运行真实核心的隔离保存 / 重载 / 恢复验证。

2026.10.18.16 更新：`identity.js` 为两类标识提供服务器读取、保存与旧浏览器偏好迁移；不再把名称 / Logo 写入浏览器存储。服务 1.3.0 将共享设置独立保存在 `interfaceFile`，使用分项 SHA-256 防止同一项被并发覆盖。`verify_identity_directory.cjs` 另核验新浏览器无本地偏好仍可读取相同名称 / 图标、迁移旧偏好和服务器保存失败。

2026.10.18.15 更新：`identity.js` 统一校验显示名称与图片地址，并将上传图片转换为小尺寸 PNG。LocalDNS 标识使用 `localdns-identity-v1`；代理入口沿用 `localdns-proxy-panel-v1`，从旧结构保留 URL，显示名称与 Logo 独立配置。偏好仅保存在当前浏览器，不修改设备网络配置。

配置目录工作区使用 `localdns-proxy-config-workspace-v1` 记住目录模式和目录地址；文件正文仍仅保留在内存。独立配置服务 1.2.0 支持备用完整配置的校验、备份与保存，返回 `confirmation: saved-only`；仅启动配置执行重载。

运行 `node tools/verify_identity_directory.cjs` 核验名称 / 图片上传与刷新恢复、目录文件切换、未保存保护、单独保存与启动配置重载，以及双皮肤与两种导航的桌面 / 手机显示。配置写入使用隔离夹具，真实设备写入另行验证。

`proxy-panel.js` 与 `proxy-panel.css` 提供紧凑 Logo 外链、类型与地址设置浮层及系统管理入口。偏好键为 `localdns-proxy-panel-v1`，仅保存类型与 URL，不调用后端写入接口。保存成功后再更新链接和 Logo；损坏的偏好回退默认值。跨标签页变更通过 `storage` 事件同步。

`node tools/verify_proxy_panel.cjs` 使用现有只读代理和 Edge 验证设置交互、URL 校验、存储失败、焦点、新标签页、双皮肤与水平 / 垂直布局。可用 `LOCALDNS_PREVIEW_BACKEND` 指定测试后端，或用 `LOCALDNS_VERIFY_URL` 验证实际部署地址；截图和报告写入 `dist/proxy-panel-verification/`。

## 源码范围

本仓库提供当前 Web UI 的 HTML、CSS、JavaScript、Logo 和本地字体。
DNS 核心主要由折腾日记交流群的 R 大使用 Rust 编写；当前工作目录没有提供核心 Rust 源码，当前工作版本使用 FJGAC 预编译程序。

## 主要文件

| 文件 | 作用 |
|---|---|
| `_src/ui/index.html` | 页面入口；静态资源基址为 `/ui/` |
| `_src/ui/config.js` | UI 配置；默认通过同源地址访问 API |
| `_src/ui/assets/js/app.js` | API 调用、路由与页面业务交互 |
| `_src/ui/assets/js/console.js` | 布局、真实采样、草稿、语义与数字排版 |
| `_src/ui/assets/js/material.js` | 外观参数与静态背景光影 |
| `_src/ui/assets/js/navbar.js` | 顶部滚动联动 |
| `_src/ui/assets/js/navigation.js` | 垂直 / 水平导航与折叠偏好；布局换位不重建业务页面 |
| `_src/ui/assets/css/navigation.css` | 两种导航布局、外观面板布局选项与手机回退 |
| `_src/ui/assets/js/appearance.js` | 字体偏好提前恢复、组合选择与输入方式识别 |
| `_src/ui/assets/js/skin.js` | 人文羊皮纸（Claude）与流光毛玻璃双皮肤切换、纸张色调预设与每套皮肤独立偏好恢复 |
| `_src/ui/assets/js/font-uploads.js` | 浏览器本地字体上传、事务确认与分项字体选择 |
| `_src/ui/assets/js/topology-flow.js` | 可关闭的路径流光示意、交互暂停与切页清理 |
| `_src/ui/assets/css/interaction.css` | 状态文字居中、柔白细边与键盘焦点 |
| `_src/ui/assets/css/skin-claude.css` | 人文羊皮纸（Claude 风格）与流光毛玻璃双皮肤变量、宣纸噪点层与组件定制 |
| `_src/ui/assets/js/wallpaper.js` | 单张壁纸验证、保存、旧版当前壁纸兼容与失败反馈 |
| `_src/ui/assets/css/overview.css` | 服务摘要与指标分组 |
| `_src/ui/assets/css/typography.css` | 宋体标题与衬线数字 |
| `_src/ui/assets/css/fonts.css` | 本地字体声明 |

## 调试

UI 需要 LocalDNS 后端提供 `/api/`、`/plugins/`、`/metrics` 等现有接口。
将 `_src/ui/` 的内容作为后端 `/ui/` 的静态文件使用。独立静态服务仅能查看结构，完整功能需要连接实际后端。

不要在公开源码的 `config.js` 中写入设备凭据或个人服务器配置。

## 单张壁纸（UI 2026.10.18.11）

外观面板只提供本地图片、在线图片 URL、背景预设与恢复默认；图库管理和保存范围控件已移除。壁纸保存在当前站点、当前浏览器，不上传服务器。

单张记录使用 IndexedDB `localdns-appearance/settings/wallpaper`；小容量后备使用 localStorage `localdns-wallpaper-v4`。更换壁纸前先验证图片，保存成功后再显示，写入失败保留当前壁纸。

兼容已取消图库的当前选中图片或预设；首次读取时保存为单张记录，原图库数据不主动删除。之后优先读取单张记录，恢复默认不会再次恢复旧图库的图片。旧版 `localdns-wallpaper-v3` 与更早的单张设置继续兼容。共享图库和 .10 原型已取消，不参与打包。

运行 `node --test tools/test_wallpaper.cjs` 验证旧图库当前壁纸迁移、替换与恢复默认持久化，以及写入失败时的原图保护。测试依赖沿用忽略目录 `deployment/tools/wallpaper-test-deps/node_modules/fake-indexeddb`。

首次运行测试前安装依赖：`npm install --prefix deployment/tools/wallpaper-test-deps fake-indexeddb@6.2.4`。客户端管理测试为 `node --test tools/test_clients.cjs`。

## 打包

```sh
python tools/package_ui.py
```

脚本读取 `VERSION.json` 和 `_src/ui/`，生成 UI 升级包、逐文件校验清单和整包 SHA-256。
输出位于 `dist/`；设置 `VERSION.json.releaseTag` 时位于 `dist/<releaseTag>/`，避免覆盖旧构建。打包不会修改正在运行的服务器。

新 UI 版本需要先更新 `VERSION.json`，再更新发布说明和资源查询版本，验证后发布。

完整包使用已发布的完整 ZIP 作为默认配置与规则来源，并要求提供从 GitHub Release 核对过的 SHA-256；不从运行中的设备读取配置：

```sh
python tools/package_ui.py --full-base /path/to/published-full.zip --base-sha256 <verified-sha256>
```

两个包均包含作者表和第三方许可。默认情况下后端程序、默认配置与规则沿用已校验的基础包。仅更新内核时额外传入 `--kernel-archive /path/to/LocalDNS_FJG4Z.zip --kernel-sha256 <verified-sha256>`：只读取三种架构 ELF 程序，不导入上游包内 UI、配置与规则；默认配置、规则和服务文件仍与旧完整包逐字节一致。

后端单独升级不增加 UI 版号，以 `releaseTag` 选择独立发布说明和构建目录。完整包名包含后端版本，UI 升级包不包含内核。

PR #1 回归可运行 `node tools/test_countup.cjs` 及 `node tools/verify_ui_merge.cjs`。后者需要 Playwright、Edge 和 `LOCALDNS_PREVIEW_BACKEND`；设置 `LOCALDNS_EXPECT_BACKEND=FJG4Z` 时额外断言真实运行版本。只读代理阻止后端写入，报告与截图留在忽略的 `dist/`。详见 [整合记录](PR1-INTEGRATION.md) 与 [FJG4Z 验证记录](validation/fjg4z-2026.10.16.3.json)。

2026.10.18.1 的导航回归为 `node tools/verify_navigation.cjs`，同样使用 Playwright、Edge 和 `LOCALDNS_PREVIEW_BACKEND`，只读连接真实后端；报告位于 `dist/navigation-20261018/`。运行 `python tools/test_package_ui.py` 验证根目录 / 额外目录内核 ZIP、路径、重复条目与 ELF 架构约束。FJGA7 的公开核验摘要见 [本版验证记录](validation/fjga7-2026.10.18.1.json)。

## 已核验范围

- 桌面 1440px、手机 390px 的页面显示与横向溢出。
- 五个页面、深浅主题、真实指标读取和服务摘要。
- 浏览器确认标题与数字实际加载本地 Noto Serif SC 与 Instrument Serif。
- 规则草稿、键盘和抽屉操作来自本轮现有验证。
- 顶部收拢与反向滚动；减少动态效果偏好。
- 长数字显示、UI 包 CRC 与 SHA-256。
- 更新脚本通过 Alpine `sh -n` 语法检查；打包时未执行升级脚本。
- UI 2026.10.15.2 验证了 7 MB 壁纸刷新与重开浏览器后保留、在线地址回填、事务中止反馈、小容量回退和旧数据迁移；见 [验证记录](validation/wallpaper-2026.10.15.2.json)。

本仓库没有构建或逐架构运行所有 Rust 核心。FJG4Z 的运行验证针对现有 amd64-v3 环境；其他架构只核验 ELF 类型、哈希与包完整性。


UI 2026.10.16.1 / FJG4O 增加字体选择、状态文字居中和单层焦点；新后端经过独立端口兼容性检查后部署，DNS 查询及配置保留验证见 [本版验证记录](validation/ui-2026.10.16.1.json)。


## UI 2026.10.18.2

- `workspace.js` / `workspace.css` 提供已确认的信息组织、筛选偏好、订阅草稿、分组与拓扑锁定；API 写入继续由 `app.js` 的原有处理器执行。
- `query-path.js` 只组织请求自身字段，未知的阶段与应答元数据不补造。运行 `node tools/test_query_path.cjs` 核验缓存证据、0 ms、NXDOMAIN、缺失 RR 元数据及转义。
- 常用筛选按 API 地址区分保存在当前浏览器，订阅草稿按 API 地址和订阅标识保存在当前会话。

本版已完成部署后文件哈希核对、真实请求路径查看和定向检查，范围及数据边界见 [UI 2026.10.18.2 验证记录](validation/fjga7-2026.10.18.2.json)。

## UI 2026.10.18.3

修复首页排行缺少 `order` 而排在首位的问题。服务概览、快捷控制、趋势与分流占比、拓扑、排行、缓存与慢查询依次显示；同一顺序适用于两种皮肤。发布包和定向验证见 [本版验证记录](validation/fjga7-2026.10.18.3.json)。

## UI 2026.10.18.4

- `collection-layouts.js` 自动为六类已渲染的集合附加排列控件，使用独立于业务数据的浏览器偏好。`collection-layouts.css` 在用户显式选择排列时覆盖自动手机卡片样式。
- 表格集合切换时保留原表格与行节点、数据属性和处理器；在线规则的卡片 / 表格共享同一数据快照、筛选条件及原有业务操作。
- 偏好键为 `localdns-collection-layouts-v1:<API 地址或主机>`；存储失败时，本次页面内仍保留选择并显示保存失败提示。
- 验证范围见 [本版验证记录](validation/fjga7-2026.10.18.4.json)。

## UI 2026.10.18.5 / FJGAC

- `rank-latency.js` 使用后端日志筛选计算分类请求平均耗时；按需加载、最多 4 个并发请求、60 秒缓存，每项最多 1,000 条。无耗时样本不伪造为 0；缓存命中等真实 0 ms 保留。
- `node tools/test_rank_latency.cjs` 验证统计、筛选、缓存、并发、取消和重试；`python tools/test_package_ui.py` 验证新内核 ZIP 的额外版本目录与两种安装模板。
- FJGAC 在现有 amd64-v3 环境中以隔离副本测试读写接口，再备份升级；ARM64 与 amd64-v1 仅核验 ELF、哈希和包内容。

## UI 2026.10.18.6

解析拓扑节点与缓存卡统一读取 `--blur-filter`，`--topo-node` / `--topo-node-hover` 由 `--glass-alpha` 计算。羊皮纸皮肤的专属背景与 `backdrop-filter: none` 覆盖继续有效。壁纸存储方式未变：IndexedDB `localdns-appearance/settings/wallpaper`，小容量后备使用 localStorage。


### 2026.10.18.7 检查结论

- 吞吐量使用 `/metrics` 的 `localdns_queries_total` 增量计算，不使用可清理的审计记录总数。首个样本只建立基线；超过 90 秒的间隔不计算 QPS。区间均值按有效采样秒数加权，缺失时段不补零。
- SVG 的 viewBox 宽度随容器测量更新，避免固定纵横比让曲线挤在中央。窗口选择保持到本次页面会话结束；历史采样保存在 sessionStorage。
- FJGAC 的规则更新接口直接返回来源对象。PUT 同来源时可能不重新下载，因此编辑时需保留 detected_format、rule_count、last_updated；改变来源后由内核重新识别。
- 多数据集 DAT 的 PUT 可能先返回待识别配置；前端在缺少 detected_format 时再执行更新，处理 dataset_required 并引导选择。
- 拓扑仅外层画布使用全局 backdrop-filter；内部节点使用全局遮盖度对应的半透明底色，避免叠加模糊和固定渐变。羊皮纸皮肤保留原样。
- `node tools/test_traffic.cjs` 与 `node tools/test_rule_conversion.cjs` 覆盖计数重置、断采、窗口边界、真实接口返回结构、元数据保留及 DAT 待识别流程。

## 历史本机配置管理（2026.10.18.13，已移除）

`proxy-config.js` / `proxy-config.css` 挂载系统管理下的 `#/proxy-config` 路由，沿用现有导航和主题。编辑器依赖按需加载，构建见 `tools/proxy-config-ui/README.md`。

独立服务位于 `services/proxy-config/`，默认端口 9098，不修改 DNS 内核接口。服务配置中的 Origin、Host、核心程序、启动文件和目录需要与设备对应。浏览器凭设备 SSH 账号建立 HttpOnly 会话；正文和密码不进入浏览器持久存储。

保存只应用于核心启动配置；目录内其他文件可选择、读取与检查。保存前后验证内容版本，核心检查通过后备份并原子替换；失败恢复。Mihomo 有自定义透明代理规则时，需要配置 `postReload` 恢复钩子。sing-box 的 SIGHUP 与在线检查不等价于确定的应用确认，界面采用对应文案。

## 历史配置管理方式（2026.10.18.14，已移除）

配置编辑器直接调用同机服务读取文件，不使用 SSH 认证和 Cookie 会话。页面初始化先读取核心元数据，再载入已选文件或默认启动配置；读取失败提供重试与错误详情。服务保留 Origin / Host 和配置目录边界，部署于现有受信局域网管理范围。历史 .13 的登录方式已被替换，核心校验与事务保存流程保持一致。

## 历史配置服务发行包（已移除）

以下为旧版开发记录。自 UI 2026.10.19.7 起，配置服务、编辑器、构建依赖和独立 Service 包已移除；相关源码可从 `.5` 标签与 Git 历史查阅。

`python tools/package_proxy_config.py --go /path/to/go` 构建 Linux amd64 / arm64 服务并生成独立 ZIP，使用 `-trimpath -buildvcs=false` 保持构建与工作目录无关。先运行 UI 打包工具生成完整包 / UI 包，再运行此脚本，将第三个压缩包加入同一 `SHA256SUMS.txt`。

`python tools/test_proxy_config_installer.py` 在临时 DESTDIR 中验证两个架构的文件安装、已有配置 / 钩子保留、程序备份和非法 Origin 拒绝；不会启动系统服务。Windows 可通过 `--shell` 指定 Git 的 `usr/bin/sh.exe`。

`python tools/verify_proxy_config_release.py --base /path/to/published-full.zip --base-sha256 <published-sha256>` 统一验证三个压缩包的清单、UI 字节一致性以及完整包的默认配置、规则和内核保持；可加 `--write-record` 更新当前版本的公开验证摘要。

## 当前静态共享方式（2026.10.19.7）

`shared-ui.js` 读取 `ui/custom/settings.json`，字体按所选用途加载；名称、Logo 和代理面板地址由同一静态配置提供。网页修改只作本机预览，导出 ZIP 后通过 `tools/configure_ui.py` 导入服务器。操作与迁移见 [共享配置指南](SHARED_UI.md)。

`rule-save.js` 在名单写入前重读并核对内容，拒绝覆盖已检测到的其他修改。DNS API 不提供原子条件写入，不能保证两个设备同时保存的事务隔离。`traffic-client.js` 直接轮询 DNS `/metrics`，仅保存本次页面会话的采样，无长期历史服务。

运行 `python tools/test_shared_ui.py`、`python tools/test_oneclick_installer.py`、`node tools/test_traffic.cjs` 做定向回归；设置 `LOCALDNS_TEST_BACKEND` 后运行 `node tools/verify_shared_ui.cjs` 验证跨浏览器共享、按需字体加载和图标回退。名单测试为 `node tools/verify_rules_workbench.cjs` 与 `node tools/verify_rules_editor.cjs`，所有写入使用夹具。

当前打包只生成完整包、UI 升级包和 `SHA256SUMS.txt`；两包均包含 `configure-ui.py`。完整包的 FJGAC 三架构核心、默认 DNS 配置和规则沿用已校验的 `.5` 完整包。
