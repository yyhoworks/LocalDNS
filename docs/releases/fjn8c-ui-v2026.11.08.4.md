# FJN8C / UI 2026.11.08.4

修复在线升级始终卡在 GitHub 下载，以及等待备份确认时持续显示“更新中”的问题。

## 根因与修改

故障设备直连 GitHub 网页下载入口超时，经本机代理请求该路径也返回 HTTP 504，未取得附件重定向。
同一附件通过 GitHub 官方 API 下载成功，并由官方 CDN 返回正确字节。
此前安装器只使用 `browser_download_url`，因此版本检查正常也可能无法下载。

- 新安装器优先使用经过仓库 / 附件 ID 核对的[GitHub 官方附件 API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)，
  请求文件字节并处理 HTTPS 重定向。
- API 入口超时、网关故障或限流时，才回退同一附件的原始下载地址；已有标签的限流降级保持兼容。
- TLS、GitHub 附件摘要、安装包 SHA-256、全文件清单保护继续保留。证书、权限、文件缺失及摘要错误直接停止。
- 等待本机备份校验时显示“等待备份确认”，停止旋转动画并收起其他升级选项，已上传内核不再显示“尚未选择文件”。

## 已有设备如何更新

**仅更新 UI 不会替换服务器上的下载器。先完成或取消已有任务，再更新升级服务。**

下载本版 Update.zip 及 `SHA256SUMS.txt`，核对摘要、解压后，在解压目录按原安装参数执行：

```sh
python3 ui-updater/install_ui_updater.py --unified \
  --dir /opt/localdns --origin http://服务器IP:9099
```

自定义目录、端口、Origin 或 HTTPS 入口沿用原值，见 [网页升级说明](../WEB_UPDATE.md)。
然后刷新“版本与更新”连接，再准备升级。网络需能访问 GitHub API 和附件 CDN；不保证绕过所有网络限制或 API 限流。
下载入口均不可达时仍可使用本地内核 ZIP 或已校验的离线包，不需要关闭证书检查。

## 下载与验证

- `LocalDNS_UI_2026.11.08.4_Update.zip`：UI、安装器 1.4.2 和升级服务脚本。
- `LocalDNS_FJN8C_UI_2026.11.08.4_Full.zip`：保留上版四架构内核、配置和规则的完整包。
- `LocalDNS_ProxyConfig_UI_2026.11.08.4_Service.zip`：程序仍为 1.7.1。
- `SHA256SUMS.txt`：三个包的校验值。

新下载器在原故障设备上已在线获取校验文件和 37.6 MB 完整包，并通过 SHA-256 与 ZIP 检查。
等待备份状态和接口回退均有回归检查；范围见 [发布验证与旧代码退役清单](../validation/fjn8c-2026.11.08.4.md)。
