# 安装与更新

当前发行版本：**后端 FJH50 / UI 2026.10.29.7**（发行标签 `fjh50-ui-v2026.10.29.7`），见 [本次更新说明](docs/releases/fjh50-ui-v2026.10.29.7.md)。FJH50 内核提供 amd64-v1 / v2 / v3 / arm64 程序，本地区与 ANY / META / XFR 特殊查询改为本地应答；发行包附完整配置迁移工具，保留 DNS 趋势、静态共享设置、日志目录与 Mihomo / sing-box 配置编辑器。

## 名称、Logo 与字体共享

使用 `ui/custom/settings.json` 和静态资源保存共享名称、Logo、面板地址及字体。网页本机预览可导出配置包，由 `configure-ui.py` 导入服务器；其他设备刷新后读取。代理图标自动从面板地址加载，更新时保留 `ui/custom/` 和 `ui/config.js`。见 [共享配置指南](docs/SHARED_UI.md)。

## 一键安装 / 更新（推荐）

在运行 systemd 或 OpenRC 的 Linux 服务器上，以 root 执行：

```sh
curl -fsSL https://raw.githubusercontent.com/yyhoworks/LocalDNS/main/tools/install.sh -o localdns-install.sh && sh localdns-install.sh
```

首次运行安装最新正式版的 DNS 核心与 UI，设置开机启动并检查管理 API；已检测到安装时默认只更新 UI。默认安装在 `/opt/localdns`，DNS 使用 TCP / UDP 53，UI 使用 9099。

其他目录或端口可用 `sh localdns-install.sh --dir /opt/mydns --dns-port 1053 --http-port 19099`。在其他目录已有安装时，更新也必须提供对应 `--dir`。脚本不会自动升级已有 DNS 内核，原配置、名单与 `ui/config.js` 均保留。

完整参数、Alpine 兼容依赖、下载受限时的离线方式和回退步骤见 **[一键安装指南](docs/ONECLICK.md)**。下面保留手动安装流程。

## 选择下载包

### 可选：网页内升级 UI

包含此功能的发行包可一次性安装更新执行端，之后在顶部「版本与更新」中直接发起 UI 更新或恢复上一版。只更新 UI，保留配置与核心。安装方法及 HTTPS 接入见 [网页升级指南](docs/WEB_UPDATE.md)。

从 [本版 Releases](https://github.com/yyhoworks/LocalDNS/releases/tag/fjh50-ui-v2026.10.29.7) 下载；本地构建位于 `dist/fjh50-ui-v2026.10.29.7/`。

| 文件 | 用途 |
|---|---|
| `LocalDNS_FJH50_UI_2026.10.29.7_Full.zip` | 新安装或完整迁移：FJH50 程序（含 v1/v2/v3/arm64）、新配置结构、迁移工具与当前双皮肤 UI |
| `LocalDNS_UI_2026.10.29.7_Update.zip` | 已安装环境更新界面 |
| `SHA256SUMS.txt` | 发行包的 SHA-256 校验值 |

在同一目录核对：

```sh
sha256sum -c SHA256SUMS.txt
```

## 已安装环境更新 UI

将 UI 升级包解压到临时目录，进入解压目录运行：

```sh
sh install-ui.sh /opt/localdns
```

用能写入安装目录的用户执行。安装位置不同时修改最后一个参数。

脚本先验证包内校验清单、备份原 UI，再替换界面，保留 `ui/custom/` 与 `ui/config.js`。包内 `configure-ui.py` 可用于导入共享配置；完整包也将其放在 `localdns/bin/`。现有 DNS 配置、规则与后端程序保持原样，通常无需重启服务。

访问 `http://服务器地址:9099/ui/`；端口以实际配置为准。更新后刷新浏览器，必要时使用强制刷新。

## 从旧配置服务迁移

已有 9098 服务的设备，先按 [迁移说明](docs/SHARED_UI.md#旧版迁移) 导入名称、Logo 与面板地址，确认静态共享生效，再停止并取消旧服务开机启动。需要旧服务的配置或名单备份时先自行归档，随后可清理旧程序、启动项和数据。普通 UI 更新不会自动删除这些设备文件。

## 已安装环境升级后端

**跨版本升级后端核心时，请先备份原配置与规则。** 从完整包解压目录运行 `upgrade-localdns.py`，按 [更新指南](docs/FJGLI_UPGRADE.md#完整更新命令) 完成外置备份（包含 `config/upstreams`、`rules/manual`、`config/settings/client_aliases.json`、`config/subscriptions`）、本机下载校验、新目录准备、隔离验证和整体切换。工具会保留上游、手工规则、客户端别名、订阅和共享 UI 配置；失败恢复完整旧目录。

普通 UI 更新保留核心；跨核心发行包会在替换前停止并提示迁移。继续使用旧核心时，可用 `--version` 指定该核心对应的正式版 UI，例如 FJH21 用 `fjh21-ui-v2026.10.29.2`。网页升级仍只处理同核心 UI。

已验证的旧配置结构包括 FJGAC、FJGIR 和 FJGLI；其他旧安装遇到未知配置时停止并提示。迁移程序不保证支持尚未核实的任意历史版本。所有架构均提供二进制，实机运行验收目前针对 Alpine x86-64。

## 新安装

完整包中的 `localdns/` 放到 `/opt/localdns`。默认程序为 **amd64-v3**；其他二进制位于 `LocalDNS_FJH50_Binaries/`，按设备架构与指令集选择。内核支持自适应多核 CPU，日常使用推荐双核即可满足性能需求，四核测试 QPS 更高。

| 文件 | 平台与指令集要求 |
|---|---|
| `localdns-amd64-v1` | x86-64 v1（SSE、SSE2 等基础指令） |
| `localdns-amd64-v2` | x86-64 v2（SSE3、SSSE3、SSE4.1、SSE4.2、POPCNT 等，适合 J4125 等） |
| `localdns-amd64-v3` | x86-64 v3（AVX、AVX2、FMA、BMI1、BMI2 等） |
| `localdns-arm64` | ARM64（`aarch64`） |

将所选程序放置为 `/opt/localdns/bin/localdns`，然后运行：

```sh
chmod +x /opt/localdns/bin/localdns
/opt/localdns/bin/localdns --root /opt/localdns --config /opt/localdns/config/localdns.json
```

监听地址和端口由 `localdns/config/localdns.json` 决定。完整包使用已清理的默认结构：客户端别名、手工规则和运行数据为空，上游改为公共示例，默认定时任务关闭。订阅配置保留公开来源，核心重新下载或编译规则；安装后按实际网络调整。

`localdns.service` 是 systemd 服务示例。Alpine/OpenRC 使用对应启动方式，并保留兼容库和环境变量。上游提供 amd64-v1、amd64-v2、amd64-v3、arm64；包内默认 amd64-v3，不能用于不支持 v3 的 CPU。一键安装器在 x86-64 上默认选择 amd64-v1，可通过 `--arch amd64-v2` 或 `--arch amd64-v3` 显式指定。

## 自定义查询日志目录

打开「查询日志 → 审计控制」，填写 `logs`（位于安装目录内）或 `/var/log/localdns` 等服务器绝对路径并保存。界面显示实际位置及占用。目录必须能由 DNS 服务用户创建、写入；启动输出的日志位置仍由服务配置决定。

最新 2,000 条查询记录留在内存，其余压缩写入目录。**重启服务后查询记录清空，目录设置保留；切换目录也会清空当前查询记录，旧压缩文件留在原目录，不自动迁移。** 使用旧核心时显示升级提示。

## 回退 UI

更新脚本会输出压缩备份和 `ui.previous-...` 目录的位置。

1. 将当前 `ui` 目录改名保存。
2. 将对应 `ui.previous-...` 目录改回 `ui`。
3. 刷新浏览器。

保留需要的浏览器外观参数。界面版号记录在包内 `ui/version.json`。


### 清单工作台与吞吐趋势

名单直接通过 DNS 核心 API 保存，保存前重新读取并核对变化；失败时保留草稿。需要回退时先下载原名单。DNS 趋势提供 QPS、缓存命中率和上游平均延迟，默认 1 小时，可选 15 分钟 / 1 小时 / 6 小时 / 24 小时。历史保存在本浏览器，刷新可恢复；关闭网页和后台休眠期间留空，无需服务器采样服务。详见 [趋势说明](docs/DNS_TRENDS.md)。
