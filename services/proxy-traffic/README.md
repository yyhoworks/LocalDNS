# LocalDNS 代理用量采集

Python 3 标准库服务，使用 Mihomo / sing-box Clash API 的连接快照，按连接增量估算走代理的上传、下载、每日与分时用量，并按设备、订阅和节点分类。不使用订阅地址，不发布控制密钥。

## 安装或升级

在服务所在 Linux 设备解压发行包，运行：

```sh
sh proxy-traffic/install.sh
```

安装器支持 OpenRC / systemd，备份旧程序及状态并保留已有记录。默认读取 `/etc/mihomo/config.yaml`；sing-box 可使用 `--source sing-box --mihomo-config /etc/sing-box/config.json`。JSONC 配置请通过本机控制地址与服务启动配置提供参数；配置读取器仅支持标准 JSON。参数不应包含订阅链接。

默认状态为 `/var/lib/localdns-traffic/state.json`；摘要为 `/opt/localdns/ui/custom/traffic.json`，详情为同目录的 `traffic-detail.json`。UI 升级保留 `custom/`。安装本服务不重启 DNS 或代理核心。

## 统计口径

- 仅计入代理连接；DIRECT / REJECT / REJECT-DROP / PASS / COMPATIBLE 排除。
- 首次安装先建立当前连接基线，避免将启动前字节倒算为当天；从旧版升级保留原有累计和连接基线。
- 每 5 秒采样，默认每 30 秒保存；正常日志限为每 5 分钟一次。正常停止前保存尚未发布的数据，异常断电可能丢失最后一段未保存记录。
- 每日合计保留 400 天，设备/订阅/节点分类保留 90 天，分时记录保留 7 天；长期累计独立维护，不随保留窗口缩小。
- 旧版未分类/未分时的用量保留在合计，界面标明“历史未分类”，不猜测归属或补造历史。
- 设备名复用 LocalDNS 的 `client_aliases.json`；没有明确映射时显示 IP，不按 IPv6 网段合并设备。
- 单日每维度最多 2048 个键，溢出保留在“其他”；界面取前 20 名时再次将余项合并，不删除累计依据。
- 缺失日期留空；首日、采集中断和覆盖未知都有独立说明。卡片不将旧日期文件显示成今日数据。

这是采样估算，不用于精确计费：快照之间建立并关闭的短连接，以及最后一张快照到连接关闭之间的尾部字节可能漏计。WebSocket 连接快照同样存在此边界。代理服务的进程累计、套餐计费和本服务的自然日代理用量具有不同时间范围和统计口径，不能保证最终相等。

## 验证与回滚

```sh
python3 services/proxy-traffic/test_collector.py
```

回滚应先停止 `localdns-traffic`，一起恢复安装时备份的程序和 `state.json`，再启动服务。不要同时运行两个进程写同一个状态文件；新版使用进程锁防止重复采集。状态损坏时拒绝静默清零，应先备份并检查。
