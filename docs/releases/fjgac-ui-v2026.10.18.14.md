# UI 2026.10.18.14 / FJGAC

按用户要求，配置编辑器改为直接读取与 DNS UI 同机的配置文件。

- 移除 SSH 账号密码验证、连接设备、断开连接及会话流程。
- 打开页面即读取本机核心和配置文件，不需要再次输入设备凭据。
- 服务移除 SSH 库及对 sshd 的启动依赖，保留本机文件系统读写。
- 文件选择、YAML / JSON 编辑、核心校验、改动对比、版本冲突、备份、保存重载和失败恢复继续有效。
- 保留允许的 UI Origin / Host 与核心目录边界。沿用现有局域网管理方式，不另设身份验证。

本次设备上直接读取和原生校验 Mihomo 配置，不创建 Cookie 或 SSH 会话，未修改实际配置内容。十二项服务测试在目标 Linux 设备通过。未安装 sing-box 的状态保持如实显示。

验证记录见 [本版记录](../validation/fjgac-2026.10.18.14.json)。本版同时提供 GitHub 主分支源码、完整包、UI 升级包与独立配置服务包。

## 下载与安装

- `LocalDNS_FJGAC_UI_2026.10.18.14_Full.zip`：新安装或提取 FJGAC 内核。
- `LocalDNS_UI_2026.10.18.14_Update.zip`：已有 LocalDNS 更新界面。
- `LocalDNS_ProxyConfig_UI_2026.10.18.14_Service.zip`：配置编辑器服务，包含 Linux amd64 / arm64 程序。
- `SHA256SUMS.txt`：三个压缩包的 SHA-256 校验。

需要配置编辑器时，更新 UI 后再在同机解压 Service 包，执行 `sh install-proxy-config.sh http://服务器IP:9099`，并按实际核心路径调整 `/etc/localdns-proxy-config.json`。已有服务配置与重载钩子会保留。支持 OpenRC / systemd；amd64 经目标 Linux 验证，arm64 仅构建和 ELF 校验。服务沿用受信局域网管理方式，不另设登录。

完整包的内核、默认配置与规则来自已核对 GitHub 资产 SHA-256 的 .11 正式包，不从运行设备导入配置、订阅或凭据。
