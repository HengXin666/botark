import { describe, expect, it } from 'vitest'
import {
  classifyRoomReply,
  mentions,
  roomMarkdown,
  splitMentionSegments,
  stripFinalPrefix,
  type CollabRoom,
  type RoomMember
} from './model'

const members: RoomMember[] = [
  { botId: 'muse', accountId: 'muse', platform: 'dot', name: 'Muse', cursor: 0 },
  { botId: 'dot', accountId: 'dot', platform: 'dot', name: 'Dot', cursor: 0 },
  { botId: 'admin', accountId: 'admin', platform: 'meta-muse', name: 'Muse · Admin', agentId: 'admin', cursor: 0 }
]

const room: CollabRoom = {
  id: 'room',
  title: 'Review',
  brief: 'Please review',
  members,
  mode: 'auto',
  limit: 8,
  messages: []
}

describe('rooms model', () => {
  it('mentions complete names once and ignores email addresses', () => {
    expect(mentions('x@Muse.io @MuseExtra @Dot @Muse @Dot', members).map((m) => m.botId)).toEqual(['dot', 'muse'])
  })

  it('skips code, quotes, links and URL paths', () => {
    const text = [
      'x@Muse.io https://example.com/?q=@Muse www.example.test/@Dot',
      '[link](../notes/@Muse) /room/@Dot \`@Muse\`',
      '> @Muse',
      '\`\`\`text\n@Muse\n\`\`\`',
      '请@Muse·Admin看看。'
    ].join('\n')
    expect(mentions(text, members).map((m) => m.botId)).toEqual(['admin'])
  })

  it('preserves original spelling in mention segments', () => {
    const raw = '请＠Muse·Admin 和 **@Dot** 看一下'
    const segments = splitMentionSegments(raw, members)
    expect(segments.map((s) => s.text).join('')).toBe(raw)
    expect(segments.filter((s) => s.member).map((s) => s.member?.botId)).toEqual(['admin', 'dot'])
  })

  it('classifies final and handoff replies', () => {
    expect(classifyRoomReply('[FINAL]\nDone', 'muse', members, room)).toEqual({ kind: 'final', text: '[FINAL]\nDone' })
    const handoff = classifyRoomReply('[HANDOFF] ["dot"]\nPlease check', 'muse', members, room)
    expect(handoff).toMatchObject({ kind: 'post', botIds: ['dot'], text: 'Please check' })
  })

  it('does not treat a bare final marker as a final', () => {
    expect(classifyRoomReply('[FINAL]\n  ', 'muse', members, room)).toEqual({ kind: 'post', text: '', botIds: [] })
  })

  it('renders markdown from the final message when present', () => {
    const finalRoom: CollabRoom = {
      ...room,
      finalId: 'm2',
      messages: [
        { id: 'm1', author: 'User', text: 'review' },
        { id: 'm2', author: 'Muse', text: '[FINAL]\nAccepted' }
      ]
    }
    expect(roomMarkdown(finalRoom)).toBe('# Review\n\nAccepted\n')
    expect(stripFinalPrefix('[FINAL]\nAccepted')).toBe('Accepted')
  })
})
