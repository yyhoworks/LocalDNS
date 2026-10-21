# 代理配置器恢复：功能与 UI 审查

日期：2026-10-21。分支：`codex/restore-proxy-config-http`。构建：`2026.10.21.1`，配置服务 `1.6.0`。

## 结论

配置文件/目录编辑、HTTP 导入、差异确认、保存目标选择、原生校验调用、备份与失败恢复均已实现。Mihomo 使用配置重载；sing-box 明确区分 SIGHUP 后在线检查与完整应用确认。

已部署到现用服务器 `192.168.1.7`：配置服务监听 `192.168.1.7:9098`，界面为 `http://192.168.1.7:9099/ui/`。真实 Mihomo 保存、重载、规则命中和原文恢复均通过；DNS TCP/UDP 53 均通过。现机未安装 sing-box，因此 sing-box 使用官方 `v1.14.3` 临时程序在隔离目录完成原生分片、SIGHUP 和回退测试，没有安装或替换生产核心。

## 验证证据

| 范围 | 结果 | 边界 |
|---|---|---|
| 前端检查 | 97 项 Vitest 通过；类型检查、ESLint、构建完整性通过 | 浏览器测试另列 |
| Go 新增测试 | HTTP 原文保留、JSONC、无写入导入、错误源、来源限制、冲突、备份、回退、Mihomo PUT 重载、控制接口变更拒绝、相对目录输入解析通过 | 在本机 Windows 执行，验证接口及文件事务，核心检查使用夹具 |
| Linux 源码与发行程序 | amd64 全部测试程序交叉编译；amd64/arm64 服务构建并核对 ELF/摘要 | 交叉编译不等于 Linux 运行测试；旧 Linux 权限、/proc、真实 sing-box 集成测试保留 |
| 浏览器功能 | 26 个场景，12 次隔离保存，0 个页面异常 | Microsoft Edge 155.0.4283.62；所有业务写入由隔离夹具接收 |
| 响应式与皮肤 | 14 组布局；1440、390、320 宽度，玻璃深色/羊皮纸浅色；无页面横向溢出 | 模拟视口；未声称实体手机、全部浏览器或完整 WCAG 认证 |
| 安装器 | 22 项暂存检查通过：新装、二次安装保留路径与钩子、旧程序备份、无效来源/端口拒绝、自定义端口验证 | DESTDIR 隔离暂存，不启动服务 |
| 目标服务器 | 9098 健康检查、28 个 UI 文件逐个与包摘要一致；Mihomo 原生校验、临时规则命中、重载后原文恢复、配置服务重启前后 IPv4/IPv6 有效规则稳定 | 服务器未安装 sing-box；浏览器检查使用 Edge 155 |

复现：

```sh
npm run --prefix frontend build
npm run --prefix frontend check
node tools/verify_proxy_config.cjs
# Linux 执行全部 Go 测试
cd services/proxy-config && go test ./...
# Linux 使用真实 sing-box 的临时配置集成测试
LOCALDNS_SINGBOX_TEST_BINARY=/实际路径/sing-box go test -run Native -v
```

浏览器记录和截图：`dist/proxy-config-verification/results.json` 及同目录 PNG；线上验收记录在 `deployment/proxy-config-deploy-20261021-110236/`。

## 审查中修正的问题

- 当前静态共享初始化仍删除旧配置器选择键，刷新后会回到 Mihomo；移除这段清理，验证服务失败后的重试保留原核心。
- CodeMirror 更新回调内再次 dispatch 会产生嵌套更新；将交互反馈移到微任务，并避免重复编辑状态变更。
- HTTP 订阅常省略控制接口，直接覆盖会失去管理通道；增加明确的「保留目标核心的控制地址和密钥」选项，默认开启，导入结果可对比。
- Mihomo 的普通配置重载不更新控制地址与密钥；预检查在写入前拒绝此类改变。
- sing-box 不使用返回空成功响应的 PUT /configs 冒充应用；执行核验 PID 的 SIGHUP，等待 API 恢复，并说明连接可能中断。
- sing-box 相对 -D 路径原本被丢弃；改为相对运行工作目录解析，并验证重复 -c / -C 输入。
- 小屏文件名被工具栏压窄、扩展名断行；将工具栏移到独立一行。调整差异按钮、弹窗关闭按钮等触摸尺寸。
- HTTP 服务不可用时保留草稿并提供重试/安装说明；错误信息就近显示并可被辅助技术播报。

## UI 技能检查

采用 Impeccable 的 Operate 与 audit 指引，保留现版字体、主题令牌、侧栏和五项移动导航。Web Design Engineer 浏览器检查覆盖主流程、错误、差异确认与未保存保护；UI/UX Pro Max 的错误反馈指引用于字段错误与恢复动作。

机械检测出现一条全局 HTML 的 `flat-type-hierarchy` 提示。结合该页实际截图和 `.pc-heading h1` 28px、正文 12–13px 的 CSS，判定它未读取外部样式产生误报；没有为此修改全站标题系统。

## 明确限制

- HTTP 配置链接是读取来源。保存写入已选择的服务器目标文件，不向普通订阅链接执行 PUT。
- 备用文件只保存，不改变运行核心；启动文件才执行保存并应用。
- sing-box 当前需要可访问的本机 Clash API 做在线确认。只配置新版 gRPC 管理服务、没有 Clash API 的实例会在写入前拒绝自动应用。
- sing-box 的在线检查不是配置完整应用的通用回执；目标机验收应再检查重载日志并新建连接验证规则命中。
- 本版没有新增独立 rule-set 编辑流程；sing-box 已引用的本地 rule-set 自动重载继续由核心自身负责。

## 本地安装包

- `LocalDNS_UI_2026.10.21.1_Update.zip`：`2b61cb819e3d18311ed9b99669ad987896915da0b46813d965230bc0ac23e92c`
- `LocalDNS_ProxyConfig_UI_2026.10.21.1_Service.zip`：`154ade5353b9dce2514da94eac6d3eccc90c6ee7e8cac118051bc820c192718a`

包内逐文件清单、ZIP CRC 和 UI 构建内容已核对。安装包位于 `dist/fjgac-ui-v2026.10.21.1/`，已部署到上述服务器并保留安装器生成的 UI 与服务备份。
