# ISSUE-004: Workspace MCP 核心

**状态：** implemented (盲审通过)
**优先级：** P1
**依赖：** —

## 目标

提供“协作空间共享工作区”的最小执行底座：文件 list/read/search/write/patch、路径边界、外部 MCP server hub、审批回调。先做 main 进程与 shared 类型，不接 UI。

## 范围

- 新增 `src/shared/workspace.ts`（从上游移植）。
- 新增 `src/main/mcp/workspaceFiles.ts`、`hub.ts`、`configParser.ts`、`mcpStore.ts`（按需裁剪；不接 rooms）。