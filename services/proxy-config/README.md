# LocalDNS 代理配置管理服务 1.6.0

为现版 LocalDNS 提供 Mihomo YAML / sing-box JSON、JSONC 的文件读取、目录浏览、HTTP 获取、核心校验、备份、保存和应用。HTTP 获取不依赖 ConfigFlow。

## 安装

在核心所在的 Linux 设备解压配套 Service.zip，然后执行：

```sh
sh install-proxy-config.sh http://服务器IP:9099
```

程序安装到 `/opt/localdns-proxy-config/bin/localdns-proxy-config`，配置在 `/etc/localdns-proxy-config.json`。支持 Linux amd64 / arm64、systemd / OpenRC。安装器备份旧程序并保留已有核心路径、允许目录和重载钩子；不会替换或重启 DNS 核心。

首次安装后，核对配置中的 `binary`、`config`、`directory`、`roots` 和 `pidFile`。默认查找 `/usr/local/bin/mihomo`、`/etc/mihomo/config.yaml`、`/usr/local/bin/sing-box`、`/etc/sing-box/config.json`；实际路径不同应修改后重启本配置服务。

可用第二个参数设置新安装的端口：`sh install-proxy-config.sh http://服务器IP:9099 9198`。已有配置原样保留，改端口时需要相应修改 `listen`、`hosts`。UI 默认使用 DNS API 所在主机的 9098；自定义入口在 `ui/config.js` 设置 `proxyConfigBase: "http://服务器IP:9198"`。

### 监听地址与访问令牌

**能到达本服务端口并通过校验，就等于能改核心配置**，请按这个等级保护它。

- 服务默认只监听 `127.0.0.1`（回环）。此时局域网浏览器无法直达服务，需在本机浏览器使用，或按下方「HTTPS 与同源入口」用反向代理同源路径暴露。
- 要在局域网内直达，安装时用第三个参数显式指定监听地址：`sh install-proxy-config.sh http://服务器IP:9099 9098 服务器IP`。非回环监听必须配置访问令牌：首次安装时安装器会自动生成随机令牌写入服务配置（0600），并在安装结束时打印一次；在 LocalDNS 界面的代理配置面板填入该令牌后，界面请求会以 `Authorization: Bearer <令牌>` 发送。
- 配置中的 `token` 为空时服务沿用旧行为（仅 Host/Origin 白名单校验，启动日志会给出警告），仅适合回环监听；升级旧部署时请补上令牌：自行生成一段随机字符串写入配置 `token` 后重启服务，再在界面填入同一令牌。
- `origins` / `hosts` 白名单只防浏览器跨站请求，请求头可被非浏览器客户端任意伪造，不能替代令牌。

### 其他配置项

- `importAllowCIDRs`：HTTP 获取允许抓取的私网网段（见「HTTP 获取与保存目标」），例如 `"importAllowCIDRs": ["192.168.1.0/24"]`。默认空数组，即不允许抓取任何私网地址。
- 旧字段 `ruleBackupDirectory`、`trafficDirectory`、`metricsURL`、`interfaceFile` 是早期版本的遗留声明，本服务现已不读取，配置中出现会被忽略（对应的共享设置等功能由现版其他实现承担）。

## HTTPS 与同源入口

HTTPS 页面需要 HTTPS 配置服务入口。可让服务监听 `127.0.0.1:9098`，由已有反向代理暴露同源路径。示例：

```nginx
location /_config/ {
    proxy_pass http://127.0.0.1:9098/;
    proxy_set_header Host $host;
    proxy_read_timeout 110s;
}
```

UI 设置 `proxyConfigBase: "/_config"`；服务 `origins` 写浏览器实际来源，`hosts` 写转发保留的 Host。前缀会保留，UI 请求 `/_config/api/proxy-config/...`。配置了 `token` 时界面经同源路径同样发送令牌；`origins` / `hosts` 与允许目录限制是纵深防线，不是用户登录认证。

## HTTP 获取与保存目标

进入「系统管理 → 编辑配置」，选择核心及目标文件，再展开「HTTP 获取」，填写原始 YAML / JSON 配置链接。服务端下载，避免浏览器跨域和 HTTPS 页面直接读取 HTTP 的限制。保留原始文本；启用「保留目标核心的控制地址和密钥」时只保留目标的管理接口设置，导入结果在编辑器中可检查。

读取成功只生成草稿，不写服务器。点击「保存并应用」，核对差异后确认。目标为启动配置时自动重载；备用文件按钮明确为「保存文件」，不切换正在运行的配置。

仅接受 HTTP(S) 原始配置对象，最大 2 MiB、UTF-8。错误状态、网页、无效格式、超大内容和过多重定向会被拒绝。地址策略：回环地址恒允许；公网地址允许；链路本地地址（包括云元数据 169.254.169.254）、多播和未指定地址永远拒绝；私网地址默认拒绝，只有落入配置 `importAllowCIDRs` 的网段才放行。每次重定向重新检查。注意：该接口本质上是一个受策略约束的「内网 GET 代理」——能调用它的一方可以让服务代为读取允许范围内的 HTTP(S) 内容，放行网段请按最小范围配置。链接中的查询参数会保留以支持订阅令牌；配置正文和链接不写浏览器持久存储，服务日志不输出正文和下载 URL。

## 核心应用方式

- Mihomo：先运行 `mihomo -t -d ... -f ...`，写入后调用本机认证的 `PUT /configs?force=true`，不调用 `/restart`。若配置位于 Mihomo 工作目录之外，需将目录加入核心的 `SAFE_PATHS`；配置服务不会绕过核心路径限制。管理监听和密钥不通过普通重载变更；此类修改在写入前拒绝。带自定义透明代理规则时可设置 `postReload` 固定命令钩子。
- sing-box：先运行 `sing-box check`，对经核验的 PID 发送 SIGHUP。整份重载会关闭并重建运行实例，已有连接可能断开。当前通过本机 Clash API 检查核心在线，界面如实显示「已发送重载且核心在线」，不把信号发送或 HTTP 204 视为完整应用证明。没有可验证的控制通道时拒绝保存启动配置。
- sing-box `-c` / `-C`：从匹配的运行进程识别输入，或在配置中指定 `configFiles` / `configDirectories`。最多 128 份、总计 8 MiB（合并结果同样以 8 MiB 为上限；单份文件仍以 2 MiB 为限），按完整输入集合隔离合并与校验；保存时检查集合是否被改动。

本功能恢复的是完整配置编辑器。sing-box 本地 rule-set 的独立自动热更新由核心负责，本版不会把任意分片或主配置误当成 rule-set 文件。

## 保存与失败恢复

校验 SHA-256 版本 → 同目录暂存 → 原生核心检查 → 重载预检查 → 备份 → 再核对版本 → 保留权限并原子替换 → 重载。重载失败时恢复原文件，并尝试重新加载原配置；恢复未确认时返回明确错误和备份路径。每文件保留最新十份备份。修改草稿保留在页面，关闭后不持久化。

本服务仅恢复配置管理；静态共享设置、DNS 名单工作台与浏览器趋势继续使用现版实现。

## 开发与验证

使用 Go 1.27+：`go test ./...`。Linux 运行全部原有路径、权限、分片测试；Windows 可运行 HTTP 导入、保存事务与 Mihomo 重载接口夹具测试。真实 sing-box 验证在 Linux 设置 `LOCALDNS_SINGBOX_TEST_BINARY` 后运行 `go test -run Native -v`，仅使用临时配置，不操作现有核心。

前端：`npm ci --prefix frontend`，`npm run --prefix frontend build`，`npm run --prefix frontend check`，`node tools/verify_proxy_config.cjs`。编辑器使用现版 ESM 与按需加载；没有旧 window.LocalDNS 全局服务或外部 CDN。
