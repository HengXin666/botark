# 协作空间改造进展

- 分支：`feat/collaboration-space`
- 基线：`bd814e5`（v0.12.0 fork）
- 上游参考：`qybaihe/botark` v0.16.0（只读评估，未合并上游 main）

## 已实现范围

- Rooms：model/toolRequests/roomStore/room UI/sidebar/App 路由；包括 `[FINAL]`、`[HANDOFF]`、@mention、管理员 coordinator、停止、持久化。
- Workspace MCP：`src/shared/workspace.ts`、`src/main/mcp/{workspaceFiles,workspacePaths,configParser,mcpStore,hub}.ts`、IPC/preload。
- Workspace UI：`WorkspaceTools.tsx`，房间 composer + inspector 入口；文件/MCP/审批链路。
- Hark 浏览器预览：`shared/harkBrowserPreview.ts`、`HarkBrowserCard.tsx`、`HarkScreenshot.tsx`、Hark `browserPreview` RPC。
- Hark Workspace Portal：`src/main/mcp/workspacePortal.ts`、`shared/workspacePortal.ts`、IPC/preload；127.0.0.1 + 随机 token + 敏感路径 + 写审批 + 退出清理。
- 代理测速：`src/main/proxyHealthCheck.ts`、`accountProxy.testAccountProxy/testProxyPoolItems`、Muse IPC、`ProxySection` 延迟测试按钮。
- v0.12 性能/UI：WebContentsView detached LRU（90s、最多 1 个 warm）、共享对话页面/HTML/Markdown 导出。

## 验证状态

- `npm run typecheck`：通过。
- `npm test`：**56 文件 / 339 用例通过**（最后一次全量，23:58）。
- `npm run build`：通过（electron-vite main/preload/renderer）。
- Hark room 保护：允许 Hark 账号 busy 状态进入房间轮次；Hark `sendMessage` 已接受但暂无文字时返回“仍在执行”通知，不把长任务误判为失败。
- 真实 Electron UI smoke：当前机器有用户正在运行的 BotArk 单实例，无法安全启动第二实例；未做真实 Hark 登录/真实代理的端到端 smoke。
- 独立盲审：进行中（blind-reviewer）。

## 待办/风险

- 盲审阻断问题修复。
- Hark 真实账号的房间/portal smoke、真实代理测速 smoke。
- 打包时 cloudflared 二进制分发需在 electron-builder 中补 `extraResources`（当前开发机有 /usr/bin/cloudflared）。
- 管理员派发对 Hark 作为 coordinator 的行为仍需真实账号确认（模型会对多 Agent 框架有限制）。
