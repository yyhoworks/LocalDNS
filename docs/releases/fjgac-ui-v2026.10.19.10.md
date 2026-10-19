# FJGAC / UI 2026.10.19.10

- 移除升级口令，打开「版本与更新」即可直接升级 UI、查看任务和恢复上一版。
- 保留包校验、备份、失败恢复以及站点配置、Logo 和字体；无需重启 DNS。
- 安装器 1.3.0 重装更新执行端时自动移除旧口令配置。

## 已安装 .9 的用户

首次迁移需同步更新执行端：

```sh
sh localdns-install.sh --with-ui-updater --origin http://服务器IP:9099
```

也可解压本版发行包后运行 `python3 ui-updater/install_ui_updater.py --dir /opt/localdns --origin http://服务器IP:9099`。仅替换静态 UI 不会更新执行端。

提供完整包、UI 升级包及 SHA256SUMS.txt。DNS 核心仍为 FJGAC。
