# 网页内升级 UI

网页在「版本与更新」中调用服务器的 `POST /upgrade/ui`，下载和文件替换由服务器执行。借鉴 zashboard 调用核心升级接口的方式；FJGAC 当前没有在本仓库提供可扩展的核心源码，因此当前实现配套一个可选的 Python 更新执行端，首次需要安装一次。它与已移除的 9098 配置服务无关。

## 首次安装

需要已有 LocalDNS、Python 3.8+、root，以及 systemd / OpenRC。使用**包含本功能的版本**的 UI 升级包或完整包；旧发行包没有 `ui-updater/`。在解压后的包目录运行：

```sh
python3 ui-updater/install_ui_updater.py --dir /opt/localdns --origin http://服务器IP:9099
```

`--origin` 必须是浏览器实际访问网页的来源，只含协议、主机、端口。默认执行端监听 `0.0.0.0:9100`；可以通过 `--listen` / `--port` 调整。只在可信管理网络开放该端口。安装器注册 `localdns-ui-updater` 启动项，将入口地址写入 `ui/config.js`，保留原有站点设置。无需设置升级口令。

从源码安装时，可直接运行 `python3 tools/install_ui_updater.py`，参数相同。它不会更新或重启 DNS 核心。

安装器 1.3.0 可在新安装或命令行 UI 更新时添加 `--with-ui-updater --origin http://服务器IP:9099`，自动安装发行包中配套的执行端。此选项从 UI `2026.10.19.9` 发行包起可用，`.8` 及更早发行包会在修改安装前明确提示不支持。

刷新网页，打开顶部「版本与更新」，即可直接查看状态和升级。发现更高版本的同核心正式 UI 后，点击「升级至…」。升级完成后手动刷新；关闭网页不会中断服务器任务。重新打开网页即可查看服务器保存的任务结果。

只有检查更新会自动运行。安装升级始终由用户点击发起，不会自动替换 UI 或升级 DNS 内核。

## HTTPS 与反向代理

通过 HTTPS 访问网页时，升级执行端也必须提供 HTTPS 入口。可只监听本机，再由现有反向代理提供同源路径：

```sh
python3 ui-updater/install_ui_updater.py --dir /opt/localdns \
  --origin https://dns.example --listen 127.0.0.1 \
  --public-url https://dns.example/_updater
```

Nginx 示例（转发时去掉 `/_updater/` 前缀，保留实际网页 Host）：

```nginx
location /_updater/ {
    proxy_pass http://127.0.0.1:9100/;
    proxy_set_header Host $host;
    proxy_read_timeout 15s;
}
```

后台任务异步运行，网页请求只提交任务或读取状态，不占用长连接。前端的 `uiUpdaterBase` 留空时尝试同源接口，便于以后由核心直接实现相同协议。

使用自定义 Content-Security-Policy 时，需将实际升级入口加入 `connect-src`；同源反向代理只需保留 `'self'`。

## 校验、保留与回退

- 固定下载本项目 GitHub 指定正式标签的 UI 升级包，校验 `SHA256SUMS.txt`、附件摘要（如有）及覆盖全部文件的 `MANIFEST.sha256`。摘要用于完整性校验，不等同于独立发行签名。
- 拒绝任意下载地址、文件路径、命令、低于或等于当前 UI 的版本以及不同 DNS 核心的发行版。
- 先备份、同盘暂存，再切换 UI。保留 `ui/config.js` 和 `ui/custom/`；不替换核心、DNS 配置、规则和缓存。
- 保留上一构建清单中的静态资源，供已打开的页面加载旧版模块；不会无限累计全部历史构建资源。
- 更新前管理接口在线时，更新后核对 UI 版号和管理接口，失败恢复旧 UI。原服务离线时只更新文件，结果会明确提示服务尚未验证。
- 文件切换前保存事务日志。执行端或安装器重新启动时，在共用安装锁下恢复未确认的切换。旧版安装器留下的无格式锁仍需确认没有安装任务后手动清理。
- 最近一次成功操作之后可点击「恢复上一版 UI」。恢复同样保留当前站点配置、Logo 和字体；因此不会回退这些个性化设置。

备份目录和压缩备份不自动删除。服务器任务记录保存在 `.ui-updater/state.json`，执行端源码安装于 `bin/ui-updater/`，普通 UI 更新不自动替换执行端自身。

## 权限与维护

执行端需要写入既有 UI 目录及安装锁，默认随 root 服务运行。它不执行 shell 或压缩包里的安装脚本；写操作必须来自配置允许的 Host / Origin，并使用 JSON 提交固定操作。无需额外口令或登录。HTTP 明文入口仅适合可信管理网络；跨不可信网络使用 HTTPS。

从 UI 2026.10.19.9 更新时需重新安装执行端（或在命令行 UI 更新时添加 `--with-ui-updater`），同步移除服务端口令校验并自动清除旧口令摘要。修改管理地址或端口时重新执行并提供新 `--origin`。更新执行端代码同样重新执行安装命令，保留站点设置。

```sh
# systemd
systemctl status localdns-ui-updater
journalctl -u localdns-ui-updater

# OpenRC
rc-service localdns-ui-updater status
```

升级成功只代表该次 UI 文件和已执行的健康检查通过，不代表已验证所有浏览器或设备架构。校验失败、空间不足或网络不可达时，可重试或继续使用命令行 / 离线安装。

## 验证

```sh
python3 -m unittest discover -s tools -p 'test_ui_updater.py'
npm run --prefix frontend check
node tools/verify_ui_update.cjs
```

自动测试使用隔离目录、模拟发行包和回环 HTTP 服务；浏览器写请求全部由夹具响应，不访问真实设备升级接口。
