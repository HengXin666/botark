# ISSUE-009: v0.12 共享对话页 UI 件

**状态：** implemented (待盲审)  
**优先级：** P2  
**依赖：** —

# ISSUE-009: v0.12 共享对话页 UI 件

**状态：** pending  
**优先级：** P2  
**依赖：** 无

## 目标

增加“共享对话页面”：把当前对话导出为独立 HTML/Markdown，可复制/保存；不改变聊天发送逻辑。

## 范围

- 新增 `ShareConversationDialog.tsx`、`shareConversation.test.ts`、`ArkGlyphs.tsx`、`SegmentedControl.tsx`（只取必要 UI）。
- 在 `ChatHeader` 增加按钮；在 `ChatArea` 挂载对话框。
