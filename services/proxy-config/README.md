# LocalDNS 配置管理服务

独立 Go 服务，为现有 DNS UI 提供本机 Mihomo YAML / sing-box JSON 的读取、目录选择、核心校验与事务保存。DNS 核心无需重启。不依赖 ConfigFlow，不接收用户指定的程序或 shell 命令。

## 名单备份（1.5.0）

`POST rule-backups` 接收固定名单标识与原始文本，将快照写入 `ruleBackupDirectory`（默认 `/opt/localdns-proxy-config/data/rules-backups`）。不接受目标文件路径，不直接修改 DNS 名单。文件权限为 `0600`，写入后同步并检查内容 SHA-256；每名单最多 20 份，全部备份合计最多 64 MiB。

`GET rule-backups?tag=whitelist` 返回备份元数据；附加 `id` 读取校验后的备份原文。标识限定在服务内，拒绝路径穿越与越界符号链接。恢复只载入前端草稿；用户核对并保存时，仍由原 DNS API 写入。

界面保存前重新读取当前名单并核对已读取基准，先完成服务器备份，再次核对后调用 DNS API。其他客户端已修改、备份服务不可用或 DNS 保存失败时保留草稿。当前 DNS API 未提供原子比较写入，因此读写间仍有短暂并发窗口；不要将前端两次核对视为事务锁。

## 服务器采样（1.4.0）

服务每 5 秒读取 `metricsURL`（默认 `http://127.0.0.1:9099/metrics`），采样文件默认保存在 `/opt/localdns-proxy-config/data/traffic/`，可通过 `trafficDirectory` 更改。按小时追加写入，自动清理过期分段；API 仅提供滚动 7 天内的记录。

`GET traffic?minutes=60|360|1440|4320|10080` 返回当前范围的汇总点与最新速率。1 小时显示细采样，较长范围按分钟 / 5 分钟 / 10 分钟汇总，保留累计请求量、实际秒数和峰值。进程重启、计数下降和超过 90 秒的采样中断产生间隔；浏览器不会自行补齐历史。

## sing-box 分片目录（1.4.0）

运行进程使用 `-C` 时，服务从核验过的进程读取启动参数；没有 PID 文件时，仅在发现唯一匹配程序时自动识别。多个实例应指定 `pidFile`。路径仍须位于 `roots` 内。

尚未运行核心时，可显式配置：

```json
{
  "binary": "/usr/local/bin/sing-box",
  "config": "",
  "directory": "/etc/sing-box",
  "configDirectories": ["/etc/sing-box/conf.d"],
  "configFiles": [],
  "roots": ["/etc/sing-box"],
  "pidFile": "/run/sing-box.pid"
}
```

`config` / `configFiles` 对应显式 `-c`，`configDirectories` 对应 `-C`，支持最多 128 份、总计 8 MB 的输入。检查与保存使用整个启动集合的哈希，发现新增、删除或修改分片时拒绝覆盖。隔离副本保留原路径排序，由核心原生合并与校验；另检查常见未解析的出口引用。保存当前分片后发送 SIGHUP，检查合并配置中的本机 Clash API。重载失败时恢复原分片并尝试重新加载原集合；核心恢复未确认会明确返回错误和备份路径。

## 服务器保存名称与 Logo（1.3.0）

UI 通过 `interface/localdns` 与 `interface/proxy` 接口读写共享显示设置。默认存储在 `/opt/localdns-proxy-config/data/interface.json`，可通过 `interfaceFile` 更改。旧服务配置没有该字段时自动采用默认路径，安装与 UI 升级不会覆盖此数据。

上传 Logo 在前端转换为最长边 256 像素的 PNG，图片内容与名称以 JSON 保存；在线图片保存 HTTP(S) 地址。服务校验名称、URL 和 PNG 尺寸，设置文件权限为 `0600`，原子替换并保留上一份 `.bak`。每项设置有独立版本校验，拒绝其他设备覆盖已变更的同一项设置。

其他设备刷新页面后读取服务器设置。服务不可用时明确显示读取 / 保存失败，不退回浏览器本地保存。已有本地偏好只在服务器对应项目未设置时迁移，迁移成功后移除旧偏好。

## 部署

可在 Release 下载 `LocalDNS_ProxyConfig_UI_<版本>_Service.zip`，解压后在 DNS UI 与核心所在设备安装：

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

本服务需要对指定核心配置和进程的管理权限。配置仅允许管理员通过服务配置指定的目录；目录中的符号链接不能绕过边界。默认文件限制 2 MB，列表最多返回 200 项并提示截断。Mihomo 目录列出 YAML / JSON，sing-box 目录列出 JSON。每份文件作为独立完整配置读取、校验并保存；仅 `config` 指定的启动配置执行保存后重载，备用配置返回 `confirmation: saved-only`，不切换启动文件。服务版本为 1.4.0。

## 本机直接访问

页面打开后自动读取当前设备上的配置文件，不经过 SSH、不要求填写账号密码，也不创建登录会话。服务使用本机文件系统 API 读写配置，校验与重载同样在本机执行。

接口仅允许配置中的 UI Origin 和 Host，并将文件操作限制在指定核心目录。Origin / Host 限制用于阻止浏览器跨站请求与非预期主机访问，不是用户身份认证。本版沿用 DNS UI 的受信局域网管理方式，不另设登录；应按管理员原有的网络访问范围部署。

当前示例使用 HTTP 供本机或受信局域网部署。需要加密传输时，在同一 HTTPS 入口反向代理服务和 UI，更新 Origin / Host 以及 `proxyConfigBase`。

## 保存过程

1. 校验已读取内容的 SHA-256，拒绝过期版本；同一时刻仅运行一个检查 / 保存操作。
2. 在配置同目录写入 `0600` 临时文件，执行当前设备的 `mihomo -t -d … -f …` 或 `sing-box check -D … -c …`，保留原文和注释。
3. 保存启动配置时校验重载通道；复核版本，写入 `localdns-backups/` 中的 `0600` 备份，每个文件保留最新十份。
4. 保留配置所有者和权限，同目录原子替换，并 fsync 文件与目录。
5. 备用配置到此完成保存；启动配置继续重载。Mihomo 通过认证的本机 `/configs?force=true` API 重载，执行管理员配置的 `postReload`，再检查本机控制接口。带自定义透明代理回程规则的设备应配置相应幂等钩子。
6. sing-box 核验 PID 所属程序后发送 SIGHUP，通过已配置的本机 Clash API 检查在线状态。界面明确显示“已发送重载且核心在线”，不将该检查表述为配置已应用的确定确认。未配置确认通道时拒绝保存。
7. 重载或钩子失败时，恢复原文件并重新加载原配置；编辑器保留修改。恢复未确认会明确返回错误和备份路径。

核心诊断限制为 32 KB，并隐藏含密钥或 URL 的诊断行。服务运行日志只记录核心、文件与备份路径，不输出配置正文。浏览器也不持久保存正文。

## 验证

`go test ./...` 用临时目录和替代重载器验证无需会话的本机读取、跨站请求、路径边界、冲突、无写入校验、备份权限、原子替换和重载失败恢复。Linux 交叉构建测试可用 `go test -c`，将测试程序放到目标设备运行。真实设备验证应对现有配置执行语义不变的注释修改，再通过同一接口恢复原字节，并核对 DNS、进程与透明代理规则。

YAML 和 Go 运行时使用的许可见 `go.mod`、`go.sum` 及安装包中的 licenses。前端编辑器依赖、锁定版本和构建说明见 `tools/proxy-config-ui/`。
