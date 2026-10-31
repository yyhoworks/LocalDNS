# FJHAI / UI 2026.11.01.1

修复概览「快捷控制」里缓存开关看起来像没开的问题。

- **原因**：核心缓存与乐观过期共用同一组分段控件，滑块只按第一个激活项渲染；两项都开时第二项没有底。分段控件本身又是单选语义，两项并排容易被读成「二选一」，浅色主题下选中态几乎不可见。
- **改法**：两项拆成独立开关，复用后台「启用」的开关组件；名称在左、轨道在右，右侧补「开 / 关」文字。读取失败时保留虚线轨道、居中圆点和琥珀「未知」并继续禁用。「客户端分流」仍用分段控件，那里确实是单选。
- **行为**：绑定改为 `change` 事件，提交期间禁用防连点，失败回滚勾选状态并提示；`switch13` / `switch4` 接口、toast 文案和顶部摘要不变。

本版继续使用 FJHAI 内核，提供 UI 更新 ZIP、完整 ZIP 和 SHA256SUMS.txt。UI 更新保留 DNS 配置、规则、站点配置、Logo 与字体，无需重启 DNS。

本版未改动升级程序与服务端模块，已有网页升级服务无需重新安装；需要重装时在新包的解压目录运行：

```sh
python3 ui-updater/install_ui_updater.py --unified --dir /opt/localdns --origin http://服务器IP:9099
```

上传内核 ZIP、完整备份下载校验、隔离预检和恢复流程沿用上一版。详见 [网页升级说明](https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md)。

构建、208 项前端测试与生产验收通过，详见 [验证记录](https://github.com/yyhoworks/LocalDNS/blob/main/docs/validation/fjhai-2026.11.01.1.md)。
