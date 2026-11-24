import { describe, expect, it } from 'vitest'
import { harkActivityTime, harkProjectTitle, parseHarkConversations, parseHarkStatuses } from './harkProjects'

describe('harkProject helpers', () => {
  it('parses conversations and keeps recency metadata', () => {
    const result = parseHarkConversations({
      conversations: [
        { id: 'p1', kind: 'project', title: ' 项目一 ', favorite: true, activityAt: '2026-11-24T12:00:00.000Z' },
        { id: 'main', kind: 'main', title: '', createdAt: '2026-11-20T10:00:00.000Z' },
        { id: '' }
      ]
    })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'p1', kind: 'project', title: ' 项目一 ', favorite: true })
    expect(result[1]).toMatchObject({ id: 'main', kind: 'main', title: null })
  })

  it('parses only string statuses', () => {
    expect(parseHarkStatuses({ statuses: { a: 'working', b: 2, c: '' } })).toEqual({ a: 'working' })
  })

  it('titles and times fall back safely', () => {
    expect(harkProjectTitle({ kind: 'main', title: null })).toBe('主对话')
    expect(harkProjectTitle({ kind: 'project', title: '   ' })).toBe('未命名项目')
    expect(harkActivityTime({ activityAt: 'bad' })).toBe(0)
    expect(harkActivityTime({ activityAt: '2026-11-24T12:00:00.000Z' })).toBe(Date.parse('2026-11-24T12:00:00.000Z'))
  })
})
