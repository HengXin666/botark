# ISSUE-011: Hark Workspace Portal

**状态：** implemented (待盲审)  
**优先级：** P1  
**依赖：** 004,006

# ISSUE-011: Hark Workspace Portal

**状态：** pending  
**优先级：** P1（安全评审后）  
**依赖：** ISSUE-004（Portal 服务端）；如需在房间内自动注入 URL，再依赖 ISSUE-002

## 目标

为 Hark 提供“本机工作区门户”，让 Hark 通过自己的浏览器/网页工具读取工作区文件；默认只本机，公网隧道需显式确认。

## 范围

- 从上游 `6039e1a` 移植 `workspacePortal.ts`、`workspaceFiles.ts`、`shared/workspacePortal.ts`。
- 用最小 `portalWorkspaceRegistry` 替代上游 `hub.resolveWorkspaceRootFor`；不引入 MCP SDK（除非 004 已引入）。
