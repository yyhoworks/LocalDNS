# 一键安装指南

安装器：**1.3.0**（新增可选网页 UI 升级执行端；默认仍只安装 DNS 与静态 UI）。安装内容来自 GitHub 最新正式 Release；当前已发布版本为 **FJGAC / UI 2026.10.19.10**。安装器与 UI 独立编号，网页升级选项从 UI 2026.10.19.9 起提供，2026.10.19.10 起无需升级口令。

## 复制这一条命令

在服务器上以 root 运行：

```sh
curl -fsSL https://raw.githubusercontent.com/yyhoworks/LocalDNS/main/tools/install.sh -o localdns-install.sh && sh localdns-install.sh
```

普通账号可先下载，再执行 `sudo sh localdns-install.sh`。没有 curl 时可用：

```sh
wget -O localdns-install.sh https://raw.githubusercontent.com/yyhoworks/LocalDNS/main/tools/install.sh && sh localdns-install.sh
```

完成后打开 `http://服务器IP:9099/ui/`。安装器会输出实际访问地址。DNS 默认监听 TCP / UDP 53；客户端或路由器的 DNS 地址需要自行指向本机。

## 运行条件

- Linux x86-64 或 ARM64，运行中的 systemd 或 OpenRC；x86-64 默认选择 `amd64-v1`。
- root 权限，以及访问 GitHub API、raw 文件和 Release 下载的网络。
- Python 3.8 或更新版本。未安装 Python 时，入口脚本通过 apk / apt-get / dnf / yum 安装 Python 和 CA 证书；已有版本太旧时停止并提示。
- 建议在安装目录所在分区预留至少 **300 MiB**。系统依赖另计；Alpine 的编译依赖占用较多空间。下载、解压和备份前还会检查剩余空间。
- 新装 Alpine 会安装 `gcompat`、`libgcc`、`gcc`、`musl-dev`，在本机编译一个将 glibc `__res_init` 转接到 musl `res_init` 的小型兼容库，并配置服务加载。编译依赖会保留，已有安装的 UI 更新不执行此步骤。

不支持 Windows、macOS、ARMv7、OpenWrt 的 procd 或无 systemd / OpenRC 的容器。预编译核心能否运行还取决于系统 ABI；安装前会执行核心运行检查。

## 新装与更新分别会做什么

| 状态 | 默认行为 |
|---|---|
| `/opt/localdns` 不存在或为空 | 安装核心、UI 和默认规则；启用并启动 DNS 服务；检查管理 API |
| 已有完整 LocalDNS 安装 | 只更新 UI，保留核心、DNS 配置、规则、`ui/custom/` 及 `ui/config.js`，不重启 DNS |
| 目录非空但无法识别为 LocalDNS | 停止，保留原文件 |
| DNS / UI 端口被占用 | 新安装停止并提示，不自动关闭占用端口的服务 |

新装的国内上游使用 AliDNS / DNSPod，国外、国外 ECS 和代理组使用 Cloudflare / Quad9 的公共 UDP DNS。安装器不会安装 Mihomo 或 sing-box；原包的本机代理上游示例会被公共上游替换。代理组初始通过公网直连，需代理转发时请配置实际的本机代理 DNS。安装后请按自己的网络调整上游、ECS 及分流策略。

当前版本不安装 9098 配套服务。名称、Logo 和字体通过 [静态共享配置](SHARED_UI.md) 使用；名单直接保存到 DNS 核心，吞吐图记录当前浏览器会话。旧服务的设备文件需迁移并确认后单独清理，UI 更新不会自动删除。

重复执行安装命令**不会升级已有 DNS 核心**。需要升级核心时，按 [手动升级说明](../INSTALL.md#已安装环境升级后端) 操作。

## 常用参数

先下载入口脚本，再添加参数运行：

```sh
# 自定义安装目录、DNS 端口与界面端口
sh localdns-install.sh --dir /opt/mydns --dns-port 1053 --http-port 19099

# 指定安装完成后显示的 UI 访问地址
sh localdns-install.sh --origin http://192.168.1.20:9099

# 安装 / 更新指定正式发行版
sh localdns-install.sh --version fjgac-ui-v2026.10.19.10

# 强制要求更新已有 UI；找不到安装时停止
sh localdns-install.sh --mode ui --dir /opt/localdns

# 包含本功能的新发行版：同时启用网页 UI 升级，安装后即可直接升级
sh localdns-install.sh --with-ui-updater --origin http://192.168.1.20:9099
```

| 参数 | 默认值 / 说明 |
|---|---|
| `--dir` | `/opt/localdns`，必须是独立的 Linux 绝对路径，不含空格 |
| `--mode auto/install/ui` | `auto`；`install` 只接受不存在或为空的目标 |
| `--version` | GitHub 最新正式版；也可指定正式 Release 标签 |
| `--arch` | 自动选择 `amd64-v1` 或 `arm64`；可显式选 `amd64-v3`，需 CPU 支持 |
| `--dns-port` / `--http-port` | 新装为 `53` / `9099`；UI 更新沿用已有 API 端口 |
| `--origin` | 安装完成后显示的 UI 地址；默认使用探测到的本机 IPv4 和 UI 端口 |
| `--with-ui-updater` | 可选安装网页 UI 升级执行端，默认端口 9100；需要包含对应工具的新发行包 |
| `--ui-updater-url` | HTTPS 反向代理提供的升级入口；与 `--with-ui-updater` 配合使用 |
| `--package-dir` | 使用本地发行包和 `SHA256SUMS.txt`，不请求 GitHub Release API |
| `--stage-root` | 只在隔离根目录准备文件，不启动服务、不修改宿主启动项 |

`--with-service` 已移除。旧命令中的 `--without-service` 仍可兼容使用，无需再添加。

## 下载校验和失败处理

入口脚本固定安装引擎的 SHA-256。引擎验证 Release 附件摘要（若 GitHub 提供）、`SHA256SUMS.txt` 和 ZIP 内覆盖全部文件的 `MANIFEST.sha256`，拒绝不安全解压路径及符号链接。

UI 更新先备份，再在同一分区暂存和替换。如果更新前管理 API 正在运行，替换后会核对 UI 版号与 API；检查失败恢复旧 UI。服务原本离线时只完成文件更新，不声称服务已恢复。新装 DNS 启动失败时停止新服务、移除本次写入的启动文件，并将安装目录改名为 `localdns.failed-时间`，供排查。

系统包管理器已安装的依赖不会随安装失败自动卸载。

UI 备份保存在安装目录中的 `ui-backup-*.tar.gz` 和 `ui.previous-*`。回退时将当前 `ui` 改名保留，再将需要的 `ui.previous-*` 改回 `ui`，刷新浏览器。备份不自动清理，确认版本正常后可自行整理。

中断后如果提示遗留 `.localdns-installer.lock`，先确认没有其他安装任务，再删除报错指出的锁文件重试。

## 离线安装

从同一版本下载完整包、UI 升级包及 `SHA256SUMS.txt` 到 `/srv/localdns-packages`。再将仓库**同一提交**的 `tools/install.sh` 与 `tools/install_localdns.py` 放在同一个目录：

```sh
sh install.sh --package-dir /srv/localdns-packages
```

UI 更新只需 UI 升级包。离线主机需要预先安装 Python 及相应运行 / 编译依赖，否则系统包管理器仍需联网。

## 隔离准备与验证范围

以下命令只在 `/var/tmp/localdns-preview` 下准备安装目录及启动文件，不启动 DNS：

```sh
python3 tools/install_localdns.py --stage-root /var/tmp/localdns-preview --package-dir /srv/localdns-packages --origin http://192.0.2.20:9099
```

隔离准备跳过宿主端口和运行环境检查；准备的目录不能代替真实机器上的安装验证。

回归测试可运行 `python3 tools/test_oneclick_installer.py`。原生 Alpine x86-64 隔离验证检查 FJGAC 运行、TCP / UDP DNS 应答与 UI 文件读取；ARM64 检查安装文件与 ELF 架构，未在 ARM64 设备运行。systemd / OpenRC 启动文件及启停失败回退有自动测试。当前版本新增共享配置和字体保留检查，见 [本版记录](validation/web-update-2026.10.19.10.md)；最初安装器的验证范围见 [历史记录](validation/oneclick-installer-1.0.0.md)。
