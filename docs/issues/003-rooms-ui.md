# ISSUE-003: Rooms 侧栏、房间视图与成员面板

**状态：** implemented (盲审通过)
**优先级：** P0
**依赖：** 002

## 目标

把 rooms 做成可用的协作空间入口：侧栏房间列表、创建/重命名/删除/置顶、房间页、成员增删、消息流、@mention、停止/清空。

## 范围

- 新增 `src/renderer/src/rooms/RoomSidebarList.tsx`、`RoomView.tsx`、`RoomAvatarCluster.tsx`、`RoomInspectorPanel.tsx`（先不含 SlackPanel）。
- 移植/补齐 UI 组件：`ArkGlyphs.tsx`、`Controls.tsx`、`SegmentedControl.tsx`、`Select.tsx`（只取 rooms 所需，不整包替换设置页）。