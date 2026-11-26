# ISSUE-002: Rooms 调度、消息路由与成员队列

**状态：** implemented (盲审通过)
**优先级：** P0
**依赖：** 001

## 目标

让一个房间能选成员、发消息、按 `@mention` 或 `[HANDOFF]` 触发成员，逐个执行，产出 `[FINAL]`；失败可停止/重试。此 issue 先不接完整 UI，使用 store 单测和最小控制台/测试驱动验证。

## 范围

- 新增/完成 `src/renderer/src/rooms/roomStore.ts`：`useRooms`、`addRoom`、`submitBrief`、`stopRoom`、`addMemberToRoom`、`removeMember`、`moveMemberToRoom`。
- 适配本地 `useBotStore`：普通发送路径继续走 store；房间成员需要按成员 `sessionId`/`agentId` 发送，使用 adapter 层并封装为本地 `roomMemberCancel.ts` 的 `cancelRoomMemberTurn`，不复制上游 `cancelPlatformTurn` 名称。