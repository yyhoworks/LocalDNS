# LocalDNS

<img src="_src/ui/assets/img/logo-08-dark.png" alt="LocalDNS Logo" width="88">

一个由 **Rust DNS 核心**与 **玻璃质感 Web 控制台**组成的本地 DNS 项目。集中查看解析状态、排查查询、管理上游与分流规则，让日常 DNS 管理更直观。

**DNS 核心主要由折腾日记交流群里的 R 大使用 Rust 编写；[yyhoworks](https://github.com/yyhoworks) 负责 UI 设计。**

当前版本：**后端 FJG4Z / UI 2026.10.16.3**。

最新下载：**[FJG4Z / UI 2026.10.16.3 正式版](https://github.com/yyhoworks/LocalDNS/releases/tag/fjg4z-ui-v2026.10.16.3)**。本次更新内核，保留现有 UI 布局；旧 FJG4O Release 保留可回退。

[产品图集](docs/SCREENSHOTS.md) · [功能指南](docs/FEATURES.md) · [安装说明](INSTALL.md) · [下载 Releases](https://github.com/yyhoworks/LocalDNS/releases) · [作者与分工](AUTHORS.md) · [开发说明](docs/DEVELOPMENT.md) · [近期更新](CHANGELOG.md)

## 作者与分工

| 作者 | 负责内容 |
|---|---|
| **R 大（折腾日记交流群）** | **DNS 核心，主要使用 Rust 编写** |
| **[yyhoworks](https://github.com/yyhoworks)** | **UI 设计** |
| **[clone-fan](https://github.com/clone-fan)** | **社区 UI 贡献：玻璃视觉、动效、字体上传与交互增强（[PR #1](https://github.com/yyhoworks/LocalDNS/pull/1)）** |

感谢 @clone-fan 的 [PR #1](https://github.com/yyhoworks/LocalDNS/pull/1)。正式版保留贡献者的原始提交历史，完整署名见 [AUTHORS.md](AUTHORS.md)。

## 界面预览

![LocalDNS 概览：服务状态、系统信息与 DNS 指标](docs/images/overview-desktop.jpg)

**集中查看 DNS 运行情况。** 服务状态与六项关键指标、查询吞吐趋势、分流占比、解析路径、请求排行和多级缓存状态集中展示。解析路径节点可点击查看详情，连线用于说明解析关系。

界面采用可调整透明度与模糊度的玻璃材质，搭配随滚动收拢的浮动顶部导航、Noto Serif SC 宋体风格标题与 Instrument Serif 衬线数字。字体随项目本地提供，可在「外观 → 字体与阅读」切换经典宋体、清晰黑体、等宽数字，或分别选择标题、数字与正文。

> 以下截图来自 UI 2026.10.16.2，保留作历史界面参考。当前 2026.10.16.3 的 DNS 解析路径采用 UI 2026.10.16.1 的五列布局，叠加可关闭的流光示意，不含 .2 的公式栏和预设工具条。域名、客户端、订阅地址等使用脱敏或示例数据；图中数值不代表性能测试结果。

### 深浅主题与外观定制

![浅色玻璃主题](docs/images/overview-light.jpg)

深浅主题一键切换，Logo 随主题适配。五组预设光影、本地壁纸和在线图片地址可自由选择；模糊度、面板遮盖度与背景暗化独立调整。

<details>
<summary>查看外观设置面板</summary>

![外观面板：壁纸、玻璃模糊度、透明度和暗化设置](docs/images/appearance.jpg)

选择本地图片后自动保存；在线地址点击「应用」保存。面板显示保存结果，刷新后恢复当前浏览器的外观偏好。

</details>

### 字体与阅读

![字体组合与独立字体选择](docs/images/font-settings.jpg)

经典宋体、清晰黑体、等宽数字三组组合一键切换，也可以分别选择标题、指标数字和界面文字。支持上传合法取得的 TTF / OTF / WOFF / WOFF2 字体并分别分配用途；文件和偏好只保存在当前浏览器，不上传服务器。域名、IP 与日志继续使用等宽字体。

### 日志、上游与规则管理

![查询日志：多条件筛选与解析记录](docs/images/query-logs.jpg)

按域名、客户端、请求类型、分流结果和响应码筛选，点击「详情」查看完整查询与响应记录。

<details>
<summary>查看查询详情、DNS 上游、规则订阅与系统管理</summary>

**查询详情** · 抽屉显示查询时间、客户端、响应码、耗时、Trace ID 与响应内容。

![DNS 查询详情抽屉](docs/images/query-detail.jpg)

**DNS 管理** · 查看各组上游的协议、地址、平均响应、请求数、并发采纳数、错误数与成功率。

![DNS 上游节点与健康统计](docs/images/dns-upstreams.jpg)

**名单管理** · 编辑本地名单、下载列表，并在切换名单时保留未保存草稿。

![本地规则与名单编辑器](docs/images/rules-lists.jpg)

**广告拦截** · 管理 AdGuard 规则订阅、更新间隔与自动更新状态。

![AdGuard 广告拦截订阅](docs/images/rules-adguard.jpg)

**在线分流** · 管理国内、国外、GeoIP 与 Geosite 来源，查看识别格式与规则数量。

![在线分流 SRS 规则管理](docs/images/rules-diversion.jpg)

**系统管理** · 集中管理缓存、功能开关、域名统计与分流刷新任务。

![缓存、功能开关与分流刷新任务](docs/images/system-management.jpg)

</details>

### 手机也能管理

窄屏使用底部导航，查询日志和上游表格转换为便于阅读的记录卡片，名单编辑提供类别选择器。

<details>
<summary>查看手机概览与查询日志</summary>

<img src="docs/images/overview-mobile.jpg" alt="LocalDNS 手机运行概览" width="300"> <img src="docs/images/query-logs-mobile.jpg" alt="LocalDNS 手机查询日志与记录卡片" width="300">

</details>

全部 13 张截图及页面说明见 **[产品图集](docs/SCREENSHOTS.md)**。

## 可以做什么

| 模块 | 主要能力 |
|---|---|
| **运行概览** | 服务在线状态、启动时间、运行时长、进程 CPU 与内存；累计请求、缓存命中、客户端数、拦截请求、平均响应、域名统计；QPS 趋势、分流占比、解析路径与排行 |
| **查询日志** | 域名与 IP 搜索、精确匹配、多条件筛选、分页、响应详情；审计开关、日志容量、清空日志与客户端别名 |
| **DNS 管理** | 国内、国外、国外 ECS、代理四组上游；UDP / TCP / TLS / HTTPS；新增、编辑、启停、删除；响应耗时、采纳数与错误详情 |
| **本地名单** | 白名单、黑名单、灰名单、强制 RealIP、DDNS、PCDN、客户端 IP、直连 IP 与重定向；列表下载与切换时保留草稿 |
| **广告拦截** | AdGuard 规则订阅；启停、编辑、单独更新、批量更新、自动更新与更新间隔；规则数与上次更新时间 |
| **在线分流** | 国内 / 国外自定义规则、GeoIP CN、Geosite CN / 非 CN；来源格式识别并转换为 SRS；同组来源合并去重 |
| **系统管理** | 四类缓存池的查看与清空；请求、类型、广告、IPv6、核心缓存、过期缓存及客户端分流开关；域名列表统计与 Requery 定时刷新 |
| **外观与交互** | 深浅主题、五组光影预设、本地 / 在线壁纸、玻璃参数、滚动浮动导航、顶部搜索、键盘操作与手机布局 |

详细操作、协议与规则格式说明见 **[功能指南](docs/FEATURES.md)**。后端相关能力需要配套的 FJG4Z 服务与对应插件。

两行侧栏状态文字分别居中；输入与导航使用柔白细边，键盘操作保留清楚的单层焦点提示。

壁纸、字体与外观保存在当前浏览器，不会同步到其他设备。较大的本地图片使用 IndexedDB 保存；面板会提示保存结果，在线图片地址在刷新后自动回填。

查询趋势使用当前浏览器会话的真实采样，提供 15 / 30 分钟视图；至少积累三次采样后绘图，最多保留 240 个采样点、最长两小时，不作为服务器历史报表。

## 快速安装

1. 在 [Releases](https://github.com/yyhoworks/LocalDNS/releases/tag/fjg4z-ui-v2026.10.16.3) 下载完整包或 UI 升级包，并核对同页的 `SHA256SUMS.txt`。**升级 FJG4Z 内核必须从完整包选择对应架构的程序；UI 升级包不含内核。**
2. 已有 LocalDNS 服务时，解压 UI 升级包并运行：

   ```sh
   sh install-ui.sh /opt/localdns
   ```

3. 打开 `http://服务器地址:9099/ui/` 并刷新页面。

升级脚本保留现有 DNS 配置、规则和后端程序，并备份原有 UI。新安装、平台二进制选择与回退步骤见 [INSTALL.md](INSTALL.md)。

## 仓库结构

```text
_src/ui/              当前 Web 界面源码、本地字体与 Logo
tools/                UI 打包工具与更新脚本
docs/                 开发、验证与第三方说明
AUTHORS.md            作者署名与分工
INSTALL.md            安装、更新与回退
VERSION.json          UI 与后端版号
```

安装 ZIP 和后端预编译程序放在 Releases。部署凭据、设备配置、运行日志、临时截图和历史工作文件不进入 Git。

**当前仓库包含 UI 源码；当前工作目录未提供 Rust DNS 核心源码，DNS 核心通过 FJG4Z 预编译发行包提供。**

## 开发与打包

需要 Python 3.10+：

```sh
python tools/package_ui.py
```

生成的 UI 升级包和 SHA-256 校验文件位于 `dist/`。本工具只构建 Web 界面，不编译 Rust 核心。详见 [开发说明](docs/DEVELOPMENT.md)。

## 来源与许可

项目作者与职责以 [AUTHORS.md](AUTHORS.md) 为准。仓库暂未指定覆盖全部项目代码的统一开源许可证。

字体、Chart.js 等第三方组件遵循各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

