# BotArk 协作空间与上游能力 Issue 清单

> 本目录是本次改造的 issue 源文件。仓库的 GitHub Issues 目前处于关闭状态，所以先用本地 issue 文件驱动；每个 issue 都有范围、依赖、验收、测试和盲审要求。

## 目标

- 支持协作空间（rooms）+ Workspace MCP 基础能力。
- 只移植本次确认的上游功能：v0.12 精选 UI/性能、代理测速、Hark 浏览器预览、Hark Workspace Portal。
- 其他平台/智能体不动；管理员派发依赖 rooms，按 issue 单列。
- 每个 issue 完成后必须通过对应测试；全部完成后做独立盲审。

## 顺序

| Issue | 主题 | 依赖 | 优先级 |
|---|---|---|---|
| [001](./001-rooms-foundation.md) | Rooms 数据模型与持久化 | — | P0 |
| [002](./002-rooms-orchestration.md) | Rooms 调度、消息路由、成员队列 | 001 | P0 |
| [003](./003-rooms-ui.md) | Rooms 侧栏、房间视图、成员/设置面板 | 002 | P0 |
| [004](./004-workspace-mcp-core.md) | Workspace MCP 核心（文件工具 + MCP hub） | — | P1 |
| [005](./005-workspace-ui-approvals.md) | Workspace 工具面板与审批/权限 | 003,004 | P1 |
| [006](./006-hark-browser-preview.md) | Hark 浏览器预览（安全旁路） | — | P0 |
| [007](./007-proxy-health.md) | 代理可用性/延迟测速 | — | P1 |
| [008](./008-v012-webview-lru.md) | v0.12 WebContentsView LRU 性能件 | — | P1 |
| [009](./009-v012-share-dialog.md) | v0.12 共享对话页 UI 件 | — | P2 |
| [010](./010-admin-dispatch.md) | Rooms 管理员派发 | 002,003 | P1（rooms 后） |
| [011](./011-hark-workspace-portal.md) | Hark Workspace Portal | 004,006 | P1（安全评审后） |
| [012](./012-integration-test-blind-review.md) | 集成测试 + 独立盲审 + 合并 | 全部 | P0 |

## 完成定义（DoD）

每个 issue 完成时要满足：

- [ ] 代码已实现并通过 `npm run typecheck`
- [ ] 对应单元/集成测试通过
- [ ] 相关手工 smoke（Hark/代理/rooms）通过
- [ ] 不破坏本地既有 Hark 消息路由、项目状态机、代理绑定
- [ ] 在 issue 文件底部记录变更文件、测试命令、结果
- [ ] 最后进入 012 的独立盲审
