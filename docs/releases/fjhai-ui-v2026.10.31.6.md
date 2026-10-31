# FJHAI / UI 2026.10.31.6

合入 [PR #24](https://github.com/yyhoworks/LocalDNS/pull/24)，修复在线升级的两处竞态与持久化问题。

- **确认期间防连点**：UI、上传内核、整套升级和恢复上一版本共用确认占位。等待确认时重复或交叉点击不会覆盖待确认操作；取消或 Esc 后可重新操作，确认后由提交状态接管。
- **完整任务状态一次落盘**：先合并任务元数据和调用方参数，再原子保存，避免两次保存之间中断时留下缺少目标标签或上传摘要的任务；回滚参数与上一版本快照继续保留。

本版继续使用 FJHAI 内核，提供 UI 更新 ZIP、完整 ZIP 和 SHA256SUMS.txt。UI 更新保留 DNS 配置、规则、站点配置、Logo 与字体，无需重启 DNS。

已有网页升级服务也需更新；仅安装 UI 不会替换独立的升级程序。在新包的解压目录运行：

```sh
python3 ui-updater/install_ui_updater.py --unified --dir /opt/localdns --origin http://服务器IP:9099
```

上传内核 ZIP、完整备份下载校验、隔离预检和恢复流程沿用上一版。详见 [网页升级说明](https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md)。

构建、208 项前端测试、33 项相关 Python 测试与生产验收通过，详见 [验证记录](https://github.com/yyhoworks/LocalDNS/blob/main/docs/validation/fjhai-2026.10.31.6.md)。
