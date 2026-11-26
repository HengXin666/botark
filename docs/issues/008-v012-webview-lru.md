# ISSUE-008: v0.12 WebContentsView LRU 性能件

**状态：** done (盲审通过)
**优先级：** P1
**依赖：** —

## 目标

减少切换多个账号/会话后残留的 Chromium renderer 内存；保留本地现有 partition/proxy 行为。

## 范围

- 将 `src/main/webContentsViewManager.ts` 与 `src/main/webViewIpc.ts` 按上游 `0644b8c` 版本移植（v0.12 版，不带后续 Google OAuth guard）。
- 补 `src/shared/ipc.ts` / `src/preload/index.ts` 中与 WebView 相关的最小类型。