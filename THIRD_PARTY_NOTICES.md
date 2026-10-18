# 第三方组件

| 组件 | 用途 | 许可 |
|---|---|---|
| Noto Serif SC | 宋体标题 | [SIL Open Font License](%5Fsrc/ui/assets/fonts/notoserifsc-OFL.txt) |
| Instrument Serif | 核心指标数字 | [SIL Open Font License](%5Fsrc/ui/assets/fonts/instrumentserif-OFL.txt) |
| Noto Sans SC | 中文正文 | [SIL Open Font License](%5Fsrc/ui/assets/fonts/notosanssc-OFL.txt) |
| IBM Plex Sans | 英文与 UI 正文 | [SIL Open Font License](%5Fsrc/ui/assets/fonts/ibmplexsans-OFL.txt) |
| IBM Plex Mono | IP、端口等技术信息 | [SIL Open Font License](%5Fsrc/ui/assets/fonts/ibmplexmono-OFL.txt) |
| Chart.js | 图表库 | MIT；见 [许可文件](docs/licenses/Chart.js-LICENSE.md) |

字体通过 Google Fonts 官方 CSS 获取，使用 WOFF2 子集以控制加载体积。来源和散列记录在 `_src/ui/assets/fonts/manifest.json`。

以上组件及其作者保留各自版权。项目 DNS 核心与界面作者见 [AUTHORS.md](AUTHORS.md)。

## 代理面板标识

- Mihomo Logo：来自 [MetaCubeX/mihomo 官方仓库](https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/Meta.png)，原文件保存在 `_src/ui/assets/img/mihomo.png`，SHA-256 为 `0dc1c7df03c02ac34ea60b7b169020648abdc6e199627c2e1276d337249289c8`。
- sing-box Logo：来自 [sing-box 官方网站](https://sing-box.sagernet.org/assets/icon.svg)，原文件保存在 `_src/ui/assets/img/sing-box.svg`，SHA-256 为 `e59b482bb4793e5f7c8d1e347c42e035babeb40ccea91748788d1da4e32c574b`。

标识仅用于辨认用户选择的外部面板，作品和商标权利归各自项目及权利人所有；不表示本项目与上述项目存在隶属或背书关系。


## 配置编辑器与管理服务

前端使用 CodeMirror 6（MIT）、Lezer（MIT）与 yaml 2（ISC），锁定依赖见 `tools/proxy-config-ui/package-lock.json`；bundle 中实际使用组件的许可汇总位于 `_src/ui/assets/licenses/proxy-config-editor.txt`。esbuild 用于构建，不作为运行时服务。

独立 Go 服务使用 Go 运行时（BSD 3-Clause）与 gopkg.in/yaml.v3（MIT / Apache 2.0，见上游许可）；版本和校验见 `services/proxy-config/go.mod` 与 `go.sum`。部署目录包含对应许可文本。2026.10.18.14 已移除 SSH 认证及 x/crypto / x/sys 依赖。
