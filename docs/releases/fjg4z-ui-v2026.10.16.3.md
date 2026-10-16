# LocalDNS FJG4Z / UI 2026.10.16.3

本次正式更新 **FJG4Z 内核**，保留 UI 2026.10.16.3、指定的 .1 版 DNS 解析路径布局和所有贡献署名。原 FJG4O Release 保留，不覆盖旧标签或附件。

## 更新范围

- 使用提供的 `LocalDNS_FJG4Z.zip` 内核；支持 amd64-v1、amd64-v3、arm64，完整包默认 amd64-v3，未附 ARMv7。
- 只取内核程序，不导入原 ZIP 附带的旧 UI、个人别名或配置。完整包的默认配置与规则沿用上一正式版的已清理模板。
- UI 样式、交互与字体不重新设计；更新后端版本元数据和初始版本标签，继续从真实接口读取运行版本。
- 未提供上游修复清单，因此不推测或声明内核内部功能变化。

## 下载与升级

| 附件 | 用途 |
|---|---|
| `LocalDNS_FJG4Z_UI_2026.10.16.3_Full.zip` | 新安装，或从 `LocalDNS_FJG4Z_Binaries/` 提取对应架构内核 |
| `LocalDNS_UI_2026.10.16.3_Update.zip` | 仅更新 UI，不会升级内核 |
| `SHA256SUMS.txt` | 两个 ZIP 的 SHA-256 |

**已有安装不要用完整包覆盖目录。** 备份后选择正确架构，先验证运行库与配置兼容性，再停止服务、更换 `/opt/localdns/bin/localdns` 并启动。保留 `config/`、`rules/`、`generated/`、`cache/`、`ui/` 及现有兼容库和启动环境。升级内核需要短暂重启 DNS 服务；失败时恢复旧内核。

详细步骤见 [安装说明](https://github.com/yyhoworks/LocalDNS/blob/fjg4z-ui-v2026.10.16.3/INSTALL.md)。

## 来源与校验

- 上游 ZIP SHA-256：`15e6200aad1fec5e9508780ea26166859b374a1e3fd7531a06da8255bae554a9`
- amd64-v1：`17a8a5746e1b9ef37e363b5ddc1e7586601ef18d8a0bffa3005e41ca302b25e9`
- amd64-v3 / 默认程序：`68afcdfaf2aea966962e55954293b06eb676d03c548e5aa512043dae278ae6ee`
- arm64：`6eb466efc5e39e55f06bada18326b7aa9a3cbcfe0da90f97f897bc58cba9cd08`

验证结果：amd64-v3 环境通过隔离实例的七类只读 API 与 DNS 查询；切换后 TCP / UDP 53 正常，30 个配置 / 手工规则文件保持一致（运行任务状态单独处理），原 UI 的 40 个 HTTP 文件核验通过，仅同步后端元数据。针对 FJG4Z 的 **22 项浏览器回归全部通过**，数字动画边界测试通过。

预编译内核未在此仓库重新编译；未逐架构进行运行测试。详见 [验证记录](https://github.com/yyhoworks/LocalDNS/blob/fjg4z-ui-v2026.10.16.3/docs/validation/fjg4z-2026.10.16.3.json)，不承诺所有系统或真实手机硬件均已覆盖。

## 作者

- **R 大（折腾日记交流群）**：Rust DNS 核心。
- **[yyhoworks](https://github.com/yyhoworks)**：UI 设计与仓库维护。
- **[@clone-fan](https://github.com/clone-fan)**：通过 [PR #1](https://github.com/yyhoworks/LocalDNS/pull/1) 贡献 UI 视觉、交互、字体上传与数字动画修复；原始提交历史和作者表保留。

作者表与第三方许可随两个下载包提供。
