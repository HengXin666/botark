import { describe, expect, it } from 'vitest'
import {
  harkActivityTime,
  harkHasHistory,
  harkProjectStatus,
  harkProjectTitle,
  harkProjectsByRecency,
  harkWorkingProjects,
  parseHarkConversations,
  parseHarkStatuses,
  shouldAutoOpenHarkProject
} from './harkProjects'

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

  it('detects whether a project has task history', () => {
    expect(harkHasHistory({ createdAt: '2026-11-24T12:00:00.000Z', activityAt: '2026-11-24T12:00:00.000Z' })).toBe(false)
    expect(harkHasHistory({ createdAt: '2026-11-24T12:00:00.000Z', activityAt: '2026-11-24T12:01:00.000Z' })).toBe(true)
    expect(harkHasHistory({ activityAt: '2026-11-24T12:01:00.000Z' })).toBe(true)
    expect(harkHasHistory({ activityAt: 'bad' })).toBe(false)
  })

  it('sorts multiple active projects by recency and excludes main/archived', () => {
    const projects = parseHarkConversations({
      conversations: [
        { id: 'old', kind: 'project', title: '旧项目', activityAt: '2026-11-20T10:00:00.000Z' },
        { id: 'main', kind: 'main', title: '主对话', activityAt: '2026-11-25T10:00:00.000Z' },
        { id: 'new', kind: 'project', title: '新项目', activityAt: '2026-11-24T10:00:00.000Z' },
        { id: 'archived', kind: 'project', title: '已归档', archivedAt: '2026-11-24T00:00:00.000Z', activityAt: '2026-11-24T09:00:00.000Z' }
      ]
    })
    expect(harkProjectsByRecency(projects).map((project) => project.id)).toEqual(['new', 'old'])
  })

  it('resolves live and cached status for multiple projects', () => {
    const projects = parseHarkConversations({
      conversations: [
        { id: 'p1', kind: 'project', title: '项目一', status: 'working', activityAt: '2026-11-24T10:00:00.000Z' },
        { id: 'p2', kind: 'project', title: '项目二', status: 'unread', activityAt: '2026-11-24T09:00:00.000Z' },
        { id: 'p3', kind: 'project', title: '项目三', activityAt: '2026-11-24T08:00:00.000Z' }
      ]
    })
    expect(harkProjectStatus(projects[0]!, {})).toBe('working')
    expect(harkProjectStatus(projects[1]!, { p2: 'WORKING' })).toBe('working')
    expect(harkProjectStatus(projects[2]!, {})).toBe('')
    expect(harkWorkingProjects(projects, { p2: 'working' }).map((project) => project.id)).toEqual(['p1', 'p2'])
  })

  it('auto-opens only a single working project', () => {
    const projects = parseHarkConversations({
      conversations: [
        { id: 'p1', kind: 'project', title: '项目一', status: 'working', activityAt: '2026-11-24T10:00:00.000Z' },
        { id: 'p2', kind: 'project', title: '项目二', status: 'unread', activityAt: '2026-11-24T09:00:00.000Z' }
      ]
    })
    expect(shouldAutoOpenHarkProject({ resumeLast: true, projects, statuses: {} })?.id).toBe('p1')
    expect(shouldAutoOpenHarkProject({ activeSessionId: 'main', resumeLast: true, projects, statuses: {} })).toBeNull()
    expect(shouldAutoOpenHarkProject({ resumeLast: false, projects, statuses: {} })).toBeNull()
    expect(
      shouldAutoOpenHarkProject({ resumeLast: true, projects, statuses: { p2: 'working' } })
    ).toBeNull()
  })
})
