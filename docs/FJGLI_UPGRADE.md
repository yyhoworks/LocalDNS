# FJGLI 更新适配评估

日期：2026-10-22。适用于 FJGLI / UI 2026.10.22.3。已实现接口适配、配置迁移和完整更新工具；运行验收范围见发行说明和验证记录。

## 结论

本次应按“新目录部署 + 配置迁移 + 定制 UI 接口适配”处理。现有 FJGIR 的单独替换内核流程，以及直接保留旧默认配置的打包方式，不足以完成此次更新。

用户要求先下载备份原 VM 的上游和手工规则，再重新上传完整新版本并恢复设置。该要求应落实到更新流程中：没有完成本机备份下载和校验，不能进入旧目录替换步骤。

压缩包内的脚本、服务文件及说明仅作为分析材料。以下工具不执行上游包中的脚本。

## 完整更新命令

下载并解压 FJGLI **完整包**至安装目录外，例如 `/srv/localdns-release`，进入该目录。需要 root、Python 3.8+、systemd 或 OpenRC。更新工具保留原服务启动文件；原依赖的兼容库会复制到新目录。

```sh
# 1. 备份到安装目录外的全新目录。
python3 upgrade-localdns.py backup --dir /opt/localdns --output /opt/localdns-backup-20261022
```

将输出的 `localdns-original.tar.gz` 下载到本机，并在本机计算 SHA-256，与服务器输出一致后继续。**后续 apply 的摘要参数必须填写本机下载文件的计算结果。** Windows 可用 `Get-FileHash -Algorithm SHA256 <本机文件>`，Linux/macOS 可用 `sha256sum`。备份可能包含私有信息，应妥善保管。

```sh
# 2. 用 SHA256SUMS.txt 中完整包的值校验发行包，准备新的同盘目录。
python3 upgrade-localdns.py prepare --dir /opt/localdns \
  --package /srv/localdns-packages/LocalDNS_FJGLI_UI_2026.10.22.3_Full.zip \
  --sha256 <完整包SHA256> --stage /opt/localdns-fjgli-stage

# 3. 自动启动独立目录与回环端口的测试副本，完成后停止并删除副本。
python3 upgrade-localdns.py preflight --dir /opt/localdns --stage /opt/localdns-fjgli-stage

# 4. 短暂停服、切换整个目录并验收；失败自动恢复完整旧目录。
python3 upgrade-localdns.py apply --dir /opt/localdns --stage /opt/localdns-fjgli-stage \
  --backup /opt/localdns-backup-20261022/localdns-original.tar.gz \
  --downloaded-backup-sha256 <本机下载备份的SHA256>
```

`prepare` 默认在 x86-64 选择 amd64-v1、ARM64 选择 arm64；确认 CPU 支持时可显式 `--arch amd64-v3`。测试端口默认 HTTP 19098、DNS 2054，可用 `--http-test-port` 和 `--dns-test-port` 调整。已有同名暂存目录不会被删除或覆盖。

工具比对备份、准备时及停服前的设置；有变化则停止，需要重新备份、下载和准备。已启用订阅的本地来源文件缺失时也停止，先在旧版补全下载。旧版在线来源可复制到新目录供核心重新编译，旧编译状态和缓存不复制。新版启动后会继续按原订阅更新计划运行。

成功后原目录保留为同级 `localdns.previous-fjgli-*`，新运行目录只有新版本文件与迁移的设置。备份和旧目录不自动清理。若更新过程被断电或强制结束，重试前执行：

```sh
python3 upgrade-localdns.py recover --dir /opt/localdns
```

恢复工具读取外置事务记录，恢复完整旧目录和原运行服务。此恢复命令用于尚未完成的事务；成功后的版本回退需停服，保留当前目录，再恢复对应的完整旧目录。

## 核对依据

- 输入包：桌面的 `LocalDNS_FJGLI.zip`，14,521,206 字节，101 个条目。
- 输入包 SHA-256：`7780104dfc62075d79dd3c58a8225cd9202621c29794e3bdee9813568d9d4649`。这是本地计算的完整性记录，未与独立发布来源核验。
- 对比基线：本地已整理的 `dist/fjgir-ui-v2026.10.21.2/LocalDNS_FJGIR_UI_2026.10.21.2_Full.zip` 和当前前端源码；不是原 VM 的实时快照。
- 新版提供 `amd64-v1`、`amd64-v3`、`arm64`；包内 `localdns/bin/localdns` 是 `amd64-v3`。部署时必须按原 VM 的架构和 CPU 能力选择，不能默认使用包内程序。
- 新版附带 UI 已改用新接口；新二进制中未发现 `/plugins/`、`/api/v1/audit/`、`/api/v2/audit/` 字符串。旧接口能否兼容仍需运行核实，不能据此假定兼容。

## 一、备份与恢复范围

以下路径均相对于 `/opt/localdns`。

| 内容 | 更新前处理 | 新目录中的处理 |
|---|---|---|
| `config/upstreams/` | 必须完整下载备份并记录文件 SHA-256 | 用原目录替换新版对应目录，避免残留新版示例上游 |
| `rules/manual/` | 必须完整下载备份并记录文件 SHA-256 | 用原目录替换新版对应目录；目前两包的 11 个名单文件名相同 |
| 客户端别名 | 检查新旧两种文件名，下载实际生效数据 | 转为新版 `config/settings/client_aliases.json` |
| `config/subscriptions/` | 修改过必须下载；无法确认历史时一并备份 | 保留原订阅地址、名称、开关、更新频率等；重建匹配的在线和编译规则 |
| `config/localdns.json` | 下载备份 | 基于新版配置迁移原监听地址、端口、内存预算 |
| 原缓存、生成器、日志、功能开关、定时任务配置 | 下载整个 `config/` 作为迁移来源 | 按下一节转换，不直接覆盖整个旧 `config/` |
| `ui/config.js`、`ui/custom/` | 下载备份 | 使用已适配的定制 UI，恢复站点配置、名称、Logo、字体和面板设置；核对入口地址 |
| 整个安装目录、服务启动文件及环境配置 | 额外保留完整回退归档并下载 | 仅供回退；检查启动环境和兼容库是否需要在新目录重建 |

“有无修改”应与**原先安装版本**的默认值或既有基线比较，不能拿 FJGLI 的默认值推断。订阅中的下载时间、规则数量等运行字段变化也不能直接等同于用户修改。别名和订阅配置体积很小，历史不明确时全部备份最稳妥。

备份归档必须放在 `/opt/localdns` 外，例如 `/opt/localdns-backups/<时间>/`，本机另存私有备份目录。归档可能含订阅凭据或内部网络信息，不进入 Git 或发布包。

## 二、需要转换的配置

下表的旧路径来自本地 FJGIR 发行包。实际迁移前须读取原 VM，优先采用其实际生效配置。

| 旧版来源 | FJGLI 目标 | 转换要求 |
|---|---|---|
| `config/settings/client_names.json` | `config/settings/client_aliases.json` | 保留 IP 到别名的映射；若两文件同时存在，核对旧服务实际读取哪份，冲突不能静默覆盖 |
| `config/localdns.json` 的 `memory_limit_mb` | 同文件的 `cache_memory_mb` | 显式迁移原预算；若已存在新字段，以实际生效设置为准。新二进制中未发现旧字段名，不能沿用 FJGIR 的兼容性结论 |
| `config/cache.json` | `config/settings/cache.json` | 各缓存组 `size → max_entries`、`lazy_cache_ttl → stale_ttl`、`dump_interval → save_interval` |
| `config/generated.json` | `config/settings/generated.json` | 各生成器组 `dump_interval → save_interval`，保留 `max_entries` |
| `config/settings/audit.json` | `config/settings/querylog.json` | 迁移 `capacity`；自定义日志目录需通过新版查询日志设置接口验证并恢复 |
| `config/settings/requery.json` | `config/settings/route_refresh.json` | 保留域名来源、执行频率、日期范围、定时计划；转换动作配置，重置运行中状态 |
| `config/settings/switches.json` | 同路径 | 两包字段一致，保留布尔开关、`client_policy` 和 `prefer_family`，核对新版接受值 |

定时任务的 `url_actions.save_rules` / `flush_rules` 已变为 `actions.save` / `flush`，新版示例用 `cache_main`、`domain_stats`、`fakeip` 等动作标识代替旧 HTTP URL。已知本地动作可以映射；额外外部 URL、未知插件动作和旧 `url_call_delay_ms` 不应静默丢弃，需要列入迁移报告逐项核实支持方式。

上游和订阅的包内 JSON 结构总体相同，仍需在新内核中实际读取验证。恢复自定义订阅后，必须生成与它们匹配的 `rules/online/` 和 `rules/compiled/`；不能把新版包内的默认编译结果视为已经包含旧订阅。网络下载失败时，先解决规则可用性再切换。

旧 `cache/`、`generated/`、`rules/compiled/` 和历史查询日志保留在回退归档中。新运行目录使用新版数据结构重新生成，避免把旧运行数据整目录覆盖回来。保留设置不等于保证跨版本保留所有历史记录。

## 三、当前定制 UI 的接口适配

以下新版调用来自 FJGLI 附带 UI。路径、HTTP 方法、请求体和返回格式都需验证。

| 功能 | 当前 UI | FJGLI |
|---|---|---|
| 日志状态、容量、目录、启停及清空 | `/api/v1/audit/...` | `/api/v1/querylog/...` |
| 查询记录 | `/api/v2/audit/logs` | `/api/v1/querylog/entries` |
| 日志统计与排行 | `/api/v2/audit/stats`、`/api/v2/audit/rank/{type}` | `/api/v1/querylog/stats`、`/api/v1/querylog/rank/{type}` |
| 客户端别名 | `/plugins/client_name` | `/api/v1/client-aliases`，保存用 `PUT` |
| 手工名单 | `/plugins/{旧标签}/show`、`/post` | `/api/v1/lists/{新标签}`，保存用 `PUT {values}` |
| 功能开关 | `/plugins/switchN/show`、`/post`，值为 A/B | `GET /api/v1/features`、`PUT /api/v1/features`，提交具名字段 |
| 缓存读取与清空 | `/plugins/cache_*/show`、`/flush` | `GET /api/v1/caches/{id}`、`POST /api/v1/caches/{id}/flush`，id 去掉 `cache_` 前缀 |
| 缓存内存预算 | 当前管理界面无对应编辑入口 | `GET/POST /api/v1/cache/settings` |
| 广告订阅 | `/plugins/adguard/...` | `/api/v1/adguard/...` |
| 分流订阅 | `/plugins/{组}/config/{名称}`、`/update/{名称}` | `/api/v1/rule-groups/{组}/{名称}`、`/{名称}/update` |
| 刷新分流与定时计划 | `/plugins/requery/...` | `/api/v1/route-refresh/status`、`/start`、`/cancel`、`/reset`、`/counts`、`/schedule`；计划保存用 `PUT` |

手工名单标签也有变化，不能只替换 URL 前缀：

| 当前标签 | 新标签 |
|---|---|
| `whitelist` | `direct` |
| `blocklist` | `block` |
| `greylist` | `proxy` |
| `force_realip` | `proxy_realip` |
| `ddns_domains` | `ddns` |
| `pcdn_domains` | `pcdn` |
| `pcdn_regex_v4` | `pcdn_v4` |
| `pcdn_regex_v6` | `pcdn_v6` |
| `client_ip` | `clients` |
| `direct_ip` | `direct_cidrs` |
| `rewrite` | `rewrite` |

上表旧标签已与当前源码的 `ruleProfiles` 核对，新标签与 FJGLI 附带 UI 核对；映射后的读写行为仍需隔离运行验证。

建议在核心 API 层和各功能服务中集中处理接口差异，同时更新返回格式校验。重点包括：

- `frontend/src/core/api/api.js`、`contracts.ts`：日志、排行、别名接口和返回格式。
- `features/logs/`：别名保存、日志目录、容量、启停与清空。
- `features/rules/`：名单标签、广告和分流订阅的增删改、单条更新、批量更新及格式选择。
- `features/management/`、`features/overview/`：开关、缓存操作和刷新任务；新 `client_policy` 用一个枚举表达两种客户端策略，不再分两次提交旧开关。
- `/metrics`、`/api/v1/status` 和上游接口路径仍在新 UI 中使用；其字段、指标名和统计含义也需要运行验证。

继续支持 FJGIR 时，应根据明确的核心版本或能力探测选择接口。写入失败后不能自动换旧接口重复提交，避免同一操作被执行两次。

## 四、打包和安装器需要改动

1. `tools/package_ui.py` 当前 `--kernel-archive` 只导入三个内核，并强制保留旧完整包的配置和规则。FJGLI 需新增“新版运行目录模板”的构建路径，使用清理过的 FJGLI 配置结构；保留原打包方式供旧核心使用。
2. 清理新版示例中的私人客户端别名、本机代理端口示例、特定网络 ECS、预设手工规则及历史任务状态。新装使用明确的通用默认值；升级使用原 VM 的迁移结果。
3. `tools/install_localdns.py` 当前只有 `auto/install/ui`，已有安装默认只更新 UI。应另加明确的完整迁移入口，包含外置备份、暂存、配置转换、检查、目录切换和回退。
4. 网页 UI 更新执行端仍只负责同核心的 UI 更新；此次跨核心迁移需使用完整更新流程，并同步安装适配后的 UI 和版本元数据。
5. 原服务若依赖目录内的兼容库或 UI 更新执行端，需要在新目录重新准备并验证。Mihomo / sing-box 配置服务在独立目录时单独核对其依赖，不随 LocalDNS 目录替换而误删。

## 五、建议执行顺序

1. **读取原 VM。** 确认目标机器、核心版本、架构、服务管理方式、端口、实际配置路径和自定义 UI；记录上游、名单、别名、订阅及主要设置的快照。
2. **先下载备份。** 原安装目录和服务配置归档到安装目录外，下载至本机。强制备份上游和手工规则；别名与订阅有修改或无法确定时一并备份。远端归档与本地文件 SHA-256 必须一致。
3. **准备全新目录。** 选择正确架构内核，使用 FJGLI 新目录结构、迁移后的设置和已适配的定制 UI。恢复上游、手工规则、别名和订阅，重建订阅规则；旧缓存与编译状态不整目录回填。
4. **隔离验证。** 使用独立回环端口和独立根目录，禁用测试副本中的定时任务和自动更新；检查绝对路径，确保测试不会写回生产目录。验证 TCP/UDP DNS、所有管理读写操作及配置落盘。
5. **停服并备份最终状态。** 暂停相关更新任务，停止 LocalDNS，补充下载并校验最终配置快照；若与初始快照有变化，同步到新目录后再切换。
6. **替换目录。** 建议把原目录移到同级回退目录，再把全新目录放到 `/opt/localdns`，使运行目录只包含新版文件。若按要求逐项删除原目录内容，也必须在本地备份确认后执行，包含隐藏文件；不能把备份留在待清空目录内。
7. **恢复与验收。** 确认可执行权限及服务环境，启动新版；核对 FJGLI 版本、TCP/UDP DNS、管理 UI、上游和名单校验值、别名、订阅、端口、功能开关、日志目录及定时计划。
8. **失败回退。** 停止新服务，保留失败的新目录，恢复完整旧目录及原服务环境后启动旧服务。回退要恢复旧配置和运行数据，不能只把旧二进制放回新结构目录。

## 验证范围

- 已对 FJGAC / UI 2026.10.21.1 和 FJGIR / UI 2026.10.21.2 的发行配置完成本地迁移核对。
- 已在 Alpine x86-64 上完成 FJGIR 到 FJGLI 的实际迁移，验证原上游、11 类手工名单、别名、订阅、150 MB 内存预算、日志和定时计划。
- 已实测旧日志和插件接口返回 404，新接口读写、DNS TCP/UDP、在线规则重新编译和新装公开规则加载正常。
- 安装器和回退自动测试在 Alpine 上通过；ARM64、其他发行版和未经核实的历史配置仍需各自验证。

未知配置、冲突的两份别名以及无法转换的外部定时任务 URL 会阻止迁移，不能直接忽略。旧核心常规 UI 更新仍保留其内核；跨核心更新使用上面的完整流程。
