# FJH7Q / UI 2026.10.30.3

界面正式适配 FJH7Q 内核：在线分流新增「GeoIP 非 CN」分组，按国家/地区管理非 CN IP 段。

## 背景

FJH7Q 内核新增了 `geoip_non_cn` 规则类型——把非中国大陆的 IP 段按国家/地区拆成 18 个分组（香港、新加坡、美国、日本、德国、印尼、韩国、马来西亚、菲律宾、英国、泰国、法国、越南、俄罗斯、台湾、澳大利亚、印度、澳门），默认随包提供、全部启用，合计约 57.7 万条规则。

内核侧 `/api/v1/rule-groups/geoip_non_cn` 已经可用，但前端的分流页只认 5 个分组（custom_cn / custom_non_cn / geoip_cn / geosite_cn / geosite_non_cn），新类型在界面上完全不可见，也没法启停、更新或删除。

## 适配

| 位置 | 改动 |
|---|---|
| `frontend/src/features/rules/index.js` | 分流分组表补入 `geoip_non_cn`，标签「GeoIP 非 CN」，按 IP 段处理（不套用域名正则选项） |
| `frontend/src/core/api/backend-client.ts` | 分组白名单加入 `geoip_non_cn`，`/plugins/geoip_non_cn/config` 映射到 `/api/v1/rule-groups/geoip_non_cn` |
| `frontend/tests/backend-client.test.ts` | 增加 geoip_non_cn 映射断言 |
| `VERSION.json` / `_src/ui/version.json` | 后端改为 FJH7Q，标签 `fjh7q-ui-v2026.10.30.3` |
| `frontend/index.html` | 角标改为 FJH7Q |
| `tools/package_ui.py` | 运行时模板白名单加入 FJH7Q，完整包可直接以 FJH7Q 内核包为模板重建 |

分流页的其余逻辑是通用的：分组卡片、表格视图、搜索、国内/海外用途筛选、启停、更新、编辑、删除、详情抽屉都直接复用，不需要为这个类型写单独的分支。

## 效果

- 「规则 → 在线分流」的「海外解析」分组从 6 个来源变成 24 个（新增 18 个 GeoIP 非 CN）。
- 每张卡片显示国家/地区、SRS 格式、规则条数、上次更新时间，可直接启停或更新。
- 「添加规则」的类型下拉里出现「GeoIP 非 CN」，可自行添加其他国家/地区的 SRS 订阅。

## 验证

- `npm run check` 全部通过：21 个测试文件 170 项单测、lint、`tsc --noEmit`、构建一致性校验、字体子集检查。
- 生产环境（Alpine / FJH7Q 内核）用无头浏览器实跑：分流页渲染 18 张 GeoIP 非 CN 卡片，海外解析 24 个来源、国内解析 22 个来源，无 error-panel、无 JS 异常。
- 内核规则计数与升级前逐项一致（`custom_cn` 1250、`custom_non_cn` 33、`geosite_cn` 113024、`geosite_non_cn` 27470 等）。

## 升级说明

- **UI 更新包**：只替换界面资源，不动内核、配置、规则与上游，无需重启 DNS；安装后刷新页面即可。
- **完整包**：含 FJH7Q 内核与干净的默认配置（清空别名、手工名单、运行数据与私有上游示例），用于全新安装或整机替换。
- 本版起 UI 发行标签走 `fjh7q-ui-*` 线；FJH50 内核的安装不受影响，继续使用 `fjh50-ui-*` 的更新包。
