# ISSUE-006: Hark 浏览器预览（安全旁路）

**状态：** implemented (待盲审)  
**优先级：** P0  
**依赖：** —

# ISSUE-006: Hark 浏览器预览（安全旁路）

**状态：** pending  
**优先级：** P0  
**依赖：** 无（Hark 现有代码不动）

## 目标

在 Hark 当前对话/项目上方显示远程浏览器截图卡片，支持打开/刷新/空态/错误；不改变 Hark 消息发送、回复轮询、项目状态。

## 范围

- 新增 `src/shared/harkBrowserPreview.ts` + `harkBrowserPreview.test.ts`（移植 `currentHarkBrowser`、`harkScreenshotReference`）。
- 新增 `src/renderer/src/components/hark/HarkBrowserCard.tsx`、`HarkScreenshot.tsx`（从上游移植；去掉不存在的 `projectHistory` 订阅也可，保留刷新按钮）。
