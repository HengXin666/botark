import { describe, expect, it } from 'vitest'
import { HarkConversationSyncState } from './harkClient'

describe('HarkConversationSyncState working status', () => {
  it('keeps the narration object from a live snapshot instead of dropping it', () => {
    const state = new HarkConversationSyncState()
    state.applyFrame(
      JSON.stringify({
        type: 'snapshot',
        data: {
          activeActivity: [],
          activeWork: [],
          narration: {
            line: '正在运行代码检查和测试。',
            live: true,
            visible: true,
            working: true,
            since: 1795607614426
          },
          messages: []
        }
      })
    )
    expect(state.narration).toBe('正在运行代码检查和测试。')
    expect(state.activityText()).toBe('正在运行代码检查和测试。')
    expect(state.isWorking()).toBe(true)
  })

  it('reads object narration from narration_update and message_update', () => {
    const state = new HarkConversationSyncState()
    state.applyFrame(
      JSON.stringify({ type: 'snapshot', data: { messages: [{ id: 'm1', role: 'assistant' }] } })
    )
    state.applyFrame(
      JSON.stringify({
        type: 'patches',
        data: [
          {
            op: 'message_update',
            id: 'm1',
            fields: { narration: { line: '正在读取界面组件代码。', visible: true } }
          },
          {
            op: 'narration_update',
            value: { line: '正在检查并更新前端依赖。', working: true, visible: true }
          }
        ]
      })
    )
    expect(state.narration).toBe('正在检查并更新前端依赖。')
    expect(state.messages.get('m1')?.narration).toBe('正在读取界面组件代码。')
    expect(state.isWorking()).toBe(true)
  })

  it('clears the status when narration becomes invisible or the turn completes', () => {
    const state = new HarkConversationSyncState()
    state.applyFrame(
      JSON.stringify({
        type: 'snapshot',
        data: { narration: { line: '工作中', working: true, visible: true }, messages: [] }
      })
    )
    state.applyFrame(
      JSON.stringify({
        type: 'patches',
        data: [{ op: 'narration_update', value: { line: '工作中', visible: false, working: false } }]
      })
    )
    expect(state.narration).toBeNull()
    expect(state.isWorking()).toBe(false)
  })

  it('does not treat completed work as active', () => {
    const state = new HarkConversationSyncState()
    state.applyFrame(
      JSON.stringify({
        type: 'patches',
        data: [
          { op: 'active_work_set', value: [{ dispatchId: 'd1', state: 'working' }] },
          { op: 'request_update', value: { state: 'completed' } }
        ]
      })
    )
    expect(state.requestState).toBe('completed')
    expect(state.activeWorkCount).toBe(0)
    expect(state.isWorking()).toBe(false)
  })

  it('keeps the last line when a status-only narration patch arrives', () => {
    const state = new HarkConversationSyncState()
    state.applyFrame(
      JSON.stringify({
        type: 'snapshot',
        data: {
          narration: { line: '检查服务连接状态。', working: true, visible: true },
          messages: []
        }
      })
    )
    state.applyFrame(
      JSON.stringify({
        type: 'patches',
        data: [{ op: 'narration_update', value: { working: true, live: true, visible: true } }]
      })
    )
    expect(state.narration).toBe('检查服务连接状态。')
    expect(state.isWorking()).toBe(true)
  })
})
