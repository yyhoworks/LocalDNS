# UI 2026.10.31.6 / PR #24 验证

## 改动

合入 PR #24（`6b23d81054959b4c03e25005c0b40fca2f79d417`）：升级确认期间占位防连点；升级任务参数合并后一次原子保存。内核继续使用 FJHAI。

## 本地检查

- `npm run --prefix frontend check`：构建、严格类型检查、24 个测试文件共 208 项测试、lint、干净重建文件对照与字体子集检查通过。
- `python tools/test_online_updater.py`：13 项通过。
- `python tools/test_core_upload.py`：5 项通过。
- `python tools/test_package_ui.py`：15 项通过。
- `node tools/verify_core_upload.cjs`：1440 / 390 像素、dark / light-glass 四种组合，共 12 组夹具验收通过，无页面异常或横向溢出。
- Node 26 下测试使用 `NODE_OPTIONS=--no-experimental-webstorage`，沿用上一版的 jsdom 环境设置。

## 生产验收

在现有 Alpine/OpenRC、amd64-v3 生产环境完成 UI 与独立升级服务更新。先生成完整运行目录及升级服务备份，下载到本机并核对 SHA-256 后执行部署。

- 统一升级任务成功结束，实际 UI 为 `2026.10.31.6`，内核为 `FJHAI`。
- DNS 进程 PID 和启动时间、内核 SHA-256、用户配置指纹与升级服务配置摘要均保持一致。
- 服务器回环和局域网 UDP / TCP DNS 均通过；上游、客户端别名、功能开关和缓存配置与现有文件一致。
- 26 个非站点定制 UI 文件经实际 HTTP 读取并逐文件校验 SHA-256。
- 1440 / 390 像素、dark / light-glass 四种组合，实际页面确认取消、Esc、再次操作均通过；无页面异常、横向溢出或业务写请求。
- 独立升级服务重启后状态正常，新版 `online_updater.py` 的文件摘要与发布源码一致，其余服务模块保持原样。

生产网页点检屏蔽全部非读取请求，没有提交内核上传、整套升级或回滚任务。真实内核切换流程沿用上一版的独立实例验证记录，详见 [内核 ZIP 上传验证](core-upload-2026.10.31.md)。
