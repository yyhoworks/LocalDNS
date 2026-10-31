# FJHAI / UI 2026.10.31.4

版本与更新扩展弹窗支持「UI」「内核」「UI + 内核」三种独立升级方式。只升级内核时保持当前完整 UI；只升级 UI 时无需重启 DNS。

内核及整套升级先生成完整备份，用户下载到电脑、选择本机文件验证 SHA-256 后才能继续。升级前在隔离目录和临时回环端口验证新内核，切换后检查 DNS 与原设置；验收失败自动恢复原目录。关闭弹窗后任务继续，重新打开可查看进度与结果。

升级执行服务移至 LocalDNS 目录外，避免替换内核目录后丢失升级能力。新增兼容性契约，未来同接口、同配置格式的新内核可继续使用现有升级入口。

首次启用内核升级，需要在解压包目录运行一次：

```sh
python3 ui-updater/install_ui_updater.py --unified --dir /opt/localdns --origin http://服务器IP:9099
```

既有旧服务仍可单独升级 UI，新界面会提示如何启用内核升级。完整步骤见 [网页升级说明](https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md)。本版内核仍为 FJHAI，二进制未变。

验证包括前端完整检查、三种更新事务与备份/恢复测试、真实 Alpine/OpenRC 下的 FJH7T → FJHAI 内核单独升级及整套升级/回退，以及桌面和手机、暖色和玻璃外观的交互验收。UI、完整 ZIP 和 SHA256SUMS.txt 随本正式版发布。
