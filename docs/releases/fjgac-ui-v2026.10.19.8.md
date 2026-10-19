# FJGAC / UI 2026.10.19.8

完成前端模块化重构，并修复外观面板字体下拉菜单的颜色。DNS 核心继续使用 FJGAC。

## 更新内容

- 标题字体、指标数字、界面文字三个选择器复用版本标签菜单的主题样式，修复深色界面中出现浅灰弹层的问题；保留键盘选择、上传字体分组和刷新恢复。
- 前端源码集中到 `frontend/`，使用显式模块依赖，统一页面挂载、离开保护、请求取消、定时器和临时浮层清理。
- 请求、错误、关键响应校验、偏好存储与动态 HTML 安全渲染有统一边界；规则保存失败继续保留草稿，旧页面响应不会覆盖新页面。
- 发布采用完整静态构建、内容哈希资源、构建元数据和 SHA-256 校验；运行服务器不需要 Node.js 或 CDN。
- 保留当前五个页面、双皮肤、导航布局、共享名称/Logo/字体、代理面板入口和 DNS API。

## 安装与更新

新安装下载 `LocalDNS_FJGAC_UI_2026.10.19.8_Full.zip`。已有安装下载 `LocalDNS_UI_2026.10.19.8_Update.zip`，核对同页 `SHA256SUMS.txt` 后解压并执行：

```sh
sh install-ui.sh /opt/localdns
```

也可使用 [一键安装](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.8/docs/ONECLICK.md)。更新会先备份 UI，保留 `ui/config.js`、`ui/custom/` 中的共享配置、Logo 与字体。无需升级或重启 DNS 核心；不要用完整包默认配置覆盖现有安装。

字体菜单在支持 `appearance: base-select` 的浏览器中使用统一主题弹层；较旧浏览器保留原生选择器。实际浏览器验收使用 Windows Edge，未声称完成 Safari 或旧设备实机认证。

完整实现、测试矩阵和已知边界见 [本版验证记录](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.8/docs/validation/frontend-refactor-2026.10.19.8.md)。
