# FJHAI / UI 2026.10.31.5

内核更新改为上传原作者提供的 ZIP：在「版本与更新 → 内核」选择 ZIP 后，点击「上传并准备更新」。服务器自动选择对应架构的内核，保留当前 UI、配置和规则；目标不再受 GitHub 最新发行版内核版号限制，同版号但文件不同也可更新，完全相同的文件会提示无需重复更新。

上传完成后生成完整备份。请下载到电脑，并选择已下载文件校验；通过后才会在独立目录和回环端口预检新内核，随后切换并检查管理接口与 UDP/TCP DNS。预检失败会停止，切换验收失败会恢复。上传期间保持网页打开，上传完成后关闭网页不会中断服务器任务。

UI 单独升级与 UI + 内核整套升级继续使用 GitHub 正式发行包。本版生产内核仍为 FJHAI，二进制不变。

已有网页升级服务也需要更新；仅安装新 UI 不会自动替换服务器上的升级程序。在本版包的解压目录运行：

```sh
python3 ui-updater/install_ui_updater.py --unified --dir /opt/localdns --origin http://服务器IP:9099
```

上传 ZIP 最大 256 MB，包内需有唯一的 `LocalDNS_版本_Binaries` 目录。服务器核对上传 SHA-256、ZIP 路径与体积、目标 ELF 架构，仅读取所需程序；包里的 UI、设置和安装脚本不导入或执行。完整流程及 HTTPS 代理配置见 [网页升级说明](https://github.com/yyhoworks/LocalDNS/blob/main/docs/WEB_UPDATE.md)。

同时合入 [PR #23](https://github.com/yyhoworks/LocalDNS/pull/23)：完整发行包缺少对应架构二进制时，提前显示明确错误，保持现有安装。

验证记录见 [内核 ZIP 上传验收](https://github.com/yyhoworks/LocalDNS/blob/main/docs/validation/core-upload-2026.10.31.md)。随本正式版提供 UI 更新 ZIP、FJHAI 完整 ZIP 和 SHA256SUMS.txt。
