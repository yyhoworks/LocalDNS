# PR #48：代理流量刷新与升级校验

日期：2026-11-08。基于 main `3dfdc9c` 和贡献者 zxjack 的原始提交 `c7eb0b9`。

## 最终行为

采集器定期重写 `ui/custom/traffic.json` 和 `ui/custom/traffic-detail.json`。
等待下载备份期间，流量计数或服务器日期变化不会再被误判为用户修改设置。
完整升级、仅内核升级和上传内核共用此行为，等待中的任务重启升级服务后仍可继续。

归一化只用于原安装目录的设置指纹与 `sourceRuntime` 比对，且只匹配上述两个确切路径。
剔除时间、日期、统计起点、时区偏移及计数等运行字段；保留版本、来源、采样间隔、别名、保留策略和未知字段。
同名的嵌套文件仍按原始内容比对。无效 JSON、非对象数据或读取失败会停止校验，不会替换成空值放行。

`fjgli_config.hashes()` 恢复为现有正式版的逐字节 SHA-256 算法。
暂存目录、预检、已保存快照和回滚均继续使用它；修改统计文件中的总数也会触发完整性检查。
旧版升级器保存的 `previous.hashes` 无需迁移，既有快照、备份归档和用户统计数据均不重写。
已有等待中的升级任务仍需按原安装器要求完成或取消，才能重装升级服务。

## 兼容范围与回退

- 不改变支持的 DNS 内核版本、`localdns-v1` 接口、配置格式或服务协议。
- 保留普通 UI 更新路径、备份下载确认、归档 SHA-256、停服前核对和切换失败恢复流程。
- 设置、手工规则、其他 UI 文件与内核文件的变化仍会阻止升级。
- 回滚继续核验已保存快照的原始文件哈希；快照内流量文件被改动也会停止恢复。
- 未修改 VERSION.json，未制作发行包，未安装或重启真实设备的服务。
- 运行中的旧升级器需经正常发布和安装流程更新后，才会使用此修复。

## 隔离回归

测试使用临时目录、夹具发行包、真实采集器的 `sample()` / `publications()` 输出，
并替代服务管理、内核预检和健康检查；不代表 Linux 真实设备切换认证。

新增的三个主要流程测试在原 PR 实现上先失败：

1. 保留原始字节哈希的旧快照被误判为改变，回滚失败。
2. 准备完成后修改暂存流量总数，升级错误地成功。
3. 在 23:59:40 准备、次日 00:00:20 刷新流量后，升级被误判为设置变化。

修正后，上述测试均通过；另覆盖三种内核升级入口、任务重启恢复、历史快照改动、
真实 UI / 内核改动、未知字段、精确路径匹配以及无效流量 JSON。

Windows / Python 3.13 本地结果：

| 命令 | 结果 |
| --- | --- |
| `python tools/test_fjgli_upgrade.py` | 23 项通过 |
| `python tools/test_online_updater.py` | 29 项通过 |
| `python tools/test_core_upload.py` | 5 项通过 |
| `python tools/test_oneclick_installer.py` | 21 项通过 |
| `python tools/test_package_ui.py` | 15 项通过，使用测试自建夹具，无需发行产物 |
| `python tools/test_shared_ui.py` | 6 项通过 |
| `python tools/test_ui_updater.py` | 49 项中 44 项通过，5 项按既有条件跳过 Unix shell / 文件锁检查；含在线升级测试 |
| `python tools/test_companion_services.py` | 26 项中 24 项通过；2 项 Unix 权限断言在 Windows 失败 |

上述两个权限断言已在未修改的 main 上单独复现相同失败。
没有降低断言、增加跳过或修改无关测试。完整 Linux CI 结果见本 PR Checks。
本次未修改前端或 Go 配置服务，本地未重复运行前端检查和 Go 测试。
未运行依赖真实发行产物的 `tools/test_proxy_config_installer.py`。

## 旧代码退役清单

| 旧入口 / 符号 | 替代位置 | 删除内容 | 兼容保留与退役条件 | 验证 |
| --- | --- | --- | --- | --- |
| `fjgli_config.is_runtime_traffic` / `stable_bytes` | `upgrade_localdns._source_bytes` | 通用模块中的流量识别、静默空值回退 | 无兼容别名；这些符号尚未正式发布 | 搜索确认旧符号与导入均不存在 |
| `hashes()` 内流量归一化分支 | `source_runtime_fingerprint()` | 通用哈希中的特殊处理 | 保留正式版原始哈希语义，供既有快照长期兼容 | 旧快照恢复及快照 / 暂存改动测试 |
| `online_updater` 两处现网原始哈希比对 | `upgrade.source_runtime_fingerprint()` | 两处内联构造 `sourceRuntime` | 状态字段名保留；现有安装器禁止带等待任务重装 | 刷新、跨午夜和任务重启测试 |
