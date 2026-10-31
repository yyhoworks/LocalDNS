# 网页内升级 UI 与内核

在顶部「版本与更新」扩展弹窗中，可分别选择：

| 操作 | 更新内容 | DNS 服务 |
|---|---|---|
| 升级 UI | 只更新界面；保留当前内核、站点设置、Logo 和字体 | 继续运行 |
| 升级内核 | 使用完整发行包的新内核与运行目录；逐项迁移原设置，完整保留当前 UI | 切换时短暂重启 |
| 升级 UI + 内核 | 使用同一正式发行版的界面与内核，迁移原设置 | 切换时短暂重启 |

只有检查更新自动运行。安装、恢复均由用户点击发起。关闭弹窗或网页不会中断已提交任务，再打开可以查看进度。

## 首次安装或从旧版服务迁移

需要已有 LocalDNS、Python 3.8+、root，以及 systemd / OpenRC。在本版 UI 升级包或完整包解压目录运行一次：

```sh
python3 ui-updater/install_ui_updater.py --unified \
  --dir /opt/localdns --origin http://服务器IP:9099
```

源码安装使用 `python3 tools/install_ui_updater.py --unified`，参数相同。新发行包的安装器添加 `--with-ui-updater --origin http://服务器IP:9099` 时，会自动选择新版服务。

新版服务名称是 `localdns-updater`，程序位于 `/opt/localdns-updater`，配置与任务、备份位于 `/var/lib/localdns-updater`。它们均在 `/opt/localdns` 之外，因此替换内核目录不会删除升级服务。默认端口仍为 9100，安装成功后关闭旧 `localdns-ui-updater` 启动项，并将入口写入现有 `ui/config.js`。安装服务本身不重启 DNS。

`--origin` 是浏览器实际访问网页的来源，只包含协议、主机和端口。可通过 `--listen`、`--port`、`--public-url` 调整；只在可信管理网络开放。原有配置不打印到日志。安装时有未完成任务则拒绝覆盖服务。

旧版升级服务仍可供新界面单独升级 UI；弹窗会提示安装新版服务后启用内核升级。旧版 `POST /upgrade/ui` 接口保留兼容。

## 内核与整套升级流程

1. 服务器只从本项目 GitHub 正式发行版下载包，验证附件摘要、`SHA256SUMS.txt` 和覆盖全部文件的 `MANIFEST.sha256`。
2. 生成原 LocalDNS 的完整压缩备份，准备独立的新运行目录，原服务继续运行。
3. 弹窗提供备份下载。用户保存到电脑后，选择该文件进行分块 SHA-256 校验；局域网 HTTP 页面也可使用，不依赖 HTTPS WebCrypto。
4. 只有完整传输且本机文件摘要一致，才允许继续。设置在备份后发生变化会停止升级，必须重新准备。
5. 在回环地址、临时独立端口启动新内核，检查管理接口、上游、别名、开关、缓存预算与 UDP/TCP DNS。
6. 预检通过后短暂停服、同盘切换目录、重新启动和验收。验收失败自动恢复原目录；事务中断时，下次启动根据持久化日志恢复。

保留上游 `config/upstreams`、手工规则 `rules/manual`、别名 `config/settings/client_aliases.json`、订阅 `config/subscriptions`、已下载订阅源和适配范围内的其他设置。未知配置字段或缺失的已启用订阅来源会阻止升级，避免静默丢失配置。

“只升级内核”会复制当前整个 UI；实际内核版号另记在 `core-version.json`，不再用 UI 包原先的内核要求代替实际内核版本。未来同接口、同配置格式的内核版本通过 `updateCompatibility` 契约适配，不以当前内核代号写死限制；契约变化时需先适配服务。

## 回退与备份

UI 升级可恢复上一版 UI，同时保留当前站点设置、Logo 和字体。内核或整套升级可恢复上一整套快照，设置也恢复到快照时；恢复前同样要求下载、校验当前完整备份。

等待备份确认时可以取消；进入预检或切换后按钮锁定，等待结果。网络超时会先重新查询任务，避免重复提交。备份及历史快照不自动删除；已取消或失败任务的下载、暂存目录会清理，完整备份保留。磁盘不足时停止准备，不切换现网。可在确认本机备份可用后按运维流程清理不再需要的历史备份。

## HTTPS 与反向代理

HTTPS 页面必须配置 HTTPS 升级入口。例如：

```sh
python3 ui-updater/install_ui_updater.py --unified --dir /opt/localdns \
  --origin https://dns.example --listen 127.0.0.1 \
  --public-url https://dns.example/_updater
```

```nginx
location /_updater/ {
    proxy_pass http://127.0.0.1:9100/;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;
}
```

备份传输使用固定 POST 接口，确保同源代理也携带网页 Origin。自定义 CSP 需将实际入口加入 `connect-src`。

## 权限与维护

服务以 root 运行，仅接受固定 JSON 操作，不接受客户端路径、URL 或命令，也不执行包里的安装脚本。写操作和备份下载限制已配置的 Host / Origin。无需额外升级口令；明文入口用于可信管理网络，跨不可信网络使用 HTTPS。摘要用于完整性验证，不等同于独立发行签名。

```sh
# systemd
systemctl status localdns-updater
journalctl -u localdns-updater

# OpenRC
rc-service localdns-updater status
```

升级服务代码本身通过上述安装命令更新，常规 UI 或内核升级不会替换正在运行的服务。变更接口或配置格式的发行版须先发布对应适配，不会自动尝试不兼容迁移。

## 验证

```sh
python3 tools/test_online_updater.py
python3 tools/test_ui_updater.py
python3 tools/test_fjgli_upgrade.py
npm run --prefix frontend check
```

测试覆盖三种升级方式、备份门槛、设置变化、暂存篡改、未来同契约内核、重复请求、重启等待恢复、取消、完整回退、失败恢复和 HTTP 限制。正式发布前另在隔离 Linux 服务上运行真实内核升级与回退，并验证桌面、手机和两套外观。
