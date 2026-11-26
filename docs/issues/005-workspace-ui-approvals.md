# ISSUE-005: Workspace 工具面板与审批

**状态：** implemented (盲审通过)
**优先级：** P1
**依赖：** 003,004

## 目标

让房间成员可以使用工作区：UI 提供文件/文件夹选择、外部 MCP server 配置、工具调用结果、写入审批；与 roomStore 的 `[TOOL]` 请求打通。

## 范围

- 新增 `src/renderer/src/rooms/WorkspaceTools.tsx`（从上游适配，先不含 Hark Portal 公网隧道）。
- 接入 `roomStore` 的 tool request 流程。