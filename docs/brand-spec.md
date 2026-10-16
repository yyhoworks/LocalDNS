# LocalDNS UI 整合的设计边界

本文件记录 PR #1 整合时的现有视觉依据，不引入新的设计体系。

- 模式：Extension / Operate；为 DNS 管理者保留高密度信息与稳定操作入口。
- Design Read：玻璃控制台，桌面与手机管理场景；视觉变化 3/10、动画 3/10、信息密度 8/10、图像依赖 2/10、品牌保真 10/10。
- 品牌资产：`_src/ui/assets/img/logo-08-dark.png`、`logo-04-light.png` 及同目录 64px 图标；不重画 Logo。
- 现有截图参考：`docs/images/overview-desktop.jpg`、`overview-light.jpg`、`overview-mobile.jpg`。代码中的当前拓扑结构与字体设置优先于历史截图。
- 色彩：沿用 `app.css` / `console.css` 的 `--text-*`、`--glass-*`、`--console-*` 语义变量；蓝、绿、青、琥珀、红分别保留原有路由含义。
- 字体：默认 Noto Serif SC 标题、Instrument Serif 数字、IBM Plex Sans + Noto Sans SC 正文；IBM Plex Mono 继续用于技术内容。字体上传只扩展三个角色的选项。
- 间距与圆角：保持现有 4/8px 节奏与 12/16px 卡片圆角基础值，新增 0–200% 圆角倍率，默认 100%。阴影与玻璃层级继承原站。
- 动效：短时反馈采用 PR 的 ease-out 曲线；拓扑巡游让位于手动追踪。系统减少动画、用户关闭粒子、切页和后台状态均停止巡游。
- 保护契约：五个主路由、API、后端功能、Logo、字体角色、localStorage 已有键、壁纸存储、键盘操作与移动导航保持不变。
- 最高风险：拓扑绘制数据结构与两套字体状态；通过独立流光模块和单一字体偏好入口整合，不把 CSS 全局覆盖当作功能兼容。
- 用户最终布局要求：DNS 解析路径以 `ui-v2026.10.16.1`（`3b92f5d`，FJG4O）为视觉依据：五列比例 `1fr 1.05fr 1.08fr 1fr 1fr`、22px 列间距、左右并排的节点信息、居中连接端点；不保留 10.16.2 的公式栏、预设工具条、微进度条或出口矩阵。流光与玻璃效果以独立层叠加，不改变这套布局。
