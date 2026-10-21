# LocalDNS UI 2026.10.21.1

恢复 Mihomo / sing-box 配置编辑器和独立配置后端，增加 HTTP(S) 原始配置导入。HTTP 导入先生成草稿，默认保留目标管理接口，确认差异后校验、备份、保存并应用。备用配置明确只保存；sing-box 分片保留完整集合校验，重载反馈区分 API 确认和信号后在线检查。

本版为正式发行版。UI 更新包需要与配置服务包一起安装才能完成服务器文件管理与应用。安装与边界见 docs/PROXY_CONFIG.md；验收记录见 docs/validation/proxy-config-restoration-2026.10.21.md。
