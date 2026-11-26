import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AttachmentMeta } from '@adapters/types'
import { BarChart3, ChevronLeft, FolderKanban, Plus, QrCode, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { ChatApprovals } from '@/components/chat/ApprovalCard'
import { Composer } from '@/components/chat/Composer'
import { MessageList } from '@/components/chat/MessageList'
import { HarkProjectsPage } from '@/components/hark/HarkProjectsPage'
import { BotList } from '@/components/sidebar/BotList'
import { QuotaStatsPage } from '@/components/quota/QuotaStatsPage'
import { BotAvatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { GrokBotMark } from '@/components/ui/GrokBotMark'
import { STATUS_LABEL } from '@/components/ui/Status'
import { androidNativeCommand, getAndroidApprovals, getAndroidConnection } from '@/lib/androidBridge'
import { cn } from '@/lib/cn'
import { useQuotaUsageCollector } from '@/lib/quotaUsageCollector'
import { getBotAccounts, getBotStatus, lastMessage } from '@/lib/selectors'
import { useBotStore } from '@/store/botStore'
import type { Bot, ChatMessage } from '@/types'
import './mobile.css'

const NO_MESSAGES: ChatMessage[] = []

const STARTERS = [
  '你能帮我做什么？',
  '帮我写一段简短的项目介绍',
  '头脑风暴五个产品名字'
]

/** Native connection state lives outside React; poll it and follow bridge pushes. */
function useAndroidConnection(): { connected: boolean; label: string } {
  const [connection, setConnection] = useState(getAndroidConnection)
  useEffect(() => {
    const sync = () => setConnection(getAndroidConnection())
    sync()
    const timer = window.setInterval(sync, 2000)
    window.addEventListener('botark-native-state', sync)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('botark-native-state', sync)
    }
  }, [])
  return connection
}

function useAndroidApprovalsCount(): number {
  const [count, setCount] = useState(getAndroidApprovals().length)
  useEffect(() => {
    const sync = () => setCount(getAndroidApprovals().length)
    sync()
    window.addEventListener('botark-native-state', sync)
    return () => window.removeEventListener('botark-native-state', sync)
  }, [])
  return count
}

function ConnectionChip() {
  const { connected, label } = useAndroidConnection()
  return (
    <span
      role="status"
      className={cn(
        'inline-flex min-w-0 shrink items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium',
        connected ? 'bg-status-online/10 text-status-online-ink' : 'bg-sunken text-status-offline-ink'
      )}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-status-online' : 'bg-status-offline')}
      />
      <span className="max-w-[72px] truncate">{label || (connected ? '已连接' : '未连接')}</span>
    </span>
  )
}

function HomeHeader() {
  const approvals = useAndroidApprovalsCount()
  return (
    <header className="mobile-safe-top shrink-0 border-b border-line bg-canvas">
      <div className="flex h-12 items-center gap-2 px-3">
        <span className="grid size-8 shrink-0 place-items-center">
          <GrokBotMark seed="bothub-brand" shape="blob" color="black" sizePx={22} />
        </span>
        <h1 className="shrink-0 text-[16px] font-semibold tracking-tight text-ink">BotArk</h1>
        <ConnectionChip />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            aria-label="添加机器人"
            title="添加机器人"
            className="size-9 px-0"
            onClick={() => androidNativeCommand('openNative', { screen: 'add' })}
          >
            <Plus className="size-[19px]" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="扫码配对"
            title="扫码配对"
            className="size-9 px-0"
            onClick={() => androidNativeCommand('openNative', { screen: 'qr' })}
          >
            <QrCode className="size-[18px]" aria-hidden />
          </Button>
          {approvals > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={'审批 ' + approvals}
              title={'审批 ' + approvals}
              className="relative size-9 px-0"
              onClick={() => androidNativeCommand('openNative', { screen: 'approvals' })}
            >
              <ShieldCheck className="size-[17px]" aria-hidden />
              <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-status-attention px-1 text-[9px] font-semibold leading-4 text-white">
                {approvals > 9 ? '9+' : approvals}
              </span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label="额度统计"
            title="额度统计"
            className="size-9 px-0"
            onClick={() => useBotStore.getState().setQuotaStatsOpen(true)}
          >
            <BarChart3 className="size-[17px]" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="同步设置"
            title="同步设置"
            className="size-9 px-0"
            onClick={() => androidNativeCommand('openNative', { screen: 'sync' })}
          >
            <SlidersHorizontal className="size-[17px]" aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  )
}

function HomeScreen() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <HomeHeader />
      <main className="min-h-0 flex-1 overflow-hidden bg-main">
        <div className="flex h-full min-h-0 flex-col px-2">
          <BotList mobile />
        </div>
      </main>
      <div className="mobile-safe-bottom shrink-0 bg-main" aria-hidden />
    </div>
  )
}

function BotStatusLine({ bot }: { bot: Bot }) {
  const accounts = useBotStore((s) => s.accounts)
  const activity = useBotStore((s) => s.activity[bot.activeAccountId])
  const typing = useBotStore((s) => s.typing[bot.id] === true)
  const last = useBotStore((s) => lastMessage(s.messages[bot.id]))
  const status = getBotStatus(bot, accounts)
  const live = activity?.text?.trim() || (activity?.busy ? '工作中' : '')
  const lastText = last?.text.replace(/\s+/g, ' ').trim() ?? ''
  const harkSession = bot.platformId === 'hark' ? bot.activeSessionTitle?.trim() : ''
  const line =
    live ||
    (typing
      ? '正在回复…'
      : status !== 'online'
        ? STATUS_LABEL[status]
        : harkSession
          ? '· ' + harkSession
          : lastText || STATUS_LABEL[status])

  return (
    <p
      title={line}
      className={cn('truncate text-[11px] leading-4 text-ink-muted', live && 'shimmer-text')}
      data-bot-status-line
    >
      {line}
    </p>
  )
}

function ChatHeader({ bot }: { bot: Bot }) {
  const accounts = useBotStore((s) => s.accounts)
  const activity = useBotStore((s) => s.activity[bot.activeAccountId])
  const typing = useBotStore((s) => s.typing[bot.id] === true)
  const status = getBotStatus(bot, accounts)

  return (
    <header className="mobile-safe-top shrink-0 border-b border-line bg-canvas">
      <div className="flex h-14 items-center gap-1.5 px-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="返回"
          title="返回"
          className="size-10 px-0"
          onClick={() => window.history.back()}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <BotAvatar
          emoji={bot.emoji}
          seed={bot.id}
          avatar={bot.avatar}
          avatarShape={bot.avatarShape}
          avatarColor={bot.avatarColor}
          platformId={bot.platformId}
          status={status}
          isWorking={typing || activity?.busy === true || status === 'busy'}
          size="xs"
          ringClassName="ring-canvas"
        />
        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-[14.5px] leading-5 font-medium text-ink">{bot.name}</h1>
          <BotStatusLine bot={bot} />
        </div>
        {bot.platformId === 'hark' && Boolean(bot.activeSessionId) && bot.harkProjectsOpen !== true && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="返回项目"
            title="返回项目"
            className="size-9 px-0"
            onClick={() => useBotStore.getState().showHarkProjects(bot.id)}
          >
            <FolderKanban className="size-[18px]" aria-hidden />
          </Button>
        )}
      </div>
    </header>
  )
}

function StarterIntro({ bot }: { bot: Bot }) {
  const status = useBotStore((s) => getBotStatus(bot, s.accounts))
  const canSend = status === 'online' || status === 'busy' || status === 'attention'
  const pick = (text: string) => {
    void useBotStore.getState().sendMessage(bot.id, text)
  }

  return (
    <div className="flex min-h-0 flex-1 animate-veil-in flex-col items-center justify-center gap-5 px-6 pb-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <BotAvatar
          emoji={bot.emoji}
          seed={bot.id}
          avatar={bot.avatar}
          avatarShape={bot.avatarShape}
          avatarColor={bot.avatarColor}
          platformId={bot.platformId}
          followPointer
          size="lg"
        />
        <h2 className="text-[17px] leading-6 font-medium tracking-tight text-ink">{bot.name}</h2>
      </div>
      <div className="flex w-full max-w-sm flex-wrap justify-center gap-2">
        {STARTERS.map((starter) => (
          <Button
            key={starter}
            variant="secondary"
            size="sm"
            disabled={!canSend}
            onClick={() => pick(starter)}
            className="h-8 max-w-full text-[13px] font-normal"
          >
            {starter}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ChatScreen({ bot }: { bot: Bot }) {
  const accountMap = useBotStore((s) => s.accounts)
  const accounts = useMemo(() => getBotAccounts(bot, accountMap), [bot, accountMap])
  const activeAccount = accountMap[bot.activeAccountId]
  const messages = useBotStore((s) => s.messages[bot.id] ?? NO_MESSAGES)
  const typing = useBotStore((s) => s.typing[bot.id] === true)

  const sendMessage = useBotStore((s) => s.sendMessage)
  const retryMessage = useBotStore((s) => s.retryMessage)
  const cancelGeneration = useBotStore((s) => s.cancelGeneration)
  const connectAccount = useBotStore((s) => s.connectAccount)
  const openMuseLogin = useBotStore((s) => s.openMuseLogin)
  const openGrokLogin = useBotStore((s) => s.openGrokLogin)
  const openHarkLogin = useBotStore((s) => s.openHarkLogin)
  const openDotLogin = useBotStore((s) => s.openDotLogin)
  const openAntigravityLogin = useBotStore((s) => s.openAntigravityLogin)

  const onSend = useCallback(
    (text: string, attachments: AttachmentMeta[] = []) => {
      void sendMessage(bot.id, text, attachments)
    },
    [bot.id, sendMessage]
  )
  const onRetry = useCallback(
    (messageId: string) => {
      void retryMessage(bot.id, messageId)
    },
    [bot.id, retryMessage]
  )
  const onCancel = useCallback(() => {
    void cancelGeneration(bot.id)
  }, [bot.id, cancelGeneration])
  const onConnect = useCallback((accountId: string) => void connectAccount(accountId), [connectAccount])
  const onMuseLogin = useCallback((accountId: string) => void openMuseLogin(accountId), [openMuseLogin])
  const onGrokLogin = useCallback((accountId: string) => void openGrokLogin(accountId), [openGrokLogin])
  const onHarkLogin = useCallback((accountId: string) => void openHarkLogin(accountId), [openHarkLogin])
  const onDotLogin = useCallback((accountId: string) => void openDotLogin(accountId), [openDotLogin])
  const onAntigravityLogin = useCallback(
    (accountId: string) => void openAntigravityLogin(accountId),
    [openAntigravityLogin]
  )

  const harkProjectsOpen = bot.platformId === 'hark' && bot.harkProjectsOpen !== false

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-main">
      <ChatHeader bot={bot} />
      {harkProjectsOpen ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <HarkProjectsPage bot={bot} />
        </div>
      ) : (
        <>
          {messages.length === 0 && !typing ? (
            <StarterIntro bot={bot} />
          ) : (
            <MessageList bot={bot} messages={messages} accounts={accounts} typing={typing} onRetry={onRetry} />
          )}
          {(bot.platformId === 'meta-muse' || bot.platformId === 'grok') && activeAccount && (
            <ChatApprovals
              accountId={activeAccount.id}
              platformId={bot.platformId}
              agentId={bot.selectedAgentId}
            />
          )}
          <div className="mobile-composer-dock">
            <Composer
              key={bot.id}
              bot={bot}
              account={activeAccount}
              typing={typing}
              onSend={onSend}
              onCancel={onCancel}
              onConnect={onConnect}
              onMuseLogin={onMuseLogin}
              onGrokLogin={onGrokLogin}
              onHarkLogin={onHarkLogin}
              onDotLogin={onDotLogin}
              onAntigravityLogin={onAntigravityLogin}
              hideAttachments
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Single-column mobile shell for the Android WebView. It renders the same
 * renderer components as the Linux desktop app and reads the store hydrated
 * by the native bridge.
 */
export default function MobileApp() {
  const selectedBotId = useBotStore((s) => s.selectedBotId)
  const quotaStatsOpen = useBotStore((s) => s.quotaStatsOpen)
  const bot = useBotStore((s) => s.bots.find((candidate) => candidate.id === s.selectedBotId))
  useQuotaUsageCollector()

  // Android hardware back pops this history entry before it leaves the app.
  useEffect(() => {
    const onPop = () => {
      const state = useBotStore.getState()
      if (state.quotaStatsOpen) {
        state.setQuotaStatsOpen(false)
        return
      }
      if (state.selectedBotId) useBotStore.setState({ selectedBotId: null })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    if (!selectedBotId) return
    window.history.pushState({ botId: selectedBotId }, '')
  }, [selectedBotId])
  useEffect(() => {
    if (quotaStatsOpen) window.history.pushState({ quotaStats: true }, '')
  }, [quotaStatsOpen])

  return (
    <div className="mobile-shell">
      <div className="mobile-frame">
        {quotaStatsOpen ? (
          <QuotaStatsPage
            mobile
            onClose={() => {
              if (window.history.state?.quotaStats) window.history.back()
              else useBotStore.getState().setQuotaStatsOpen(false)
            }}
          />
        ) : selectedBotId && bot ? (
          <ChatScreen bot={bot} />
        ) : (
          <HomeScreen />
        )}
      </div>
    </div>
  )
}
