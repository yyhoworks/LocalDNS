# UI 2026.10.19.8 验证记录

日期：2026-10-19（Asia/Shanghai）。后端保持 FJGAC。本版将已完成的 Phase 0–7 重构同步到 `main`，加入字体菜单修复并发布为正式版。

## 字体菜单修复

原因是三个字体 select 未使用现有版本标签选择器的主题类，弹层采用了操作系统默认颜色。为三个现有原生 select 添加同一个样式类，直接复用深浅色 picker、选项、选中态与圆角；不另建 JavaScript 菜单。

`node tools/verify_font_selects.cjs` 检查桌面1440与手机390、glass/claude两皮肤、深浅主题，共8种组合：

- 三个菜单的实际 picker 背景与正常版本标签菜单一致。
- 实际打开菜单、键盘向下选择及 Enter 生效。
- 刷新后选择恢复；上传字体 optgroup 可选，Escape 不改变已选值。
- 无横向溢出和页面异常；截图记录在忽略的 `dist/font-select-verification/`。

## 重构验收与发布

类型检查、85项 Vitest、lint、干净重建、既有16项 Node 回归、14项打包测试、6项共享配置和14项安装器测试均有可复验入口。五路由状态、规则草稿/失败/冲突、共享配置、三视口、双皮肤/主题/导航矩阵及生命周期验收详见 [Phase 0–7 验证](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.8/docs/refactor/frontend-phase-07-validation.md)。

本版重新构建并核对版本元数据；UI Update/Full 由同一个已验证 `dist/ui/` 生成，校验 CRC、全部文件清单与 SHA-256。完整包以已发布 `.7` 基础包派生，其公开 SHA-256 为 `38352a0d9eee6a2e36f43e784e03e936c4a9cf1bcd49db86f84e555074bf61c2`，保护内核、默认 DNS 配置、规则和服务文件。

没有恢复已删除的9098配置编辑器、服务器名单备份或长期采样。字体偏好、静态共享设置和旧浏览器原生回退保持兼容。浏览器实测为 Windows Edge；Safari、旧设备和各架构内核运行未在本次扩展验证范围。
