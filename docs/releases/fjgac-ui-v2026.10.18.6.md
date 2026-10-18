# LocalDNS FJGAC / UI 2026.10.18.6

## 修复

- DNS 解析拓扑的普通节点、中间缓存卡统一跟随外观面板的玻璃模糊度，修复原来分别固定为 14px、16px 的问题。
- 拓扑节点的基础与交互遮盖度改为跟随全局玻璃遮盖度，修复固定透明度导致滑块效果不完整的问题。
- 保留双皮肤及羊皮纸皮肤的无模糊背景。内核继续使用 FJGAC，运行配置与设备名单保持原有内容。

## 使用

流光毛玻璃皮肤下，打开「外观」，调整「毛玻璃模糊度」与「面板遮盖度」。设置保存在当前浏览器，刷新后恢复。

本地壁纸图片存于浏览器 IndexedDB；在线壁纸保存 URL，图片仍从原地址加载；外观参数存于 localStorage。不同浏览器或访问来源不共用设置。

## 下载

- `LocalDNS_FJGAC_UI_2026.10.18.6_Full.zip`：现有 FJGAC 三架构程序、默认配置与本版 UI。
- `LocalDNS_UI_2026.10.18.6_Update.zip`：仅更新界面。
- `SHA256SUMS.txt`：两个发行包的 SHA-256。

顶部导航栏设计参考 [MoviePilot](https://github.com/jxxghp/MoviePilot)。感谢 R 大的 Rust DNS 核心、yyhoworks 的 UI 设计及 clone-fan 的 PR #1 贡献。
