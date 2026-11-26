# ISSUE-001: Rooms 数据模型与持久化

**状态：** implemented (盲审通过)
**优先级：** P0
**依赖：** —

## 目标

建立协作空间的最小数据契约：房间、成员、消息、@mention、[FINAL]、[HANDOFF] 与本地持久化。此 issue 只做模型与存储，不接 UI/调度，避免一次性改动过大。

## 范围

- 新增 `src/renderer/src/rooms/model.ts`：从上游 `rooms/model.ts` 移植并在本地类型上落地。
- 新增 `src/renderer/src/rooms/roomExport.ts`：房间导出。