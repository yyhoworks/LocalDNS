# 开发说明

## 源码范围

本仓库提供当前 Web UI 的 HTML、CSS、JavaScript、Logo 和本地字体。
DNS 核心主要由折腾日记交流群的 R 大使用 Rust 编写；当前工作目录没有提供核心 Rust 源码，当前工作版本使用 FJGA7 预编译程序。

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
| `_src/ui/assets/js/wallpaper.js` | 壁纸验证、IndexedDB 保存、旧数据迁移与失败反馈 |
| `_src/ui/assets/css/overview.css` | 服务摘要与指标分组 |
| `_src/ui/assets/css/typography.css` | 宋体标题与衬线数字 |
| `_src/ui/assets/css/fonts.css` | 本地字体声明 |

## 调试

UI 需要 LocalDNS 后端提供 `/api/`、`/plugins/`、`/metrics` 等现有接口。
将 `_src/ui/` 的内容作为后端 `/ui/` 的静态文件使用。独立静态服务仅能查看结构，完整功能需要连接实际后端。

不要在公开源码的 `config.js` 中写入设备凭据或个人服务器配置。

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
