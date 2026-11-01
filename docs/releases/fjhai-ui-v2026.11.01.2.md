# UI 2026.11.01.2 — 概览七格指标 + 代理流量卡，适配 FJMOS

发行标签 `fjhai-ui-v2026.11.01.2`。本版改前端资源并新增一个可选的采集器服务；DNS 内核、上游与规则不变，更新 UI 无需重启 DNS。

## 概览：七格指标

KPI 卡原先挂在 `.console-service-summary` 的 12 列栅格里，每张 `span 2`，六张正好一行。加入第七张时，`span 2 × 7 = 14` 放不进 12 列，构建产物里那套 12 层 `:not(#\#)` 提权规则又挡住了普通覆盖。

改法：把六张卡（现在是七张）从栅格直接子项改成独立的 `.console-kpi-row` 容器，行内自己排七列。行内卡片不再参与外层 12 列栅格，`priority.css` 里原来的 `.console-kpi{grid-column:span …}` 规则改为给这一行设置列数：

| 宽度 | 列数 |
|---|---|
| > 1400px | 7 列一行 |
| ≤ 1400px | 4 列 |
| ≤ 600px | 2 列 |

## 代理流量卡

内核不统计代理字节数，所以这张卡的数据来自 `ui/custom/traffic.json`。`custom/` 目录在 UI 升级时保留，采集器写文件、前端读文件，不需要新端口，也不需要跨域。

- **口径**：只算走代理的连接——`chains[0]` 不是 `DIRECT` / `REJECT` 才算，直连不计入。
- **显示**：大数字是今日上传 + 下载合计，副行拆开显示 `今日 ↓下载 ↑上传`；完整口径与采集时间在 `title` 里。
- **降级**：采集器没装或文件损坏时显示「—」和「未接入采集」，不显示 0，也不隐藏卡片——七格布局保持不变。

## FJMOS 适配：分流刷新变化报告

FJMOS 内核新增 `/api/v1/route-refresh/changes`，记录最近一次分流刷新的结论变化。系统管理 → 分流刷新多了「变化报告」按钮：

- 六类：直连 → 代理、代理 → 直连、其他变化、新学到、有分歧、没有变化，各带数量；
- 点分类看具体域名；「有分歧」额外列出原结论、第一次与第二次复核结果；
- 任务中途停止时，未复核的域名标为「未复核」；
- 旧内核没有这个端点时提示「当前内核没有变化报告（需要 FJMOS 及以上）」，不影响刷新任务本身。

## 新增：代理流量采集器

`services/proxy-traffic/traffic_collector.py`，Python 3 单文件、只用标准库：

- 轮询 Clash API `/connections`（默认 5 秒），从 mihomo 配置里读 `external-controller` 与 `secret`；
- 按连接 id 记录已计入的字节数，每次只累加增量；连接消失时尾部增量在上一次轮询已经计入；
- 按天汇总，保留最近 400 天，原子写入 `ui/custom/traffic.json`；
- `--once` 只采一次，便于验证。

安装（以 yopilot 为例）：

```sh
mkdir -p /opt/localdns-traffic /var/lib/localdns-traffic
cp traffic_collector.py /opt/localdns-traffic/
cp localdns-traffic.initd /etc/init.d/localdns-traffic
chmod 755 /opt/localdns-traffic/traffic_collector.py /etc/init.d/localdns-traffic
rc-update add localdns-traffic default
rc-service localdns-traffic start
```

停止与卸载：`rc-service localdns-traffic stop`、`rc-update del localdns-traffic`，再删除 `/opt/localdns-traffic` 与 `/var/lib/localdns-traffic`。

## 验证

- `npm run lint`、`npm run build`、`tsc --noEmit` 通过；
- `vitest` 200 项通过；`tests/rule-selection.test.ts` 的 8 项为改动前既有失败，在 clean tree 上可复现，与本版无关；
- 已部署到 192.168.8.2：概览七格一行显示，代理流量卡读到真实数据（今日 ↓4.30 ↑103 MB），`custom/settings.json` 保留；
- 采集器在服务器上以 OpenRC 服务常驻，`ui/custom/traffic.json` 每 5 秒刷新。

## 已知边界

- 采集器按轮询取增量：短于轮询间隔就关闭的连接可能漏计，默认 5 秒；
- 首次启动会把当前已打开连接的累计字节一次性计入当天，之后才是增量；
- 内核仍是 FJHAI 时「变化报告」不可用（端点 404），升级到 FJMOS 后自动生效。
