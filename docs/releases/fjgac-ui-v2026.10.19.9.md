# FJGAC / UI 2026.10.19.9

新增网页内 UI 在线升级，DNS 核心继续使用 FJGAC。

## 更新内容

- 顶部「版本与更新」提供升级口令授权、指定正式版升级、后台进度、失败重试、完成后手动刷新和恢复上一版。
- 借鉴 zashboard 的调用方式：网页发起请求，服务器执行下载与文件替换。当前使用可选的 Python 更新执行端，默认端口 9100；不依赖 Rust 核心新增接口。
- 校验发行包和包内文件，保留 `ui/config.js`、`ui/custom/`、名称、Logo 和字体。先备份再切换，管理接口在线时完成版本与接口检查，失败恢复旧 UI。
- 更新任务与浏览器连接独立，关闭网页后仍继续；记录事务以恢复中断的文件切换，并保留上一构建资源供旧页面加载模块。
- 安装器 1.2.0 增加 `--with-ui-updater`，支持 systemd / OpenRC、管理来源限制、短期授权会话与 HTTPS 同源代理。

## 下载与安装

| 文件 | 用途 |
|---|---|
| `LocalDNS_FJGAC_UI_2026.10.19.9_Full.zip` | 新安装，或提取已有 FJGAC 三架构核心 |
| `LocalDNS_UI_2026.10.19.9_Update.zip` | 已安装环境更新 UI |
| `SHA256SUMS.txt` | 两个发行包的 SHA-256 |

已有安装校验并解压 UI 升级包后执行：

```sh
sh install-ui.sh /opt/localdns
python3 ui-updater/install_ui_updater.py --dir /opt/localdns --origin http://服务器IP:9099
```

保存安装输出的升级口令，刷新网页并打开「版本与更新」。之后存在更高版本的同核心正式 UI 时，即可在网页发起升级。只有版本检查会自动运行，安装由用户点击发起。

也可重新执行 [一键安装器](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.9/docs/ONECLICK.md)，添加 `--with-ui-updater --origin http://服务器IP:9099`。默认安装仍只提供 DNS 与静态 UI。

更新执行端需要 Python 3.8+ 和写入安装目录的权限，默认作为 root 服务运行。HTTP 入口仅用于可信管理网络；HTTPS 网页使用同源 HTTPS 代理。安装、口令重置及回退边界见 [网页升级指南](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.9/docs/WEB_UPDATE.md)。

本版无需升级或重启 DNS 核心。请保留已有 DNS 配置、规则、缓存和数据，不要用完整包默认配置覆盖现有安装。

验证范围和已知边界见 [网页升级验证记录](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.9/docs/validation/web-ui-update.md)。
