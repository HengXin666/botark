# ISSUE-012: 集成测试与独立盲审

**状态：** pending  
**优先级：** P0  
**依赖：** 全部

# ISSUE-012: 集成测试与独立盲审

**状态：** pending  
**优先级：** P0  
**依赖：** 全部功能 issue

## 目标

在全部功能分支合并到 `feat/collaboration-space` 后，做全量测试、手工 smoke、独立盲审；通过后才允许合回 `main`。

## 测试清单

- [ ] `npm run typecheck` 通过。
- [ ] `npm test` 全量通过（记录文件/用例数）。
- [ ] Rooms：创建房间、成员增删、@mention、[FINAL]、[HANDOFF]、管理员派发、停止/重启。
- [ ] Workspace：文件读/写/搜索、越界拒绝、MCP server、审批 allow/deny。
- [ ] Hark：主对话/项目发送、回复、状态、完成通知、浏览器预览、Portal（如已做）。
- [ ] 代理：测速、407、批量、单账号、池清理。
- [ ] v0.12：WebView 多账号切换、共享对话页。
- [ ] Android/mobile 至少不白屏（如涉及）。
- [ ] 数据：现有 localStorage、Hark 项目、代理池、额度历史不丢。

## 独立盲审

- [ ] 开一个**不继承实现上下文**的 reviewer subagent，只给 diff、issue 验收和测试结果，不给作者解释。
- [ ] reviewer 必须检查：Hark 路由/项目状态、代理绑定、路径安全、rooms 队列、测试是否真的覆盖。
- [ ] 对 reviewer 提出的阻断问题逐条修复并复测。
- [ ] 输出盲审报告（结论、问题、证据、残余风险）。

## 合并

- [ ] 只有 012 通过后，才把 `feat/collaboration-space` 合入 `main`。
- [ ] 保留 `pre-upstream-sync-20261126` tag 作为回滚点。

---
_本 issue 文件由本次协作空间改造维护；完成时在文件底部追加“变更文件 / 测试命令 / 结果”。_
