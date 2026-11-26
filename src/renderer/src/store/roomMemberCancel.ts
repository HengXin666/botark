import type { Bot } from '@/types'

/**
 * Cancel a room member turn using the bot snapshot supplied by the caller.
 * Rooms keep per-member session ids that differ from the bot's active session,
 * so this must not go through a botId-only store helper.
 */
export async function cancelRoomMemberTurn(bot: Bot): Promise<void> {
  const bridge = typeof window === 'undefined' ? undefined : window.electron
  if (bot.platformId === 'meta-muse' && bridge?.muse?.cancelChat) {
    await bridge.muse.cancelChat(bot.activeAccountId, bot.activeSessionId)
  } else if (bot.platformId === 'grok' && bot.selectedAgentId && bridge?.grok?.rpc) {
    await bridge.grok
      .rpc({
        accountId: bot.activeAccountId,
        op: 'call',
        method: 'InterruptGrokBotAgentRun',
        params: {
          agent_id: bot.selectedAgentId,
          reason: 'user_interrupt',
          ...(bot.activeSessionId ? { session_id: bot.activeSessionId } : {})
        }
      })
      .catch(() => undefined)
  } else if (bot.platformId === 'hark' && bridge?.hark?.rpc) {
    await Promise.all([
      bridge.hark
        .rpc({
          accountId: bot.activeAccountId,
          op: 'call',
          method: 'POST',
          path: '/messages/pause-agent',
          body: bot.activeSessionId ? { conversationId: bot.activeSessionId } : {}
        })
        .catch(() => undefined),
      bridge.hark
        .rpc({
          accountId: bot.activeAccountId,
          op: 'call',
          method: 'POST',
          path: '/messages/stop-tool',
          body: bot.activeSessionId ? { conversationId: bot.activeSessionId } : {}
        })
        .catch(() => undefined)
    ])
  } else if (bot.platformId === 'dot' && bridge?.dot?.rpc) {
    await bridge.dot
      .rpc({ accountId: bot.activeAccountId, op: 'cancelTurn' })
      .catch(() => undefined)
  } else if (bot.platformId === 'hermes' && bridge?.hermes?.rpc) {
    const res = await bridge.hermes.rpc({ accountId: bot.activeAccountId, op: 'stopRun' })
    if (res && res.ok === false) throw new Error(res.message || '未能确认停止 Hermes 运行')
  } else if (bot.platformId === 'antigravity' && bridge?.antigravity?.cancelRun) {
    await bridge.antigravity.cancelRun(bot.activeAccountId).catch(() => undefined)
  }
}
