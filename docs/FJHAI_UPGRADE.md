# FJHAI 完整升级与配置保留

本指南对应 FJHAI / UI 2026.10.31.3。原 VM 的后端升级使用完整安装包；UI 更新包只适用于已经运行 FJHAI 的设备。网页 UI 更新和一键安装器不会代替已有设备执行跨核心迁移。

## 更新前先下载备份

| 原 VM 路径 | 处理方式 |
|---|---|
| `/opt/localdns/config/upstreams/` | 必须完整下载备份；恢复时整目录替换新版默认上游 |
| `/opt/localdns/rules/manual/` | 必须完整下载备份；恢复时整目录替换新版手工名单 |
| `/opt/localdns/config/settings/client_aliases.json` | 修改过必须下载备份；无法判断时也备份 |
| `/opt/localdns/config/subscriptions/` | 广告、在线分流订阅修改过必须下载备份；无法判断时也备份 |

为同时保留监听端口、缓存参数、功能开关、日志设置、定时任务、名称、Logo 和字体，升级工具会额外备份整个旧目录和服务文件。归档放在安装目录外，下载到本机后核对 SHA-256，不能把待删除目录中的文件当成唯一备份。

“是否修改”与原先安装版本的默认配置比较，不能与 FJHAI 示例比较。工具统一备份和迁移上述四项，不依赖这项判断。

## 完整更新步骤

将完整安装包与 `SHA256SUMS.txt` 上传到原 VM 的安装目录外，校验 ZIP 后解压到例如 `/srv/localdns-release`。以下命令从该解压目录运行，要求 root、Python 3.8+，以及 systemd 或 OpenRC。

```sh
# 1. 生成外置完整备份；目标目录必须尚不存在。
python3 upgrade-localdns.py backup --dir /opt/localdns \
  --output /opt/localdns-backup-before-fjhai
```

将生成的 `localdns-original.tar.gz` 下载到本机。Windows 使用 `Get-FileHash -Algorithm SHA256 <本机备份路径>`；结果必须与 VM 输出一致。后续 `apply` 的摘要参数填写这份**本机下载文件**的计算结果。

```sh
# 2. 使用全新目录准备 FJHAI，并迁移原设置。
python3 upgrade-localdns.py prepare --dir /opt/localdns \
  --package /srv/localdns-packages/LocalDNS_FJHAI_UI_2026.10.31.3_Full.zip \
  --sha256 <SHA256SUMS.txt中完整包的摘要> --stage /opt/localdns-fjhai-stage

# 3. 在独立目录与回环端口启动测试副本，验证配置和 TCP/UDP DNS。
python3 upgrade-localdns.py preflight --dir /opt/localdns \
  --stage /opt/localdns-fjhai-stage

# 4. 校验本机下载的备份摘要，短暂停服并切换整个目录。
python3 upgrade-localdns.py apply --dir /opt/localdns \
  --stage /opt/localdns-fjhai-stage \
  --backup /opt/localdns-backup-before-fjhai/localdns-original.tar.gz \
  --downloaded-backup-sha256 <本机下载备份的SHA256>
```

`prepare` 默认在 x86-64 选择 amd64-v1，ARM64 选择 arm64；确认 CPU 支持后可指定 `--arch amd64-v2` 或 `--arch amd64-v3`。不要直接使用上游包内默认的 v3 程序替换所有设备。

工具先准备全新的运行目录，用原有 `config/upstreams/`、`rules/manual/` 和 `config/subscriptions/` 替换新版对应目录，恢复别名及其余设置。切换时把旧目录移到同级回退目录，使 `/opt/localdns` 内只含新版本和恢复的数据，避免新旧文件混杂。旧目录、备份归档不会自动删除。

已有订阅的在线来源文件一并保留，由新内核重建编译状态；旧缓存与编译结果不直接覆盖回去。启用订阅的来源文件缺失、备份后设置发生变化或隔离验证失败，都会阻止切换。失败自动恢复完整旧目录；断电或强制中断后先运行 `python3 upgrade-localdns.py recover --dir /opt/localdns`。

## 本版适配范围

- 上游错误分类、分流结果和查询筛选显示中文；筛选值、内部代码和原始日志保留。
- 广告和在线分流的写入请求最多等待 5 分钟，包括新增、保存和手动下载更新。
- 单条、分组和全部更新按钮显示“更新中…”，阻止重复与冲突操作；切换页签再回来仍能看到更新状态。
- 超时或传输中断提示“结果待确认”，不自动重试下载。
- “解析控制”增加“国外 IP 段”，使用 `/api/v1/lists/foreign_cidrs` 读写，按 IP/CIDR 原文编辑。
- FJHAI 新装缓存上限为 30 万 / 20 万 / 5 万 / 5 万；界面读取实际设置和内存预算。升级保留原值，不强制改成新装默认值。

已在 Alpine Linux x86-64 完成旧版到 FJHAI 的隔离预检与完整迁移，确认原设置保留、TCP/UDP DNS 正常及实际页面可用。每台设备仍须执行自己的 `preflight`；ARM64 和其他发行版未做实机验证，生产订阅的主动下载未纳入本次部署验收。
