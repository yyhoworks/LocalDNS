# FJGAC / UI 2026.10.19.7

本版包含本机 .6 的静态共享配置与服务清理。DNS 核心继续使用 FJGAC。

## 更新内容

- 名称、LocalDNS Logo、字体文件及标题 / 数字 / 正文的字体选择可通过服务器静态文件跨设备共享。
- 外观设置支持本机预览、导出配置 ZIP；在服务器用包内 `configure-ui.py` 导入，其他设备刷新即可读取。已有本机覆盖可点击「跟随服务器」。
- 代理入口自动读取面板网站图标，支持子路径、深浅色图标及失败回退，移除独立代理 Logo 设置。
- 完全移除 9098 配置服务、代理配置编辑器、服务器长期采样和名单备份模块，以及对应的构建依赖和 Service 发行包。
- 名单直接保存到 DNS 核心，保存前重读并检查变化，保存失败保留草稿；吞吐图显示当前浏览器会话 15 / 30 / 60 / 120 分钟的真实采样。
- 一键安装器与手动 UI 更新脚本均保留 `ui/custom/` 和 `ui/config.js`。

## 安装与更新

新装下载 `LocalDNS_FJGAC_UI_2026.10.19.7_Full.zip`；已有安装下载 `LocalDNS_UI_2026.10.19.7_Update.zip`，解压后运行：

```sh
sh install-ui.sh /opt/localdns
```

也可使用 [一键安装](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.7/docs/ONECLICK.md)，已有安装默认只更新 UI。使用 `SHA256SUMS.txt` 校验两个 ZIP。完整包复用已校验的 FJGAC 三架构二进制、默认配置和规则；本次无需升级 DNS 核心。

共享设置的导入、字体格式及旧服务迁移见 [共享配置指南](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.7/docs/SHARED_UI.md)。网页上传先保存在本机，导入服务器后才会跨设备共享；壁纸、主题与玻璃参数仍由各浏览器保存。

## 旧版迁移提示

本版不再访问 9098，也不再提供同机 Mihomo / sing-box 配置编辑、服务器名单备份和 7 天采样。旧服务文件不会被普通 UI 更新自动删除：请先迁移名称、Logo 与面板地址，按需归档旧数据，再停止、取消开机启动并清理旧服务。历史源码与 Service 包仍可在 `.5` 标签及旧 Release 查阅。

DNS API 无原子条件写入，保存前的变化检查仍需配合避免多设备同时编辑同一名单。完整验证与本机清理范围见 [本版验证记录](https://github.com/yyhoworks/LocalDNS/blob/fjgac-ui-v2026.10.19.7/docs/validation/static-ui-cleanup-2026.10.19.7.md)。
