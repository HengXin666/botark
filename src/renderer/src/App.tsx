import { useEffect } from 'react'
import { AddBotDialog } from '@/components/add-bot/AddBotDialog'
import { ChatArea } from '@/components/chat/ChatArea'
import { AppShell } from '@/components/layout/AppShell'
import { InfoPanel } from '@/components/info/InfoPanel'
import { hasSeenOnboarding, OnboardingDialog } from '@/components/onboarding/OnboardingGuide'
import { CommandPalette } from '@/components/palette/CommandPalette'
import { SettingsView } from '@/components/settings/SettingsView'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { UpdateBanner } from '@/components/update/UpdateBanner'
import { useGlobalShortcuts } from '@/lib/shortcuts'
import { startAdapterBridge } from '@/services/adapterBridge'
import { startMobileSyncBridge } from '@/services/mobileSyncBridge'
import { useBotStore } from '@/store/botStore'
import { startPrefsSync, usePrefsStore } from '@/store/prefsStore'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { getBridge } from '@/lib/bridge'

export default function App() {
  const settingsOpen = useBotStore((s) => s.settingsOpen)
  const selectedBotId = useBotStore((s) => s.selectedBotId)
  // Details only make sense next to a selected bot (and not while in Settings).
  const infoOpen = useBotStore(
    (s) => !s.settingsOpen && s.infoPanelOpen && s.bots.some((b) => b.id === s.selectedBotId)
  )
  const setAddBotOpen = useBotStore((s) => s.setAddBotOpen)

  useEffect(() => {
    const stop = startAdapterBridge()
    const stopMobileSync = startMobileSyncBridge()
    // After reload the zustand status may still say online, but adapters have
    // no live session — reconnect Muse/Grok/Hark so send does not fail.
    const { accounts, connectAccount, addBot, removeAccountFromBot } = useBotStore.getState()
    for (const account of Object.values(accounts)) {
      if (
        account.platformId === 'meta-muse' ||
        account.platformId === 'grok' ||
        account.platformId === 'hark' ||
        account.platformId === 'dot' ||
        account.platformId === 'hermes' ||
        account.platformId === 'antigravity'
      ) {
        void connectAccount(account.id)
      }
    }
    // Bootstrap proxy: pull live nodes from node-maint and bind to accounts once accounts exist.
    void (async () => {
      const muse = getBridge()?.muse
      if (!muse?.syncNodeMaint || !muse?.assignProxyPool) return
      let tries = 0
      const run = async () => {
        const ids = Object.values(useBotStore.getState().accounts).map((a) => a.id)
        if (ids.length === 0) {
          if (tries++ < 20) setTimeout(run, 1500)
          return
        }
        try {
          await muse.syncNodeMaint()
          await muse.assignProxyPool(ids, [])
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
    return () => {
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
            <ErrorBoundary surface={settingsOpen ? '管理控制台' : '对话区'} resetKey={settingsOpen ? 'settings' : selectedBotId}>
              {settingsOpen ? <SettingsView /> : <ChatArea />}
            </ErrorBoundary>
          }
          aside={
            <ErrorBoundary surface="右侧面板" resetKey={selectedBotId}>
              <InfoPanel />
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
