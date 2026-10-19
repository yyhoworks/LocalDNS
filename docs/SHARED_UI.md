# 无常驻服务的名称、Logo 与字体共享

UI 2026.10.19.7（含本机 .6）开始，名称、Logo、代理面板地址和字体可通过普通静态文件共享。DNS 核心继续提供页面与 API，不需要运行 9098 配置管理服务。

## 网页调整与共享

1. 在「外观 → 品牌与字体」调整名称、LocalDNS Logo 和字体。网页修改先保存到当前浏览器，供预览。
2. 点击「导出共享配置」，下载 `localdns-ui-settings.zip`。配置包包含名称、Logo、面板地址、字体文件及标题 / 数字 / 正文的字体选择。
3. 将配置包和 UI 升级包附带的 `configure-ui.py` 放到服务器。在有 Python 3.8+ 的环境运行：

   ```sh
   python3 configure-ui.py --dir /opt/localdns --import localdns-ui-settings.zip
   ```

4. 其他设备刷新页面即可读取共享默认值。之前有本机覆盖设置的设备，在相同面板点击「跟随服务器」。该按钮清除本机的名称、代理入口和字体选择覆盖，不删除本机字体文件。

静态网页没有服务器写入接口，因此「应用到本机」不会直接写回服务器。导入脚本在服务器写文件，不增加常驻进程，不重启 DNS；旧共享目录备份到安装根目录的 `custom-backup-*`。

## 也可直接在服务器配置

```sh
python3 configure-ui.py --name '家里的 DNS' --logo-file /tmp/logo.png
python3 configure-ui.py --proxy-name '代理面板' --proxy-url http://192.168.1.20:9090/ui/
python3 configure-ui.py --font heading=/tmp/title.woff2 --font body=/tmp/body.ttf
```

`--dir` 默认 `/opt/localdns`。LocalDNS Logo 支持 PNG、JPEG、WebP、GIF；网页选择 SVG 时会先转为 PNG。也可用 `--logo-url https://example.com/logo.png` 保存外部地址。字体支持 TTF / OTF / WOFF / WOFF2，单个最大 64 MiB，总量最大 128 MiB。同一字体通过命令分配多个用途时按内容去重。

导入过程核对路径、字体文件标识和容量，拒绝目录穿越、符号链接条目、重复 ZIP 条目及清单外文件。准备好完整新目录后替换共享目录，替换失败恢复旧目录。配置清单及资源为页面可读取的静态文件，不应放入密码或其他私密内容。

## 文件结构与升级保留

```text
/opt/localdns/ui/custom/
  settings.json       名称、LocalDNS Logo 路径、面板地址、字体选择与清单
  assets/             LocalDNS Logo 文件
  fonts/              自定义字体文件
```

页面每次加载重新读取 `settings.json`；字体按当前选择加载，未使用的共享字体不随首页下载。浏览器缓存字体资源；网络失败时保留所选项目并使用默认字体显示页面。已有浏览器字体库保留，仍可通过导出包迁移到服务器。

新版 `install-ui.sh` 和一键安装器更新 UI 时保留 `ui/custom/` 与 `ui/config.js`。直接删除整个 `ui` 后重新拉取会丢失该目录，部署时应使用保留配置的升级脚本。共享目录不包含在面向其他用户的默认配置中。

## 代理面板图标

代理入口根据已保存的面板地址直接加载网站图标，支持 `/ui/` 子路径和 `#/` 路由。优先尝试面板目录的深 / 浅色 SVG favicon，再尝试 Apple Touch 图标、ICO 和站点根目录 favicon。图片请求不携带原面板地址中的查询参数、片段或 Referrer。失败显示默认入口图标。

代理 Logo 不再提供独立上传或图片地址输入。浏览器无需跨域读取页面 HTML；图标由图片元素直接读取。跨域图标仍受浏览器的 HTTPS 混合内容限制；面板只有非标准图标路径且没有标准 favicon 时会使用默认图标。

## 旧版迁移

旧服务尚未删除时，可先迁移名称、LocalDNS Logo 和面板地址：

```sh
python3 configure-ui.py --import-interface /opt/localdns-proxy-config/data/interface.json
```

旧的代理自定义 Logo 不迁移，入口改为读取面板图标。确认新共享配置可读取后，再删除旧服务程序、启动项与数据。当前版本不再提供配置服务及编辑器，不再访问 9098。

名单通过 DNS 核心 API 保存，保存前重新核对已读取内容；DNS API 没有原子比较写入接口，仍需避免多个设备同时修改同一名单。需要回退时可先下载原名单。吞吐图为当前浏览器会话内的真实采样，最多 2 小时，关闭页面不再采样。
