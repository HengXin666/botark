# Slack 协作房间参考（只学习，不接入）

> 目的：把 Slack 的“聊天室”模型作为 BotArk 协作空间的产品参考。本次不引入 Slack SDK、不做 OAuth、不向 Slack 发送任何数据。

## Slack 中值得借鉴的模型

- **Channel（频道）**：长期存在的协作容器，有名称、主题、成员列表和可见范围（公开/私有）。
- **Message（消息）**：频道内的基本单位，带作者、时间、文本和附件；支持编辑/删除/表情回应。
- **Thread（线程）**：对某条消息的回复聚合，避免主频道被细节淹没。
- **Mention（提及）**：`@user` 精确唤醒成员；`@channel`/`@here` 是广播，需要权限约束。
- **Bot / App（机器人/应用）**：以成员身份加入频道，通过事件订阅接收消息，通过 Web API 回复；权限按 scope 授予。
- **Workflow / Slash command（工作流/斜杠命令）**：把结构化操作（建任务、查数据、发审批）从自然语言中分离出来。
- **Canvas / Files（画布/文件）**：频道共享的持久资料，不等同于聊天记录。

## 映射到 BotArk 协作空间

| Slack | BotArk Rooms | 说明 |
|---|---|---|
| Channel | `CollabRoom` | `title`、`members`、`messages`、`mode`、`limit` |
| Message | `RoomMessage` | 有 `author`、`text`、`references`、`notice` |
| Thread | 暂不做独立线程 | 用 `replyQuote`/引用与 @mention 控制上下文；后续可加 `threadId` |
| Mention | `@成员名` | `splitMentionSegments` / `mentions` / `normalizeMentionName` |
| Bot/App | `RoomMember` | 绑定 `botId`/`accountId`/`platform`，有 `agentId`/`sessionId`/`cursor` |
| Workflow | `[TOOL]` JSON 请求 | 人在回路审批后由 Workspace MCP 执行；不自动执行 |
| Canvas | Workspace 目录 + Workspace MCP | 文件工具、搜索、读写审批；不作为聊天记录存储 |
| Permission | 房间成员 + 本机人工审批 | 没有云端 OAuth scope；敏感路径由 `workspacePaths` 拦截 |

## 不做的部分（本次范围）

- 不接 Slack API、不建 Slack App、不导入/导出 Slack 消息。
- 不把 Slack token 写入配置或环境变量。
- 不实现 Slack 的公开频道发现、企业目录、审计日志。
- 不把 Slack 的“频道”自动同步为 BotArk 房间；房间由用户显式创建。

## 对实现的约束

1. 房间是本地优先的：数据在 renderer store + 本地持久化，不依赖 Slack 可用性。
2. @mention 必须精确匹配成员名；未匹配时不得广播给所有成员。
3. 每个成员有独立 `sessionId`/`cursor`；房间轮次使用 `room-turn-*` 合成会话，不能污染私聊。
4. Workspace 写操作必须人工审批；Hark 等不原生支持 MCP 的成员通过临时门户只读/受控访问。
5. 管理员（coordinator）由用户显式指定；管理员调度是房间内提示，不是系统级权限提升。
