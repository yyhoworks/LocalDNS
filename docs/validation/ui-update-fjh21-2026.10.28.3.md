# UI 2026.10.28.3 验证记录

## 功能范围

修复 FJH 内核发行标签被写死成 `fjg` 前缀引起的两处拒装，并把旧版 UI 安装脚本的同核心护栏补齐：

- `tools/install_localdns.py`：`backendVersion` 校验由 `FJG[A-Z0-9]+` 改为 `FJ[A-Z][A-Z0-9]+`（PR #11）。
- `tools/ui_updater.py` 的 `TAG` 与 `frontend/src/features/version/ui-update-client.ts` 的 `upgradeTarget`：发行标签由 `fjg[a-z0-9]+-ui-v…` 改为 `fj[a-z][a-z0-9]+-ui-v…`（PR #12）。跨核心护栏未变，仍按 `backendVersion` 比对。
- `tools/install-ui.sh`：同核心护栏由 `FJGLI || FJGOE` 改为 `case` 枚举并加入 `FJH21`。此前 FJH21 的 UI 包完全绕过该校验，FJGAC / FJGOE 设备可被直接装入 FJH21 界面；现在按包声明的 `Backend` 与已装 `ui/version.json` 比对后拦截。

## 自动验证

- `npm run check`：构建、类型检查、160 项测试、ESLint、生成物一致性、字体子集检查全部通过。
- 工具链 Python：`test_oneclick_installer.py` 16 项、`test_ui_updater.py` 15 项、`test_package_ui.py` 15 项、`test_shared_ui.py` 6 项、`test_fjgli_upgrade.py` 7 项全部通过。其中 `test_ui_updater.py` 新增的 FJH21 用例跑完整升级事务（接受 `fjh21-ui-v…` 并成功、`fjgoe-ui-v…` 仍被核心比对拦住），`ui-update.test.ts` 新增同核心放行与 `xjh21-` 前缀拒绝用例。
- 打包：以已发布的 `LocalDNS_FJH21_UI_2026.10.28.2_Full.zip`（SHA-256 `6a255f1a…183368`，与线上资产 digest 一致）为 base，产出
  - `LocalDNS_FJH21_UI_2026.10.28.3_Full.zip` 18,275,492 B · `bd26031b50df6027cee7676fbd05b9a9872fb31f5796e8b4e3b86bd88d7861cc`
  - `LocalDNS_UI_2026.10.28.3_Update.zip` 2,110,313 B · `d7145efcbf95d89945d1a3a7b8b3db605b5a37c55cdf43790adfca694a52f112`
  - `SHA256SUMS.txt` · `3409baaa5788daf04c9a8a7d37dd982fc46e84c37f33481e99eb2c8b3b528c68`
- 安装器对新包做隔离暂存全新安装（`--stage-root`，未启停宿主服务），退出码 0，落地 UI 版本 2026.10.28.3。
- `install-ui.sh`：`sh -n` 通过；在隔离目录实测三组同核心校验——包 FJH21 / 已装 FJGOE 拦截、包 FJH21 / 已装 FJH21 放行并完成安装、包 FJH21 / 已装 FJGAC 拦截。未列入的旧内核包（如 FJGAC）仍按原逻辑跳过校验。

## 发行

- 标签 `fjh21-ui-v2026.10.28.3`，提交 `bb6b251`，Release 三个资产已上传，GitHub 记录的 SHA-256 与本地一致。

## 实机部署（192.168.1.2，Alpine 3.23 / OpenRC / FJH21）

1. 传入更新包并在设备上复核 SHA-256 一致后解压。
2. `sh install-ui.sh /opt/localdns`：安装 UI 2026.10.28.3，生成 `ui-backup-2026.10.28.3-20261028-163056-27939.tar.gz` 与同戳 `ui.previous-…`。
3. `python3 ui-updater/install_ui_updater.py --dir /opt/localdns --origin http://192.168.1.2:9099 --port 9100`：更新 `bin/ui-updater/*.py`、`ui/config.js` 的更新入口与 OpenRC 服务，服务重启成功。

部署后状态：

- `ui/version.json` = 2026.10.28.3 / FJH21 / `fjh21-ui-v2026.10.28.3`；`index.html` 引用 `/ui/assets/app-C_YIelAD.js`；`ui/config.js` 与 `ui/custom/` 保留。
- 构建产物内旧正则 0 处、新正则 1 处；`bin/ui-updater/ui_updater.py` 为新 `TAG`。
- `localdns` 与 `localdns-ui-updater` 均为 started，53 / 9099 / 9100 正常监听；`www.qq.com`、`github.com` 解析返回正常。
- 升级执行端接口探针（均无副作用）：

| 请求标签 | 返回 | 结论 |
|---|---|---|
| `fjh21-ui-v2026.10.28.3` | 409 目标版本没有高于当前 UI | 标签被接受，仅因已是最新 |
| `fjh21-ui-v2026.10.28.2` | 409 同上 | 旧版本接受但拒绝降级 |
| `fjgoe-ui-v2026.10.29.1` | 409 目标发行版需要不同的 DNS 核心 | 跨核心护栏生效 |
| `xjh21-ui-v2026.10.29.1` | 400 请选择本项目的正式 UI 发行版 | 非法前缀仍被拒 |

- 服务端访问 GitHub：`api.github.com` 200、`releases/latest` 为 `fjh21-ui-v2026.10.28.3`、资产流可下载（ZIP 头 `50 4b`），CA 为 `/etc/ssl/cert.pem`，Python 3.12.15。

## 回滚

- UI：`/opt/localdns/ui-backup-2026.10.28.3-20261028-163056-27939.tar.gz`，或把同戳 `ui.previous-…` 目录换回 `ui/`。
- 升级执行端：`/opt/localdns/.ui-updater/config.js.before-setup-*` 保留替换前的站点配置。

## 限制

- 面板「检查更新」由浏览器直连 `api.github.com`，需要打开面板的设备能访问 GitHub；下载与安装由服务器完成。
- 跨核心（例如未来的 FJH22）仍会被拒绝，须用完整包与 `upgrade-localdns.py` 迁移，这是设计行为。
- 升级执行端只接受 `.ui-updater/config.json` 中 `allowedOrigins` 的来源（当前 `http://192.168.1.2:9099`）；换域名或反代打开面板需重跑 `install_ui_updater.py --origin <地址>`。
- `install-ui.sh` 的护栏改动提交于 2026.10.28.3 发行之后，未重发安装包：已发布的 2026.10.28.3 包内仍是旧脚本（对 FJH21 设备无行为差异），新脚本随下一次发行生效。
