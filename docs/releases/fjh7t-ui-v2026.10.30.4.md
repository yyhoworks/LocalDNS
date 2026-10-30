# FJH7T / UI 2026.10.30.4

界面适配 FJH7T 内核：随包默认记录上限下调，主缓存默认拿到三分之二缓存内存；默认调度间隔从 7 天改成 1 天；「缓存参数」逐池显示内核实际给的内存预算与占比。

## 背景

FJH7T 是 FJH7Q 的维护版（`localdns-amd64-v3` 6,305,048 B → 6,342,008 B，+36,960 B）。把两个内核放在同一台机器上、用同一份配置并排跑起来逐项比对后，变化只有三处：

**1. 默认记录上限下调，缓存内存分配随之改变。** 内核的预算算法两版相同：`cache_memory_mb` 按各池 `max_entries` 的比例分给四个缓存池，同一份配置在两个内核上结果完全一致（128 MB 实测）：

| `max_entries`（main / domestic / foreign / foreign_ecs） | 预算占比 | FJH7Q | FJH7T |
|---|---|---|---|
| 50 万 / 50 万 / 10 万 / 10 万 | 41.67% / 41.67% / 8.33% / 8.33% | 55,924,053 B ×2 | 相同 |
| 40 万 / 10 万 / 5 万 / 5 万 | 66.67% / 16.67% / 8.33% / 8.33% | 89,478,485 B | 相同 |
| 100 万 / 5 万 / 5 万 / 5 万 | 86.96% / 4.35% ×3 | 116,711,067 B | 相同 |

变的是**默认值**：内置默认与随包 `config/settings/cache.json` 从 50 万 / 50 万 / 10 万 / 10 万改成 40 万 / 10 万 / 5 万 / 5 万，于是全新安装的主缓存从 41.7% 变成 66.7%。改上限并重启内核会重新分配，这一点两版一致。已安装环境升级内核时 `cache.json` 不被覆盖，因此保留原上限、也就保留原分配比例。

**2. 分流刷新定时任务默认间隔。** 全新配置下 `scheduler.interval_minutes` 从 10080（7 天）改为 1440（1 天），默认首次执行锚点从 `2025-10-14T20:30:00Z` 移到 `2025-10-30T20:30:00Z`，`next_run_time` 因此落在当天而不是一周后。

**3. 被拦截域名与 NODATA 应答带 SOA。** 同一份 `block_domains.txt`，查 `msmp.abchina.com.cn`：

- FJH7Q：`NOERROR`、0 答案、0 权威记录，37 字节。
- FJH7T：`NOERROR`、0 答案、1 条权威 SOA（`localhost` / `nobody.invalid`，serial 1、refresh 3600、retry 1200、expire 604800、minimum 60，TTL 60），115 字节。

rcode 不变，只是补上了 RFC 2308 意义上的否定应答，客户端缓存行为更规矩。NXDOMAIN 在两版里本来就带 SOA，没有变化。

**接口没有变化。** 47 条接口路径的状态码、JSON 字段集合、`cache/limits` 的取值区间与报错文案逐条一致，`/metrics` 的 27 个指标名一致（只有 `localdns_info` 的 version 标签不同）。所以本次没有新增任何接口映射，需要适配的是「界面怎么把内核给的内存分配讲清楚」。

## 适配

| 位置 | 改动 |
|---|---|
| `frontend/src/features/management/cache-settings.ts` | 解析 `cache_memory_mb` 与每池 `budget_bytes`；新增 `cacheBudget()`，把字节换算成 MB 与占比；每个缓存池名下列出「预算 85.3 MB · 67%」，并在表下补一条说明：预算按各池记录上限的比例分配，改上限后重启内核才重新分配 |
| `frontend/src/styles/features/management.css` | 新增 `.cache-limit-budget`，与 `.cache-limit-key` 同款等宽小字，桌面与移动端都不新增列 |
| `frontend/src/features/management/index.js` | 定时任务弹窗的兜底值 `10080` → `1440`，说明文字改为「1440 分钟 = 1 天，10080 分钟 = 7 天」 |
| `frontend/tests/cache-settings.test.ts` | 夹具换成 FJH7T 的真实默认值；新增预算解析、占比取整、无预算内核降级三项断言 |
| `VERSION.json` / `_src/ui/version.json` | 后端改为 FJH7T，标签 `fjh7t-ui-v2026.10.30.4` |
| `frontend/index.html` | 角标改为 FJH7T |
| `tools/install-ui.sh` / `tools/package_ui.py` / `tools/upgrade_localdns.py` | 同核心白名单加入 FJH7T，完整包可直接以 FJH7T 内核包为模板重建 |
| `tools/fjgli_config.py` | 修正迁移白名单：`querylog.json` 允许 FJH21 起就有的 `persist` 字段，否则任何开启过「记录存盘」的安装都会被完整包更新挡下 |

预算显示是「有则显示」：内核不报 `budget_bytes` 时（FJGOE 及更早），这一行和说明整段不渲染，界面回到原样。

## 效果

- 「系统管理 → 缓存管理 → 缓存参数」能直接看出内核给每个池多少内存：新装默认下主缓存 85.3 MB · 67%，国内 21.3 MB · 17%，国外与国外 ECS 各 10.7 MB · 8%。
- 原来「记录上限」和「内存预算」是两套数、界面上只看得到上限；现在两个数并排，且说明写清了二者的关系：上限越大预算越多，改上限要重启内核才重新分配。
- 定时任务弹窗不再用「10080 分钟等于 7 天」暗示默认值；新装环境的默认值现在是 1 天。

## 验证

- 两个内核并排跑在 Debian 12 主机上（HTTP 19099 / 19100，DNS 15353 / 15354），逐条比对 47 条接口：状态码全一致，JSON 键集合全一致，`cache/limits` 的边界与文案全一致。
- 用同一份 `cache.json` 跑两组内核各三轮（50 万 / 50 万 / 10 万 / 10 万、40 万 / 10 万 / 5 万 / 5 万、100 万 / 5 万 / 5 万 / 5 万），两版预算逐字节相同，确认算法未变、差异只来自默认值；改上限后重启，两版都按新比例重新分配。
- 全新配置各起一份，确认内置默认值差异：缓存上限 40 万 / 10 万 / 5 万 / 5 万、调度间隔 1440。
- DNS 应答逐字节比对：国内 / 国外 / NXDOMAIN / AAAA 一致，只有被拦截域名多出 SOA。
- `npm run check` 全部通过：21 个测试文件 173 项单测、lint、`tsc --noEmit`、构建一致性校验、字体子集检查；`tools` 的 Python 单测 8 项全过（含新增的 `persist` 迁移用例）。
- 生产机（Alpine 3.23 / 192.168.1.2）实机走完整包更新：`backup → prepare → preflight → apply` 全过，升级后 `version` 为 FJH7T、分流规则计数与升级前逐项一致（`custom_cn` 1250、`custom_non_cn` 33、`geosite_cn` 113024、`geosite_non_cn` 27470、`block` 42 等），上游 4 组、别名 41 条、各名单条数不变。

## 升级说明

- **UI 更新包**：只替换界面资源，不动内核、配置、规则与上游，无需重启 DNS；安装后刷新页面即可。安装脚本按 `ui/version.json` 的 `backendVersion` 做同核心校验，所以这个包要求内核已经是 **FJH7T**——还在 FJH7Q 上的环境请先用完整包升级内核，再装 UI 更新包（或直接用完整包，界面已在内）。
- **完整包**：含 FJH7T 内核与干净的默认配置，用于全新安装或整机替换。注意 FJH7T 上游包没有附带 `rules/online/adguard/` 下的 5 个 txt（`all.txt`、`awavenue-ads-rule-mosdns-v5.txt`、`ban.txt`、`httpdns.txt`、`pcdnfilter.txt`），FJH7Q 包里有，因此本版完整包同样不含这 5 个文件；全新安装后 AdGuard 订阅要在「规则 → 广告拦截」里更新一次才落地（默认 AdGuard 开关与这 5 个订阅都是关闭状态）。
- 已安装环境升级内核后，原有 `config/settings/cache.json` 与 `route_refresh.json` 不会被覆盖：记录上限沿用旧值，预算分配因此也沿用旧比例（生产机实测仍是 41.67% / 41.67% / 8.33% / 8.33%），调度间隔也仍是原来的 7 天。想要新默认值，在「缓存参数」改成 40 万 / 10 万 / 5 万 / 5 万、在「定时设置」改成 1440，再重启内核。
