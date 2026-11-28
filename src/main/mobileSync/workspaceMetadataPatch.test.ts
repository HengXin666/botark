import { describe, expect, it } from 'vitest'
import type { MobileWorkspaceSnapshot } from '@shared/mobileSync'
import { applyWorkspaceMetadataPatch } from './workspaceMetadataPatch'

function baseSnapshot(): MobileWorkspaceSnapshot {
  return {
    version: 1,
    updatedAtMs: 1,
    hostName: 'test',
    selectedBotId: null,
    groups: [{ id: 'g-work', name: 'Workspace', collapsed: true }],
    bots: [
      {
        id: 'bot_acc_hark_hk052n7xhb_crying_top',
        platformId: 'hark',
        name: 'OA3/HX-CR',
        groupId: 'g-work',
        activeAccountId: 'acc_hark_hk052n7xhb_crying_top',
        lastActivityAt: 1
      },
      {
        id: 'bot_acc_hark_hk16nirssk_crying_top',
        platformId: 'hark',
        name: 'Hark hk16nirssk',
        groupId: 'g-work',
        activeAccountId: 'acc_hark_hk16nirssk_crying_top',
        lastActivityAt: 1
      }
    ],
    accounts: {
      acc_hark_hk052n7xhb_crying_top: {
        id: 'acc_hark_hk052n7xhb_crying_top',
        platformId: 'hark',
        displayName: 'hk052n7xhb@crying.top',
        handle: 'hk052n7xhb@crying.top',
        status: 'online'
      },
      acc_hark_hk16nirssk_crying_top: {
        id: 'acc_hark_hk16nirssk_crying_top',
        platformId: 'hark',
        displayName: 'hk16nirssk@crying.top',
        handle: 'hk16nirssk@crying.top',
        status: 'online'
      }
    },
    messages: {},
    approvals: {}
  }
}

const payload = {
  groups: [
    { id: 'grp_pro2', name: 'Pro2', collapsed: false },
    { id: 'grp_pro1', name: 'Pro1' }
  ],
  bots: [
    { matchHandle: 'hk052n7xhb@crying.top', name: 'HX-A', groupId: 'grp_pro2' },
    { matchHandle: 'hk16nirssk@crying.top', name: 'HX-B', groupId: 'grp_pro1' }
  ]
}

describe('applyWorkspaceMetadataPatch', () => {
  it('rewrites bot names and group ids on the snapshot and creates groups', () => {
    const { snapshot, result } = applyWorkspaceMetadataPatch(baseSnapshot(), payload)
    expect(result).toMatchObject({ groupsCreated: 2, groupsRenamed: 0, botsMatched: 2, botsUpdated: 2, botsCreated: 0 })
    expect(snapshot.groups).toEqual([
      { id: 'g-work', name: 'Workspace', collapsed: true },
      { id: 'grp_pro2', name: 'Pro2', collapsed: false },
      { id: 'grp_pro1', name: 'Pro1', collapsed: false }
    ])
    expect(snapshot.bots[0]).toMatchObject({ name: 'HX-A', groupId: 'grp_pro2' })
    expect(snapshot.bots[1]).toMatchObject({ name: 'HX-B', groupId: 'grp_pro1' })
    expect(snapshot.bots[0]!.activeAccountId).toBe('acc_hark_hk052n7xhb_crying_top')
  })

  it('renames an existing group instead of duplicating it', () => {
    const patch = { groups: [{ id: 'g-work', name: 'Pro' }], bots: [] }
    const { snapshot, result } = applyWorkspaceMetadataPatch(baseSnapshot(), patch)
    expect(result).toMatchObject({ groupsCreated: 0, groupsRenamed: 1 })
    expect(snapshot.groups).toEqual([{ id: 'g-work', name: 'Pro', collapsed: true }])
  })

  it('is idempotent and can be reverted to the original values', () => {
    const first = applyWorkspaceMetadataPatch(baseSnapshot(), payload).snapshot
    const again = applyWorkspaceMetadataPatch(first, payload)
    expect(again.result).toMatchObject({ botsUpdated: 0, groupsCreated: 0, groupsRenamed: 0 })
    const revert = applyWorkspaceMetadataPatch(again.snapshot, {
      groups: [{ id: 'g-work', name: 'Workspace' }],
      bots: [
        { matchHandle: 'hk052n7xhb@crying.top', name: 'OA3/HX-CR', groupId: 'g-work' },
        { matchHandle: 'hk16nirssk@crying.top', name: 'Hark hk16nirssk', groupId: 'g-work' }
      ]
    })
    expect(revert.snapshot.bots.map((bot) => [bot.name, bot.groupId])).toEqual([
      ['OA3/HX-CR', 'g-work'],
      ['Hark hk16nirssk', 'g-work']
    ])
  })

  it('materialises a bot for an imported account that has none yet', () => {
    const { snapshot, result } = applyWorkspaceMetadataPatch(
      baseSnapshot(),
      {
        groups: [{ id: 'grp_pro2', name: 'Pro2' }],
        bots: [{ matchHandle: 'us2nseymo05mfz8r6d@loliko.top', name: 'HX-C', groupId: 'grp_pro2' }]
      },
      {
        createMissingBots: true,
        knownAccounts: [
          {
            accountId: 'acc_hark_us2nseymo05mfz8r6d_loliko_top',
            handle: 'us2nseymo05mfz8r6d@loliko.top',
            displayName: 'us2nseymo05mfz8r6d@loliko.top'
          }
        ]
      }
    )
    expect(result).toMatchObject({ botsMatched: 0, botsCreated: 1 })
    const created = snapshot.bots.find((bot) => bot.id === 'bot_acc_hark_us2nseymo05mfz8r6d_loliko_top')
    expect(created).toMatchObject({
      platformId: 'hark',
      name: 'HX-C',
      groupId: 'grp_pro2',
      activeAccountId: 'acc_hark_us2nseymo05mfz8r6d_loliko_top'
    })
    expect(snapshot.accounts['acc_hark_us2nseymo05mfz8r6d_loliko_top']).toMatchObject({
      platformId: 'hark',
      status: 'offline'
    })
  })

  it('keeps bots whose handle has no patch and never deletes remote-only bots', () => {
    const snapshot = baseSnapshot()
    snapshot.bots.push({
      id: 'bot_remote_only',
      platformId: 'hark',
      name: 'Remote Only',
      groupId: 'grp_remote',
      activeAccountId: 'acc_remote',
      lastActivityAt: 1
    })
    snapshot.accounts['acc_remote'] = {
      id: 'acc_remote',
      platformId: 'hark',
      displayName: 'remote@example.com',
      handle: 'remote@example.com',
      status: 'offline'
    }
    const { snapshot: next, result } = applyWorkspaceMetadataPatch(snapshot, payload)
    expect(result.botsUnmatched).toBe(1)
    expect(next.bots.find((bot) => bot.id === 'bot_remote_only')).toMatchObject({
      name: 'Remote Only',
      groupId: 'grp_remote'
    })
  })
})
