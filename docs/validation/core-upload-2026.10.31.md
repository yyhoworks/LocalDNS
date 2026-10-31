# 原作者内核 ZIP 上传验证（2026-10-31）

## 范围与结果

内核更新入口改为选择原作者 ZIP 并上传，不再取 GitHub 最新发行版的内核版号作为可用条件。服务器选择自身架构的 ELF，只替换独立运行目录里的内核程序。UI、配置和规则保持原样；完整备份下载、本机文件校验、隔离预检、事务切换及整套恢复沿用统一升级服务。

UI 和整套升级仍使用 GitHub 正式发行包。已有 v2 升级服务须重新安装，具备 `coreUpload` 能力后才启用上传控件。安装器与发行打包清单已包含新增的 `core_upload.py`。

## 验证

- `python tools/test_core_upload.py`：5 项通过，包含包装目录和嵌套目录、架构选择、缺失架构、ELF 架构错误、歧义目录、不安全路径、符号链接和特殊文件、重复文件、CRC 损坏及体积限制。
- `python tools/test_online_updater.py`：13 项通过，包含上传摘要、截断传输、原文件保护、跨重启等待、备份门槛、配置与 UI 保留、同版号不同文件、重复文件、预检失败、完整恢复、Host/Origin 与 CORS、取消和安装器依赖。现有三种发行版升级路径也通过。
- `python tools/test_ui_updater.py`：28 项通过，兼容旧 UI 更新服务。
- `python tools/test_package_ui.py`：15 项通过。
- `npm run --prefix frontend check`：构建、类型检查、208 项测试、lint、干净重建对照和字体子集检查通过。本机使用 Node 26，运行检查时设置 `NODE_OPTIONS=--no-experimental-webstorage`，避免 Node 的实验性全局存储 API 覆盖 jsdom 存储；未修改产品代码或已有测试来绕过问题。
- `node tools/verify_core_upload.cjs`：桌面 1440、手机 390 像素，dark / light-glass 两套外观，共 12 组检查通过，无页面异常和横向溢出。覆盖 GitHub 不可用、文件验证、确认取消、上传原始文件与摘要、本机备份错误和正确文件、关闭重开、完成、旧服务能力提示，以及上传响应丢失后核对服务器任务。所有写请求由夹具响应，未访问真实设备。
- 已有原作者 FJHAI 实际二进制验证：amd64-v1、amd64-v3、arm64 的目录识别与 ELF 架构均通过。
- impeccable 机械检查：修改的版本界面和 CSS 返回空问题列表。

浏览器脚本需通过 `LOCALDNS_PLAYWRIGHT` 指定已有 Playwright 模块，或让 Node 能直接加载 `playwright`。截图和报告位于忽略的 `dist/core-upload-verification/`。

## PR #23 评估

[PR #23](https://github.com/yyhoworks/LocalDNS/pull/23)，审查提交 `90e540fe691bc4f308645900ca350da58039e69d`，仅在 `binary.stat()` 前添加 `binary.is_file()` 检查。缺少架构二进制时改报明确的 `MigrationError`，不会改变正常包的行为。

GitHub CI run 127 成功。取 PR 原始提交执行迁移模块 9 项测试全部通过；另构造缺少 `localdns-amd64-v1` 的有效清单包，确认抛出指定错误、原安装文件未变且暂存目录未创建。用户授权后已合并，合并提交 `a7ca417472a70a7a92d57412b3b42c7fa3e5905e`；该异常分支补入正式回归测试，迁移模块共 10 项。

## 交付边界

用户后续授权发布 UI 2026.10.31.5。已在现有 Alpine/OpenRC 服务器的独立目录、独立端口和独立服务执行真实内核 ZIP 上传、备份下载到本机、摘要校验、隔离预检、FJH7T → FJHAI 切换及整套回退，均通过；还验证上传摘要错误、未下载备份和重复内核文件的拦截。逐项核对独立实例 UI、配置指纹与生产环境内核摘要、配置指纹，均保持原样。本次生产部署仅更新 UI 与升级服务，不替换生产 FJHAI 内核。
