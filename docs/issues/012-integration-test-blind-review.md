# ISSUE-012: 集成测试与独立盲审

**状态：** done (代码/测试/盲审通过；真实 Hark/代理/UI smoke 待补)
**优先级：** P0
**依赖：** 全部

## 目标

在全部功能分支合并到 `feat/collaboration-space` 后，做全量测试、手工 smoke、独立盲审；通过后才允许合回 `main`。

## 测试清单

- [x] `npm run typecheck` 通过。
- [x] `npm test` 全量通过：57 个测试文件 / 343 个用例。
- [ ] Rooms：创建房间、成员增删、@mention、[FINAL]、[HANDOFF]、管理员派发、停止/重启。
- [ ] Workspace：文件读/写/搜索、越界拒绝、MCP server、审批 allow/deny。
- [ ] Hark：主对话/项目发送、回复、状态、完成通知、浏览器预览、Portal（如已做）。
- [ ] 代理：测速、407、批量、单账号、池清理。
- [ ] v0.12：WebView 多账号切换、共享对话页。
- [ ] Android/mobile 至少不白屏（如涉及）。
- [ ] 数据：现有 localStorage、Hark 项目、代理池、额度历史不丢。

## 独立盲审

- [x] 开一个**不继承实现上下文**的 reviewer subagent，只给 diff、issue 验收和测试结果，不给作者解释。
- [x] reviewer 必须检查：Hark 路由/项目状态、代理绑定、路径安全、rooms 队列、测试是否真的覆盖。
- [x] 对 reviewer 提出的阻断问题逐条修复并复测（4 项阻断已修复）。
- [x] 输出盲审报告（结论、问题、证据、残余风险）。

## 合并

- [ ] 只有 012 通过后，才把 `feat/collaboration-space` 合入 `main`。
- [ ] 保留 `pre-upstream-sync-20261126` tag 作为回滚点。

## 执行记录

- 变更范围：本分支三个提交 `c9c9a13`（功能）+ `12059ff`（盲审修复）+ `605fb5c`（文档/命名收尾）。
- `npm run typecheck`：PASS（node + web）。
- `npm test`：PASS，57 文件 / 343 用例。
- `npm run build`：PASS（electron-vite main/preload/renderer）。
- 盲审：第一轮发现 4 个阻断（管理员 UI、WebView LRU attach、敏感路径 symlink、门户 dispose 生命周期），修复后第二轮独立盲审 **通过**。
- 未闭环：真实 Hark 账号、真实代理、真实 Electron UI smoke（本机已有运行中的 BotArk 单实例，未强启第二实例）。