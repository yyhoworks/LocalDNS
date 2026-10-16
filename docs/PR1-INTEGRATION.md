# PR #1 正式版整合记录（UI 2026.10.16.3）

## 来源与可回退点

- 上游 main：`7b3cca3`（UI 2026.10.16.2）。
- 用户原有 7 个文件的未提交改动保存在提交 `dfd727c`，便于追溯。
- 来源 PR：<https://github.com/yyhoworks/LocalDNS/pull/1>；作者 [@clone-fan](https://github.com/clone-fan)，head `830b64ea7c5bd3e797c0a17405ce37c284e3c405`。
- 原整合提交 `0d20602` 保留视觉和字体贡献；追加合并 `0bf2f06` 收录作者最新 KPI 数字 / 单位修复。原始三个贡献提交均保留，不以复制文件替代作者历史。
- 整合分支 `codex/integrate-ui-polish` 的结果作为 main 上的正式版 `ui-v2026.10.16.3` 发布；发布包不含设备配置、部署记录或未脱敏截图。

## 适配决策

- 解决 `app.js`、`index.html` 冲突，保留非拓扑区域的现有功能与本地修改。
- 按用户最终指定版本，DNS 解析路径采用 [UI 2026.10.16.1 / FJG4O](https://github.com/yyhoworks/LocalDNS/releases/tag/ui-v2026.10.16.1)（`3b92f5d`）的五列结构、22px 列间距、节点信息位置和居中连线；移除 10.16.2 的预设工具条、公式栏、微进度条、出口矩阵及加权端口布局。原有紧凑布局仍可从 `dfd727c` 恢复。
- 保留客户端别名去重、关闭缓存时不显示命中率、禁用上游不参与巡游等兼容修复。恢复布局不涉及后端 DNS 解析逻辑、配置或服务版本。
- `topology-flow.js` 为独立的可停止路径示意层。手动悬停或键盘聚焦节点、关闭粒子、减少动态效果、后台和切页时停止；不代表逐条 DNS 请求的真实追踪。
- 字体上传从 `material.js` 拆至 `font-uploads.js`，通过 `appearance.js` 加入标题、数字、正文下拉框。等宽技术字体和已有偏好保留。
- 上传与移除先确认 IndexedDB 事务成功，再更新 UI；失败不丢失原有字体。与壁纸共用数据库，但使用独立 `fonts` 键。
- 未接入依赖缺失字体文件的 `fonts-misans.css`、`fonts-harmony.css`、`fonts-serif.css`；继续使用仓库既有字体与用户本地上传。
- 保留原后端版本显示默认值；隐藏与自定义文字作为可选项。
- 动画先建立数字 / 单位分层，仅更新数字文本叶节点；结构损坏后可重建，减少动画和切页保护继续保留。

## 本地只读预览

```powershell
$env:LOCALDNS_PREVIEW_BACKEND='http://你的后端地址:9099'
node tools/preview_ui.cjs
```

打开 <http://127.0.0.1:8792/ui/>。只监听本机，代理仅允许已知读取接口；POST、PUT、DELETE 与 GET 清缓存等动作均拒绝。浏览器内的外观设置可以正常保存。

## 验证与打包

使用已安装的 Playwright（必要时通过 `NODE_PATH` 指向其 node_modules）：

```powershell
node tools/verify_ui_merge.cjs
node tools/test_countup.cjs
python tools/package_ui.py
```

浏览器报告和截图输出至被 Git 忽略的 `dist/pr1-verification/`。截图可能包含设备和 DNS 查询信息，不应直接发布。

验证范围：真实后端只读数据、Edge 桌面 1440px / 手机模拟 390px、深浅主题、五个页面、字体保存与失败分支、壁纸键共存、圆角与版本、拓扑与动效、弹窗、搜索、复制、规则草稿。未执行任何后端写入，也不声称验证真实手机硬件或其他浏览器。

正式版 21 项浏览器回归及独立数字动画边界测试全部通过。布局断言覆盖 10.16.1 的五列比例、22px 间距、客户端图标隐藏、居中连线，以及不存在 10.16.2 的公式栏和预设工具条。正式版另外验证 KPI 结构恢复和动画中途减少动态效果、切页脱离 DOM 的保护；结果见 [发布说明](releases/ui-v2026.10.16.3.md)。
