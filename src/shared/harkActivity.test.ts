import { describe, expect, it } from 'vitest'
import { parseHarkActiveActivity, parseHarkNarration } from './harkActivity'

describe('Hark activity normalization', () => {
  it('reads the object narration emitted by a live Hark snapshot', () => {
    expect(
      parseHarkNarration({
        line: '正在运行代码检查和测试。',
        live: true,
        visible: true,
        working: true,
        since: 1795607614426
      })
    ).toEqual({ text: '正在运行代码检查和测试。', visible: true, working: true })
  })

  it('keeps lineArgs distinct and hides invisible lines', () => {
    expect(
      parseHarkNarration({ line: '检查文件', lineArgs: { path: '/tmp/a.ts' }, working: true })
    ).toEqual({ text: '检查文件 path=/tmp/a.ts', visible: true, working: true })
    expect(parseHarkNarration({ line: '进行中', visible: false, working: true })).toBeNull()
  })

  it('accepts legacy string narration', () => {
    expect(parseHarkNarration('检查服务连接状态。')).toEqual({
      text: '检查服务连接状态。',
      visible: true,
      working: null
    })
  })

  it('normalizes activeActivity arrays and objects', () => {
    expect(parseHarkActiveActivity([])).toBeNull()
    expect(parseHarkActiveActivity([{ label: '检查服务连接状态。' }])).toBe('检查服务连接状态。')
    expect(parseHarkActiveActivity({ type: 'shell' })).toBe('shell')
  })
})
