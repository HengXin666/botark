import { describe, expect, it } from 'vitest'
import { buildShareMarkdown, buildStandaloneShareHtml } from './ShareConversationDialog'
import type { Bot, ChatMessage } from '@/types'

describe('ShareConversationDialog & quote reply (#33)', () => {
  it('builds standalone HTML share pages and Markdown transcripts preserving quote replies', () => {
    const bot: Bot = {
      id: 'b1',
      platformId: 'meta-muse',
      name: 'Muse · 研究员',
      description: '',
      emoji: '✦',
      accountIds: ['acc-1'],
      activeAccountId: 'acc-1',
      groupId: 'g1',
      unread: 0,
      notes: '',
      memory: [],
      createdAt: 1700000000000
    }
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        botId: 'b1',
        accountId: 'acc-1',
        role: 'bot',
        text: '这是第一轮 **核心结论**。',
        createdAt: 1700000010000,
        delivery: 'sent'
      },
      {
        id: 'm2',
        botId: 'b1',
        accountId: 'acc-1',
        role: 'user',
        text: '请针对这一点展开说明',
        replyQuote: '这是第一轮 核心结论。',
        createdAt: 1700000020000,
        delivery: 'sent'
      }
    ]

    const html = buildStandaloneShareHtml(bot, 'Meta Muse', messages)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Muse · 研究员')
    expect(html).toContain('↳ 这是第一轮 核心结论。')
    expect(html).toContain('<strong>核心结论</strong>')

    const md = buildShareMarkdown(bot, 'Meta Muse', messages)
    expect(md).toContain('# Muse · 研究员 (Meta Muse)')
    expect(md).toContain('> Quote: 这是第一轮 核心结论。')
  })
})
