# ISSUE-010: Rooms 管理员派发

**状态：** implemented (待盲审)  
**优先级：** P1  
**依赖：** 002,003

# ISSUE-010: Rooms 管理员派发

**状态：** pending  
**优先级：** P1（rooms 后）  
**依赖：** ISSUE-002、ISSUE-003

## 目标

支持一个房间设置管理员 Agent（coordinator）：用户把任务发给管理员，管理员向成员派发，成员向管理员汇报，管理员产出 final。

## 范围

- 适配上游 `b686fdd` 的 `coordinatorId` / 成员队列 / stale group turn 逻辑到本地 `roomStore.ts`。
- `RoomInspectorPanel` 增加管理员设置；`RoomView` 显示汇报关系。
