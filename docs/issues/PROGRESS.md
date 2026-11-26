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
- `npm test`：**57 文件 / 343 用例通过**（盲审修复后全量）。
- `npm run build`：通过（electron-vite main/preload/renderer）。
- Hark room 保护：允许 Hark 账号 busy 状态进入房间轮次；Hark `sendMessage` 已接受但暂无文字时返回“仍在执行”通知，不把长任务误判为失败。
- 真实 Electron UI smoke：当前机器有用户正在运行的 BotArk 单实例，无法安全启动第二实例；未做真实 Hark 登录/真实代理的端到端 smoke。
- 独立盲审：首轮发现 4 个阻断项（管理员 UI、WebView LRU attach、敏感路径 symlink、门户 dispose 生命周期），已在 12059ff 修复并补测试；第二位独立盲审员复审 **通过**（57 文件 / 343 用例、typecheck/build 均通过）。

## 待办/风险

- 无已知代码阻断；Hark 真实账号的房间/Portal smoke、真实代理测速 smoke 待补。
- 打包时 cloudflared 二进制分发需在 electron-builder 中补 `extraResources`（当前开发机有 /usr/bin/cloudflared）。
- Hark coordinator 已在 UI、setRoomAdministrator 与 reconcile 三层禁止，避免多 Agent 框架冲突。
