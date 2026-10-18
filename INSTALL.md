# 安装与更新

当前发行版本：**后端 FJGA7 / UI 2026.10.18.3**。本次恢复合并前的功能开关结构，支持可折叠垂直导航与居中水平导航，整合排行、日志路径摘要、规则分组与上游质量展示，保留双皮肤、五列 DNS 解析拓扑与贡献署名。

## 选择下载包

从 [本版 Releases](https://github.com/yyhoworks/LocalDNS/releases/tag/fjga7-ui-v2026.10.18.3) 下载；本地构建位于 `dist/fjga7-ui-v2026.10.18.3/`。配套包为：

| 文件 | 用途 |
|---|---|
| `LocalDNS_FJGA7_UI_2026.10.18.3_Full.zip` | 新安装或提取新内核：FJGA7 程序、上一正式版已清理的默认配置与规则、当前双皮肤 UI |
| `LocalDNS_UI_2026.10.18.3_Update.zip` | 已安装环境更新界面 |
| `SHA256SUMS.txt` | 两个发行包的 SHA-256 校验值 |

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

脚本先验证包内校验清单、备份原 UI，再替换界面。现有 DNS 配置、规则与后端程序保持原样，通常无需重启服务。

访问 `http://服务器地址:9099/ui/`；端口以实际配置为准。更新后刷新浏览器，必要时使用强制刷新。

## 已安装环境升级后端

**UI 升级包只更新界面，不包含后端程序。** 升级 FJGA7 时，从完整包的 `LocalDNS_FJGA7_Binaries/` 选择对应架构的 `localdns` 程序。先备份后端、配置、规则与 UI，在隔离目录及独立端口验证兼容性，停止服务后替换 `/opt/localdns/bin/localdns`，恢复可执行权限并启动服务，再检查 TCP / UDP DNS 查询、管理接口与 `/metrics` 中的 `FJGA7` 版本。切换内核需要短暂中断 DNS 服务。

保留已有 `config/`、`rules/`、`generated/`、`cache/` 和 `ui/`，不要用完整包目录覆盖已有安装。上游内核 ZIP 附带的旧 UI、客户端别名和配置不作为升级来源。验证失败时停止新服务，恢复备份的旧内核及必要的数据，再启动旧服务。

此次上游仅提供 amd64-v1、amd64-v3、arm64；未附带 ARMv7 新程序。

## 新安装

完整包中的 `localdns/` 放到 `/opt/localdns`。默认程序为 **amd64-v3**；其他二进制位于 `LocalDNS_FJGA7_Binaries/`，按设备架构选择。

| 文件 | 平台 |
|---|---|
| `localdns-amd64-v1` | x86-64 v1 |
| `localdns-amd64-v3` | x86-64 v3 |
| `localdns-arm64` | ARM64 |

将所选程序放置为 `/opt/localdns/bin/localdns`，然后运行：

```sh
chmod +x /opt/localdns/bin/localdns
/opt/localdns/bin/localdns --root /opt/localdns --config /opt/localdns/config/localdns.json
```

监听地址和端口由 `localdns/config/localdns.json` 决定。完整包沿用上一正式版基于 FJG4O 整理的默认配置与规则，已清理客户端别名、任务历史，并将私有上游地址改为本机示例；本次只引入 FJGA7 内核，需按实际环境调整配置。

`localdns.service` 是 systemd 服务示例。Alpine/OpenRC 使用对应的服务启动方式，并保留原有兼容库和环境变量。FJGA7 为上游预编译程序，本仓库不保证其在所有发行版或 CPU 上均可直接运行。

## 回退 UI

更新脚本会输出压缩备份和 `ui.previous-...` 目录的位置。

1. 将当前 `ui` 目录改名保存。
2. 将对应 `ui.previous-...` 目录改回 `ui`。
3. 刷新浏览器。

保留需要的浏览器外观参数。界面版号记录在包内 `ui/version.json`。

