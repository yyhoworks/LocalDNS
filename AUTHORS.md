# 作者与分工

LocalDNS 由以下作者共同完成：

| 作者 | 身份／来源 | 负责内容 |
|---|---|---|
| **R 大** | **折腾日记交流群** | **DNS 核心，主要使用 Rust 编写** |
| **[yyhoworks](https://github.com/yyhoworks)** | 本仓库维护者 | **UI 设计** |
| **[clone-fan](https://github.com/clone-fan)** | 社区贡献者；[PR #1](https://github.com/yyhoworks/LocalDNS/pull/1) 作者 | **UI 视觉与交互增强、字体上传、指标数字与单位动画修复** |

## 社区贡献

- **[clone-fan](https://github.com/clone-fan)**：通过 [PR #1](https://github.com/yyhoworks/LocalDNS/pull/1) 提供玻璃视觉细化、弹窗与日志交互、拓扑路径流光、圆角和版本标签设置、浏览器本地字体上传，以及指标数字与单位的动画修复。贡献收录于正式版 UI 2026.10.16.3，并保留原始 Git 提交历史。整合版采用 UI 2026.10.16.1 的 DNS 解析路径布局，保留原有分项字体偏好。

DNS 核心以 R 大的 Rust 实现为基础。Web 界面负责运行信息展示、配置交互和视觉设计。

第三方库、字体及其作者的版权和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与相应许可文件。

