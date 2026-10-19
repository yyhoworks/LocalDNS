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

## 外部面板图标

代理入口直接加载用户配置的面板站点图标，不再随安装包分发 Mihomo / sing-box 标识。图标与商标权利归对应项目及权利人所有。

配置编辑器与独立 Go 服务已从当前版本移除，其历史源码与许可可查阅 [UI 2026.10.19.5](https://github.com/yyhoworks/LocalDNS/tree/fjgac-ui-v2026.10.19.5)。
