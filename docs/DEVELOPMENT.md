# 开发说明

## 源码范围

本仓库提供当前 Web UI 的 HTML、CSS、JavaScript、Logo 和本地字体。
DNS 核心主要由折腾日记交流群的 R 大使用 Rust 编写；当前工作目录没有提供核心 Rust 源码，发行版使用 FJG4O 预编译程序。

## 主要文件

| 文件 | 作用 |
|---|---|
| `_src/ui/index.html` | 页面入口；静态资源基址为 `/ui/` |
| `_src/ui/config.js` | UI 配置；默认通过同源地址访问 API |
| `_src/ui/assets/js/app.js` | API 调用、路由与页面业务交互 |
| `_src/ui/assets/js/console.js` | 布局、真实采样、草稿、语义与数字排版 |
| `_src/ui/assets/js/material.js` | 外观参数与静态背景光影 |
| `_src/ui/assets/js/navbar.js` | 顶部滚动联动 |
| `_src/ui/assets/js/appearance.js` | 字体偏好提前恢复、组合选择与输入方式识别 |
| `_src/ui/assets/js/font-uploads.js` | 浏览器本地字体上传、事务确认与分项字体选择 |
| `_src/ui/assets/js/topology-flow.js` | 可关闭的路径流光示意、交互暂停与切页清理 |
| `_src/ui/assets/css/interaction.css` | 状态文字居中、柔白细边与键盘焦点 |
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
输出位于 `dist/`，不会修改正在运行的服务器。

新 UI 版本需要先更新 `VERSION.json`，再更新发布说明和资源查询版本，验证后发布。

完整包使用已发布的 FJG4O 完整 ZIP 作为输入，并要求提供从 GitHub Release 核对过的 SHA-256；不从运行中的设备读取配置：

```sh
python tools/package_ui.py --full-base /path/to/published-full.zip --base-sha256 <verified-sha256>
```

两个包均包含作者表和第三方许可。后端程序、默认配置与规则沿用已校验的基础包。

PR #1 回归可运行 `node tools/test_countup.cjs` 及 `node tools/verify_ui_merge.cjs`。后者需要 Playwright、Edge 和 `LOCALDNS_PREVIEW_BACKEND`；只读代理阻止后端写入，报告与截图留在忽略的 `dist/`。详见 [整合记录](PR1-INTEGRATION.md)。

## 已核验范围

- 桌面 1440px、手机 390px 的页面显示与横向溢出。
- 五个页面、深浅主题、真实指标读取和服务摘要。
- 浏览器确认标题与数字实际加载本地 Noto Serif SC 与 Instrument Serif。
- 规则草稿、键盘和抽屉操作来自本轮现有验证。
- 顶部收拢与反向滚动；减少动态效果偏好。
- 长数字显示、UI 包 CRC 与 SHA-256。
- 更新脚本通过 Alpine `sh -n` 语法检查；打包时未执行升级脚本。
- UI 2026.10.15.2 验证了 7 MB 壁纸刷新与重开浏览器后保留、在线地址回填、事务中止反馈、小容量回退和旧数据迁移；见 [验证记录](validation/wallpaper-2026.10.15.2.json)。

本仓库没有构建或重新验证所有架构的 Rust 核心。预编译程序沿用 FJG4O 发行文件。


UI 2026.10.16.1 / FJG4O 增加字体选择、状态文字居中和单层焦点；新后端经过独立端口兼容性检查后部署，DNS 查询及配置保留验证见 [本版验证记录](validation/ui-2026.10.16.1.json)。
