import { ChevronRight, FolderKanban, Globe, MessageSquarePlus, PanelRight, Pin, PinOff, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PaneHeader } from '@/components/layout/PaneHeader'
import { getPlatformInspector } from '@/components/info/platformInspector'
import { BotAvatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/IconButton'
import { STATUS_LABEL } from '@/components/ui/Status'
import { getBridge } from '@/lib/bridge'
import { cn } from '@/lib/cn'
import { getBotStatus } from '@/lib/selectors'
import { shortcutLabel } from '@/lib/shortcuts'
import { useBotStore } from '@/store/botStore'
import { adapterRegistry } from '@adapters/registry'
import type { Bot, BotAccount } from '@/types'
import { t } from '@/lib/i18n'

interface ChatHeaderProps {
  bot: Bot
  accounts: BotAccount[]
}

interface AgentOption {
  id: string
  name: string
}

function useEnsureGrokAgentBound(bot: Bot): void {
  const setSelectedAgent = useBotStore((s) => s.setSelectedAgent)
  const account = useBotStore((s) => s.accounts[bot.activeAccountId])

  useEffect(() => {
    if (bot.platformId !== 'grok' || !account) return
    const adapter = adapterRegistry.get('grok') as {
      listCachedAgents?: (id: string) => AgentOption[]
      refreshAgents?: (id: string) => Promise<AgentOption[]>
      bindConversationAgent?: (c: string, a: string, accId?: string) => void
    }
    if (bot.selectedAgentId) {
      adapter?.bindConversationAgent?.(bot.id, bot.selectedAgentId, account.id)
      return
    }
    const apply = (list: AgentOption[]) => {
      const pick = list[0]?.id
      if (!pick) return
      adapter?.bindConversationAgent?.(bot.id, pick, account.id)
      setSelectedAgent(bot.id, pick)
    }
    const cached = adapter?.listCachedAgents?.(account.id) ?? []
    if (cached.length) {
      apply(cached.map((a) => ({ id: a.id, name: a.name })))
      return
    }
    void adapter
      ?.refreshAgents?.(account.id)
      .then((list) => apply((list ?? []).map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => undefined)
  }, [bot.id, bot.platformId, bot.selectedAgentId, account?.id, account?.status, setSelectedAgent])
}

export function ChatHeader({ bot, accounts: _accounts }: ChatHeaderProps) {
  const allAccounts = useBotStore((s) => s.accounts)
  const infoOpen = useBotStore((s) => s.infoPanelOpen)
  const toggleInfoPanel = useBotStore((s) => s.toggleInfoPanel)
  const webSessionOpen = useBotStore((s) => s.webSessionOpen)
  const toggleWebSession = useBotStore((s) => s.toggleWebSession)
  const togglePinBot = useBotStore((s) => s.togglePinBot)
  const startNewMuseSession = useBotStore((s) => s.startNewMuseSession)
  const startNewHermesSession = useBotStore((s) => s.startNewHermesSession)
  const startNewAntigravitySession = useBotStore((s) => s.startNewAntigravitySession)
  const showHarkProjects = useBotStore((s) => s.showHarkProjects)
  const setSelectedAgent = useBotStore((s) => s.setSelectedAgent)
  const connectAccount = useBotStore((s) => s.connectAccount)
  const typing = useBotStore((s) => s.typing[bot.id] === true)
  const activeAccount = allAccounts[bot.activeAccountId]
  const inspector = getPlatformInspector(bot.platformId)
  const [startingFresh, setStartingFresh] = useState(false)

  const handleNewConversation = async () => {
    if (bot.platformId === 'meta-muse') {
      await startNewMuseSession(bot.id)
      return
    }
    if (bot.platformId === 'hermes') {
      setStartingFresh(true)
      try {
        await startNewHermesSession(bot.id)
      } finally {
        setStartingFresh(false)
      }
      return
    }
    if (bot.platformId === 'antigravity') {
      startNewAntigravitySession(bot.id)
      return
    }
    if (bot.platformId === 'grok' && bot.activeAccountId && bot.selectedAgentId) {
      const grok = getBridge()?.grok
      if (!grok?.rpc) return
      setStartingFresh(true)
      try {
        await grok.rpc({
          accountId: bot.activeAccountId,
          op: 'call',
          method: 'StartFreshGrokBotConversation',
          params: { agent_id: bot.selectedAgentId }
        })
        setSelectedAgent(bot.id, bot.selectedAgentId)
      } finally {
        setStartingFresh(false)
      }
    }
  }

  const status = getBotStatus(bot, allAccounts)
  const activity = useBotStore((s) => s.activity[bot.activeAccountId])
  const activityLine = activity
    ? `${activity.emoji ? activity.emoji + ' ' : ''}${activity.text || (activity.busy ? t('Working…') : '')}${
        activity.subagents && activity.subagents > 0 ? ` · ${activity.subagents} subagents` : ''
      }`.trim()
    : ''

  useEnsureGrokAgentBound(bot)

  return (
    <PaneHeader className="gap-3 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {activityLine ? (
          <span
            className="hidden min-w-0 truncate text-[12px] text-ink-muted shimmer-text sm:inline"
            title={activityLine}
            data-muse-activity
          >
            {activityLine}
          </span>
        ) : null}
      </div>

      {/* The capsule: avatar + name; hovering reveals the way into details. */}
      <button
        type="button"
        data-capsule
        onClick={toggleInfoPanel}
        aria-expanded={infoOpen}
        title={`${bot.name} · ${STATUS_LABEL[status]}`}
        className={cn(
          'no-drag group press flex h-10 max-w-[min(420px,50%)] min-w-0 items-center gap-2 rounded-full pr-3.5 pl-2',
          'border-[0.5px] border-line-strong bg-main shadow-float hover:bg-surface'
        )}
      >
        <BotAvatar
          emoji={bot.emoji}
          seed={bot.id}
          avatar={bot.avatar}
          avatarShape={bot.avatarShape}
          avatarColor={bot.avatarColor}
          platformId={bot.platformId}
          status={status}
          isWorking={typing || Boolean(activity?.busy)}
          followPointer
          size="xs"
          ringClassName="ring-main"
        />
        <span className="flex min-w-0 flex-col items-start">
          <h1 className="max-w-full min-w-0 truncate text-[14px] leading-[18px] font-medium text-ink">{bot.name}</h1>
          {(status !== 'online' || (bot.platformId === 'hark' && bot.activeSessionTitle)) && (
            <span className="-mt-0.5 max-w-full truncate text-[10.5px] leading-[13px] text-ink-muted" data-capsule-status>
              {status !== 'online'
                ? STATUS_LABEL[status]
                : `· ${bot.activeSessionTitle}`}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            '-ml-2 size-4 w-0 shrink-0 -translate-x-1.5 text-ink-muted opacity-0 blur-[3px]',
            'transition-[width,margin,opacity,filter,translate] duration-[290ms] ease-spring-tap',
            'group-hover:ml-0 group-hover:w-4 group-hover:translate-x-0 group-hover:opacity-100 group-hover:blur-none',
            'group-focus-visible:ml-0 group-focus-visible:w-4 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:blur-none'
          )}
        />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {bot.platformId === 'hark' && (
          <IconButton label="返回项目" onClick={() => showHarkProjects(bot.id)}>
            <FolderKanban />
          </IconButton>
        )}
        {inspector.supportsQuickNewConversation && (
          <IconButton
            label={t('New conversation')}
            disabled={
              startingFresh ||
              (bot.platformId === 'grok' && (!bot.activeAccountId || !bot.selectedAgentId))
            }
            onClick={() => void handleNewConversation()}
          >
            <MessageSquarePlus />
          </IconButton>
        )}
        {bot.activeAccountId && (
          <IconButton
            label={t('Sync conversation')}
            disabled={activeAccount?.pending}
            onClick={() => void connectAccount(bot.activeAccountId)}
          >
            <RefreshCw className={cn(activeAccount?.pending && 'animate-spin')} />
          </IconButton>
        )}
        <IconButton label={bot.pinned ? t('Unpin from sidebar') : t('Pin to sidebar')} active={bot.pinned === true} onClick={() => togglePinBot(bot.id)}>
          {bot.pinned ? <PinOff /> : <Pin />}
        </IconButton>
        {inspector.supportsWebSession && (
          <IconButton
            label={webSessionOpen ? t('Back to conversation') : t('Show web session')}
            active={webSessionOpen}
            onClick={toggleWebSession}
          >
            <Globe />
          </IconButton>
        )}
        <IconButton
          label={infoOpen ? t('Hide details') : t('Show details')}
          shortcut={shortcutLabel('I')}
          active={infoOpen}
          onClick={toggleInfoPanel}
        >
          <PanelRight />
        </IconButton>
      </div>
    </PaneHeader>
  )
}
