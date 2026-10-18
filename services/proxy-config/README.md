# LocalDNS 配置管理服务

独立 Go 服务，为现有 DNS UI 提供本机 Mihomo YAML / sing-box JSON 的读取、目录选择、核心校验与事务保存。DNS 核心无需重启。不依赖 ConfigFlow，不接收用户指定的程序或 shell 命令。

## 部署

可在 Release 下载 `LocalDNS_ProxyConfig_UI_2026.10.18.14_Service.zip`，解压后在 DNS UI 与核心所在设备安装：

```sh
sh install-proxy-config.sh http://服务器IP:9099
```

将示例替换为实际 IPv4 地址或主机名与端口，不包含路径。安装包自动选择 Linux amd64 / arm64 程序，支持 OpenRC / systemd，备份并保留已有配置文件和重载钩子。新安装会根据参数生成监听地址、Origin 与 Host。若启动失败，备份路径位于 `/opt/localdns-proxy-config/backups/`；可恢复旧程序及配置后重启本服务。安装不会停止 DNS 核心。

默认核心路径见 `config.example.json`。程序安装在 `/usr/bin/`、配置路径不同或有自定义透明代理回程规则时，调整 `/etc/localdns-proxy-config.json` 中的 `binary`、`config`、`roots` 与 `postReload` 后重启本服务。通过 HTTPS 访问 UI 时，需按下节说明配置同源反向代理。

从源码手动部署：

1. 使用 Go 1.27 构建：`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags '-s -w' -o localdns-proxy-config .`。
2. 安装程序到 `/opt/localdns-proxy-config/bin/localdns-proxy-config`，安装 OpenRC 脚本到 `/etc/init.d/localdns-proxy-config`。
3. 复制 `config.example.json` 为 `/etc/localdns-proxy-config.json`，权限 `0600`。修改监听地址、允许的 UI Origin / Host、核心实际程序和配置路径。
4. 执行 `rc-service localdns-proxy-config start`、`rc-update add localdns-proxy-config default`。UI 默认连接当前主机的 9098 端口；反向代理时可通过 `LOCALDNS_UI_CONFIG.proxyConfigBase` 指定地址。

systemd 使用随附 `localdns-proxy-config.service`，安装到 `/etc/systemd/system/` 后执行 `systemctl daemon-reload` 和 `systemctl enable --now localdns-proxy-config`。

本服务需要对指定核心配置和进程的管理权限。配置仅允许管理员通过服务配置指定的目录；目录中的符号链接不能绕过边界。默认文件限制 2 MB，列表最多返回 200 项。保存并重载只允许 `config` 指定的启动配置；其他文件可以读取和校验，避免重启后恢复到另一份配置。

## 本机直接访问

页面打开后自动读取当前设备上的配置文件，不经过 SSH、不要求填写账号密码，也不创建登录会话。服务使用本机文件系统 API 读写配置，校验与重载同样在本机执行。

接口仅允许配置中的 UI Origin 和 Host，并将文件操作限制在指定核心目录。Origin / Host 限制用于阻止浏览器跨站请求与非预期主机访问，不是用户身份认证。本版沿用 DNS UI 的受信局域网管理方式，不另设登录；应按管理员原有的网络访问范围部署。

当前示例使用 HTTP 供本机或受信局域网部署。需要加密传输时，在同一 HTTPS 入口反向代理服务和 UI，更新 Origin / Host 以及 `proxyConfigBase`。

## 保存过程

1. 校验已读取内容的 SHA-256，拒绝过期版本；同一时刻仅运行一个检查 / 保存操作。
2. 在配置同目录写入 `0600` 临时文件，执行当前设备的 `mihomo -t -d … -f …` 或 `sing-box check -D … -c …`，保留原文和注释。
3. 校验重载通道，复核版本，写入 `localdns-backups/` 中的 `0600` 备份，保留最新十份。
4. 保留配置所有者和权限，同目录原子替换，并 fsync 文件与目录。
5. Mihomo 通过认证的本机 `/configs?force=true` API 重载，执行管理员配置的 `postReload`，再检查本机控制接口。带自定义透明代理回程规则的设备应配置相应幂等钩子。
6. sing-box 核验 PID 所属程序后发送 SIGHUP，通过已配置的本机 Clash API 检查在线状态。界面明确显示“已发送重载且核心在线”，不将该检查表述为配置已应用的确定确认。未配置确认通道时拒绝保存。
7. 重载或钩子失败时，恢复原文件并重新加载原配置；编辑器保留修改。恢复未确认会明确返回错误和备份路径。

核心诊断限制为 32 KB，并隐藏含密钥或 URL 的诊断行。服务运行日志只记录核心、文件与备份路径，不输出配置正文。浏览器也不持久保存正文。

## 验证

`go test ./...` 用临时目录和替代重载器验证无需会话的本机读取、跨站请求、路径边界、冲突、无写入校验、备份权限、原子替换和重载失败恢复。Linux 交叉构建测试可用 `go test -c`，将测试程序放到目标设备运行。真实设备验证应对现有配置执行语义不变的注释修改，再通过同一接口恢复原字节，并核对 DNS、进程与透明代理规则。

YAML 和 Go 运行时使用的许可见 `go.mod`、`go.sum` 及安装包中的 licenses。前端编辑器依赖、锁定版本和构建说明见 `tools/proxy-config-ui/`。
