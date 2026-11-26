# ISSUE-007: 代理可用性与延迟测速

**状态：** implemented (待盲审)  
**优先级：** P1  
**依赖：** —

# ISSUE-007: 代理可用性与延迟测速

**状态：** pending  
**优先级：** P1  
**依赖：** 无

## 目标

在本地现有代理池/单账号代理上增加“可用性 + 延迟 + 出口地区”测试；不替换本地分配逻辑。

## 范围

- 新增 `src/main/proxyHealthCheck.ts` + 测试（移植 `bfcad79` 的纯探测层，接本地 `proxyTransport`）。
- `src/main/muse/accountProxy.ts` 新增 `testAccountProxy` / `testProxyPoolItems`，保留 `planSinglePoolSwap`/`assignOneUnusedProxy` 原逻辑。
