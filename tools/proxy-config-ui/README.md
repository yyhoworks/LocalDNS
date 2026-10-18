# 配置编辑器前端依赖

`editor.js` 提供 CodeMirror 与 YAML / JSON 语法检查，`entry.js` 是浏览器 bundle 入口。

```sh
npm ci --prefix tools/proxy-config-ui
node tools/build_proxy_config_ui.cjs
```

使用 package-lock.json 锁定的依赖。输出到 `_src/ui/assets/js/proxy-config-editor.vendor.js`，按路由加载；许可汇总输出到 `_src/ui/assets/licenses/proxy-config-editor.txt`。运行时不访问 CDN。

业务交互位于 `_src/ui/assets/js/proxy-config.js`，进入页面自动读取本机配置，不包含账号密码、SSH 登录或会话流程。配置正文不写入 localStorage / sessionStorage；仅记住文件路径与核心类型。
