# FJOP0 / UI 2026.11.21.2

- 「分流」在支持的内核上显示模式选择。切到自定义后，可以把内置规则、在线订阅和本地规则文件排入匹配顺序。
- 上移、下移和启停即时保存。移除内置规则只调整自定义顺序，原名单仍可在原入口编辑。订阅可单条或批量更新，本地文件可在编辑时替换。
- 仅更新 UI 后，旧内核继续使用原有分流入口。

## 升级与回退

已有网页升级服务的用户，从本版升级包解压目录重新安装升级服务，沿用现有目录、Origin 和 HTTPS 参数。确认任务已结束后操作。

```sh
python3 ui-updater/install_ui_updater.py --unified \
  --dir /opt/localdns --origin http://example.test:9099
```

上传原作者 FJOP0 ZIP 或选择整套升级，下载并校验完整备份后再切换。切换会短暂重启 DNS，失败时由升级器执行回退。也可在「版本与更新」恢复上一整套版本。详见 [网页升级指南](../WEB_UPDATE.md)。

## 发行包

- `LocalDNS_FJOP0_UI_2026.11.21.2_Full.zip` 包含四种 Linux 架构的内核、公开默认配置和 UI。
- `LocalDNS_UI_2026.11.21.2_Update.zip` 用于单独更新 UI，内含可选网页升级服务安装器。
- `LocalDNS_ProxyConfig_UI_2026.11.21.2_Service.zip` 是代理配置服务。
- 下载后用 `SHA256SUMS.txt` 核对校验值。
