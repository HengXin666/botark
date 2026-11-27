import { useEffect } from 'react'
import { AddBotDialog } from '@/components/add-bot/AddBotDialog'
import { ChatArea } from '@/components/chat/ChatArea'
import { QuotaStatsPage } from '@/components/quota/QuotaStatsPage'
import { RoomView } from '@/rooms/RoomView'
import { RoomInspectorPanel } from '@/rooms/RoomInspectorPanel'
import { useRooms } from '@/rooms/roomStore'
import { AppShell } from '@/components/layout/AppShell'
import { InfoPanel } from '@/components/info/InfoPanel'
import { hasSeenOnboarding, OnboardingDialog } from '@/components/onboarding/OnboardingGuide'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { SettingsView } from '@/components/settings/SettingsView'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { UpdateBanner } from '@/components/update/UpdateBanner'
import { useQuotaUsageCollector } from '@/lib/quotaUsageCollector'
import { useGlobalShortcuts } from '@/lib/shortcuts'
import { startAdapterBridge } from '@/services/adapterBridge'
import { startMobileSyncBridge } from '@/services/mobileSyncBridge'
import { useBotStore } from '@/store/botStore'
import { startPrefsSync, usePrefsStore } from '@/store/prefsStore'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { getBridge } from '@/lib/bridge'
import { syncHarkPool } from '@/lib/harkPoolSync'
import { syncRemoteHarkAccounts } from '@/lib/remoteHarkSync'
import { applySavedWorkspaceMetadata, startWorkspaceMetadataBridge } from '@/services/workspaceMetadataBridge'

export default function App() {
  const settingsOpen = useBotStore((s) => s.settingsOpen)
  const quotaStatsOpen = useBotStore((s) => s.quotaStatsOpen)
  const roomsOpen = useBotStore((s) => s.roomsOpen)
  const selectedRoomId = useBotStore((s) => s.selectedRoomId)
  const selectedBotId = useBotStore((s) => s.selectedBotId)
  const activeRoom = useRooms((s) => s.rooms.find((r) => r.id === selectedRoomId))
  useQuotaUsageCollector()

  useEffect(() => startWorkspaceMetadataBridge(), [])

  // Details only make sense next to a selected bot, or next to an existing room.
  const infoOpen = useBotStore((s) => {
    if (s.settingsOpen || s.quotaStatsOpen || !s.infoPanelOpen) return false
    if (s.roomsOpen) return Boolean(activeRoom)
    return s.bots.some((b) => b.id === s.selectedBotId)
  })
  const setAddBotOpen = useBotStore((s) => s.setAddBotOpen)

  useEffect(() => {
    const hark = getBridge()?.hark
    if (!hark?.remoteList) return
    const refresh = (): void => {
      void syncRemoteHarkAccounts()
        .catch((error) => console.warn('[hark-remote] sync failed', error))
        .then(() => applySavedWorkspaceMetadata())
        .catch((error) => console.warn('[workspace-metadata] load failed', error))
    }
    refresh()
    // The REST import handler broadcasts this event after each registration
    // machine push, so an already-open Web UI picks up the new account too.
    return hark.onEvent((event) => {
      if (event.type === 'remoteImport') refresh()
    })
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('harkPoolSync') !== '1') return
    const timer = setTimeout(() => {
      void syncHarkPool()
        .then((result) => console.info('[hark-pool] auto sync', result))
        .catch((error) => console.warn('[hark-pool] auto sync failed', error))
    }, 2500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const stop = startAdapterBridge()
    const stopMobileSync = startMobileSyncBridge()
    // After reload the zustand status may still say online, but adapters have
    // no live session — reconnect Muse/Grok/Hark so send does not fail.
    const { accounts, connectAccount, addBot, removeAccountFromBot } = useBotStore.getState()
    const orderedAccounts = Object.values(accounts)
      .filter((account) => !account.manualOffline)
      .sort((left, right) => {
        const rank = (a: (typeof accounts)[string]) =>
          a.status === 'offline' || a.status === 'error' ? 0 : 1
        return rank(left) - rank(right)
      })
    // Start status monitoring for every Hark account before the slower auth
    // probe pass. The main process keeps all of them on a 30s background watch
    // and promotes up to 10 opened/working accounts to its 5s live pool, so
    // accounts are observed from app launch even while connect() is still busy.
    const harkBridge = getBridge()?.hark
    if (harkBridge?.rpc) {
      for (const account of orderedAccounts) {
        if (account.platformId !== 'hark') continue
        void harkBridge
          .rpc({ accountId: account.id, op: 'watchStatus', intervalMs: 30_000, refreshTitles: false })
          .catch(() => undefined)
      }
    }
    // Connect in batches of 10, offline/error accounts first. Firing 80 Hark
    // auth probes at once used to saturate the main process and still leave the
    // broken accounts last in line; four-at-a-time made later accounts wait too
    // long before they were observable.
    void (async () => {
      for (let index = 0; index < orderedAccounts.length; index += 10) {
        await Promise.all(
          orderedAccounts.slice(index, index + 10).map((account) => connectAccount(account.id).catch(() => undefined))
        )
      }
    })()
    // Bootstrap proxy: pull live nodes from node-maint and bind to accounts once accounts exist.
    void (async () => {
      const muse = getBridge()?.muse
      if (!muse?.syncNodeMaint || !muse?.assignProxyPool) return
      let tries = 0
      const run = async () => {
        const all = Object.values(useBotStore.getState().accounts)
        const ids = all
          .sort((left, right) => {
            const rank = (a: (typeof all)[number]) =>
              a.status === 'offline' || a.status === 'error' ? 0 : 1
            return rank(left) - rank(right)
          })
          .map((a) => a.id)
        if (ids.length === 0) {
          if (tries++ < 20) setTimeout(run, 1500)
          return
        }
        try {
          await muse.syncNodeMaint()
          // Pass broken accounts first so the limited live pool replaces their
          // dead proxies instead of handing new nodes to already-working rows.
          await muse.assignProxyPool(ids, [])
          // The initial connect pass ran before proxy assignment; retry the
          // accounts that were offline so they pick up their new proxy config.
          for (const account of all) {
            if (
              account.platformId === 'hark' &&
              !account.manualOffline &&
              (account.status === 'offline' || account.status === 'error')
            ) {
              void useBotStore.getState().connectAccount(account.id).catch(() => undefined)
            }
          }
        } catch {
          /* best effort */
        }
      }
      void run()
    })()
    // Enforce 1-account-per-bot across all bots (remove any extra attached accounts)
    for (const b of useBotStore.getState().bots) {
      if (b.accountIds.length > 1) {
        const keepId = b.activeAccountId && b.accountIds.includes(b.activeAccountId) ? b.activeAccountId : b.accountIds[0]!
        for (const id of b.accountIds) {
          if (id !== keepId) {
            removeAccountFromBot(b.id, id)
          }
        }
      }
    }
    // Auto-hydrate all pre-provisioned Dot accounts from dot-accounts.json (strictly 1 account = 1 bot)
    const dotBridge = typeof window !== 'undefined' ? window.electron?.dot : undefined
    if (dotBridge?.rpc) {
      void dotBridge
        .rpc({ accountId: 'acc_dot_default', op: 'listStoredAccounts' })
        .then((res) => {
          if (!res?.ok || !Array.isArray(res.data)) return
          const storedList = res.data as Array<{
            accountId: string
            handle?: string
            displayName?: string
            planType?: string
          }>
          const validIds = new Set(storedList.map((x) => x.accountId).filter(Boolean))
          // Remove any stale Dot bots/accounts whose account is no longer in dot-accounts.json
          if (validIds.size > 0) {
            useBotStore.setState((s) => {
              const nextAccounts = { ...s.accounts }
              for (const [id, acc] of Object.entries(nextAccounts)) {
                if (acc.platformId === 'dot' && !validIds.has(id)) {
                  delete nextAccounts[id]
                }
              }
              return {
                accounts: nextAccounts,
                bots: s.bots.filter((b) => {
                  if (b.platformId !== 'dot') return true
                  const accId = b.activeAccountId || b.accountIds[0]
                  return Boolean(accId && validIds.has(accId))
                })
              }
            })
          }
          for (const item of storedList) {
            const accId = item.accountId
            if (!accId) continue
            const label = item.handle || item.displayName || accId
            const curState = useBotStore.getState()
            const existingBotForAcc = curState.bots.find(
              (b) =>
                b.platformId === 'dot' &&
                (b.activeAccountId === accId || b.accountIds.includes(accId))
            )
            if (!existingBotForAcc) {
              const botId =
                accId === 'acc_dot_default'
                  ? 'bot_dot_default'
                  : `bot_${accId}`
              addBot({
                id: botId,
                platformId: 'dot',
                name: `Dot · ${label}`,
                emoji: '🪐',
                accounts: [
                  {
                    key: accId,
                    accountId: accId,
                    displayName: label,
                    handle: item.handle ?? label
                  }
                ],
                background: Boolean(curState.selectedBotId)
              })
            } else {
              void curState.connectAccount(accId)
            }
          }
        })
        .catch(() => undefined)
    }

    // Proxy assignment may finish after the initial connect pass. Retry Hark
    // accounts that are still offline once their pending flag clears; cap per
    // account so a genuinely expired session does not loop forever.
    const repairAttempts = new Map<string, number>()
    const repairTimer = window.setInterval(() => {
      const state = useBotStore.getState()
      for (const account of Object.values(state.accounts)) {
        if (account.platformId !== 'hark') continue
        if (account.status !== 'offline' && account.status !== 'error') continue
        if (account.pending || account.manualOffline) continue
        const attempts = repairAttempts.get(account.id) ?? 0
        if (attempts >= 3) continue
        repairAttempts.set(account.id, attempts + 1)
        void state.connectAccount(account.id).catch(() => undefined)
      }
    }, 5000)
    return () => {
      window.clearInterval(repairTimer)
      stopMobileSync()
      stop()
    }
  }, [])

  // Handle `--open-grok-login` startup trigger or first-visit full-screen guide
  useEffect(() => {
    const triggerGrokLoginFlow = () => {
      const state = useBotStore.getState()
      const offlineGrok = Object.values(state.accounts).find(
        (a) => a.platformId === 'grok' && (a.status === 'offline' || a.status === 'error')
      )
      if (offlineGrok) {
        const owner = state.bots.find((b) => b.accountIds.includes(offlineGrok.id))
        if (owner) state.selectBot(owner.id)
        void state.openGrokLogin(offlineGrok.id, false)
        return
      }
      state.setAddBotOpen(true, 'grok')
    }

    const params =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    if (params?.get('openGrokLogin') === '1') {
      const timer = setTimeout(triggerGrokLoginFlow, 220)
      return () => clearTimeout(timer)
    }

    if (!hasSeenOnboarding() && useBotStore.getState().bots.length > 0) {
      useBotStore.getState().setOnboardingOpen(true)
    }

    const onTrigger = () => triggerGrokLoginFlow()
    window.addEventListener('bothub:open-grok-login', onTrigger)
    return () => window.removeEventListener('bothub:open-grok-login', onTrigger)
  }, [])

  useEffect(() => startPrefsSync(), [])
  useGlobalShortcuts()

  // Test harness for CDP/E2E scripts (dev, or ?e2e=1 / localStorage BOTHUB_E2E).
  useEffect(() => {
    const e2e =
      import.meta.env.DEV ||
      (typeof window !== 'undefined' &&
        (new URLSearchParams(window.location.search).get('e2e') === '1' ||
          window.localStorage.getItem('BOTHUB_E2E') === '1'))
    if (!e2e) return
    void import("@adapters/registry").then(({ adapterRegistry }) => {
      ;(window as unknown as { __bothub?: unknown }).__bothub = {
        store: useBotStore,
        prefs: usePrefsStore,
        adapterRegistry
      }
    })
  }, [])

  return (
    <>
      <div className="relative isolate h-full">
        <UpdateBanner />
        <AppShell
          asideOpen={infoOpen}
          sidebar={<Sidebar onAddBot={() => setAddBotOpen(true)} />}
          main={
            <ErrorBoundary
              surface={settingsOpen ? '管理控制台' : quotaStatsOpen ? '额度统计' : roomsOpen ? '协作空间' : '对话区'}
              resetKey={settingsOpen ? 'settings' : quotaStatsOpen ? 'quota-stats' : roomsOpen ? `rooms:${selectedRoomId ?? ''}` : selectedBotId}
            >
              {settingsOpen ? <SettingsView /> : quotaStatsOpen ? <QuotaStatsPage /> : roomsOpen ? <RoomView id={selectedRoomId ?? ''} /> : <ChatArea />}
            </ErrorBoundary>
          }
          aside={
            <ErrorBoundary
              surface={roomsOpen && activeRoom ? '协作空间详情' : '右侧面板'}
              resetKey={roomsOpen ? `room:${selectedRoomId ?? ''}` : selectedBotId}
            >
              {roomsOpen && activeRoom ? <RoomInspectorPanel room={activeRoom} /> : <InfoPanel />}
            </ErrorBoundary>
          }
        />
      </div>
      <AddBotDialog />
      <OnboardingDialog />
      <CommandPalette />
    </>
  )
}
