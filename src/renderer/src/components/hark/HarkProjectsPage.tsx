import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronRight, FolderKanban, Loader2, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-react'
import { PaneHeader } from '@/components/layout/PaneHeader'
import { BotAvatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { TextInput } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { getBridge } from '@/lib/bridge'
import { cn } from '@/lib/cn'
import { useBotStore } from '@/store/botStore'
import type { Bot } from '@/types'
import { harkHasHistory, harkProjectStatus, harkProjectTitle, harkProjectsByRecency, harkWorkingProjects, parseHarkConversations, parseHarkStatuses, shouldAutoOpenHarkProject, type HarkProjectSummary } from '@shared/harkProjects'

type HarkConversation = HarkProjectSummary

export interface HarkProjectsPageProps { bot: Bot }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function conversationTitle(conversation: HarkConversation): string {
  return harkProjectTitle(conversation)
}

function formatActivity(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((today - day) / 86_400_000)
  if (days <= 0) return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? '')).trim() || '操作失败，请稍后重试'
}

function StatusBadge({ status, completed }: { status: string; completed: boolean }) {
  if (status === 'working') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-600/10 px-2 py-0.5 text-[10.5px] font-medium text-accent-600"><span className="size-1.5 animate-pulse rounded-full bg-accent-600" aria-hidden />工作中</span>
  }
  if (status === 'unread') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-attention/10 px-2 py-0.5 text-[10.5px] font-medium text-status-attention-ink"><span className="size-1.5 rounded-full bg-status-attention" aria-hidden />未读</span>
  }
  if (completed) {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-status-online/10 px-2 py-0.5 text-[10.5px] font-medium text-status-online-ink"><CheckCircle2 className="size-3" aria-hidden />已完成</span>
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[10.5px] font-medium text-ink-muted"><span className="size-1.5 rounded-full bg-ink-faint" aria-hidden />未开始</span>
}

function ConversationRow({ bot, conversation, status, opening, deleting, featured = false, onOpen, onDelete }: {
  bot: Bot
  conversation: HarkConversation
  status?: string
  opening: boolean
  deleting?: boolean
  featured?: boolean
  onOpen: (conversation: HarkConversation) => void
  onDelete?: (conversation: HarkConversation) => void
}) {
  const title = conversationTitle(conversation)
  return (
    <div className={cn('group flex w-full items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-soft transition-colors', 'hover:border-line-strong hover:bg-hover/60', featured && 'p-2.5')}>
      <button type="button" disabled={opening || deleting} aria-busy={opening || deleting || undefined} aria-label={`打开${title}`} onClick={() => onOpen(conversation)}
        className="press flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left disabled:cursor-default disabled:opacity-70">
        {conversation.kind === 'main' ? (
          <BotAvatar emoji={bot.emoji} seed={bot.id} avatar={bot.avatar} avatarShape={bot.avatarShape} avatarColor={bot.avatarColor} platformId={bot.platformId} size={featured ? 'md' : 'sm'} />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-hover text-ink-secondary"><FolderKanban className="size-[18px]" aria-hidden /></span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className={cn('min-w-0 max-w-full truncate font-medium text-ink', featured ? 'text-[14px]' : 'text-[13px]')}>{title}</span>
            {conversation.favorite && <Star className="size-3.5 shrink-0 fill-status-attention text-status-attention" aria-label="已收藏" />}
            <StatusBadge status={status ?? ''} completed={harkHasHistory(conversation)} />
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2 text-[11.5px] text-ink-muted">
            {conversation.kind === 'main' && <span className="shrink-0">默认会话</span>}
            {conversation.activityAt && <span className="truncate">{formatActivity(conversation.activityAt)}</span>}
            {opening && <span className="shrink-0 text-ink-secondary">正在打开…</span>}
          </span>
        </span>
        {opening ? <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-ink-faint group-hover:text-ink-muted" aria-hidden />}
      </button>
      {onDelete && conversation.kind === 'project' && (
        <button type="button" disabled={deleting || opening} onClick={() => onDelete(conversation)} aria-label={`删除${title}`} title="删除项目"
          className="grid size-8 shrink-0 place-items-center rounded-xl text-ink-faint transition-colors hover:bg-status-error/10 hover:text-status-error-ink disabled:opacity-50">
          {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
        </button>
      )}
    </div>
  )
}

function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在加载项目">
      <div className="h-[76px] animate-pulse rounded-2xl border border-line bg-surface" />
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((index) => <div key={index} className="h-[72px] animate-pulse rounded-2xl border border-line bg-surface" />)}
      </div>
    </div>
  )
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-10 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-hover text-ink-muted"><FolderKanban className="size-5" aria-hidden /></span>
      <div>
        <p className="text-[13px] font-medium text-ink">还没有项目，创建一个开始工作</p>
        <p className="mt-1 text-[11.5px] text-ink-muted">项目会把同一项工作的对话集中在一起。</p>
      </div>
      <Button variant="primary" size="sm" onClick={onCreate}><Plus aria-hidden /> 新建项目</Button>
    </div>
  )
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-status-error/25 bg-status-error/8 px-3.5 py-2.5 text-[12px] text-status-error-ink">
      <span className="flex min-w-0 items-center gap-2"><AlertCircle className="size-4 shrink-0" aria-hidden /><span className="min-w-0 break-words">{message}</span></span>
      <Button size="sm" variant="secondary" onClick={onRetry}>重试</Button>
    </div>
  )
}

export function HarkProjectsPage({ bot }: HarkProjectsPageProps) {
  const accountId = bot.activeAccountId
  const [conversations, setConversations] = useState<HarkConversation[] | null>(null)
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [openingId, setOpeningId] = useState<string>()
  const [deletingId, setDeletingId] = useState<string>()
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string>()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const autoOpenedRef = useRef(false)
  const harkResumeLast = useBotStore((state) => state.harkResumeLastConversation)
  const setHarkResumeLast = useBotStore((state) => state.setHarkResumeLastConversation)
  const setHarkProjectData = useBotStore((state) => state.setHarkProjectData)

  const refreshStatuses = useCallback(async () => {
    const hark = getBridge()?.hark
    if (!hark?.rpc || !accountId) return
    try {
      const result = await hark.rpc({ accountId, op: 'conversationStatus' })
      if (result.ok) {
        setStatuses(parseHarkStatuses(result.data))
        setStatusLoaded(true)
      }
    } catch {
      // Status polling is best-effort; keep the last known values.
    }
  }, [accountId])

  const loadConversations = useCallback(async () => {
    if (!accountId) {
      setConversations([])
      setError('当前 Hark 机器人还没有绑定账号')
      return
    }
    const hark = getBridge()?.hark
    if (!hark?.rpc) {
      setConversations([])
      setError('Hark IPC 不可用，请在桌面客户端中使用')
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const result = await hark.rpc({ accountId, op: 'listConversations' })
      if (!result.ok) throw new Error(result.message || `加载项目失败（HTTP ${result.status}）`)
      setConversations(parseHarkConversations(result.data))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    setConversations(null)
    setStatuses({})
    setStatusLoaded(false)
    autoOpenedRef.current = false
    setError(undefined)
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    void refreshStatuses()
    const timer = window.setInterval(() => void refreshStatuses(), 5000)
    return () => window.clearInterval(timer)
  }, [refreshStatuses])

  useEffect(() => {
    if (conversations) setHarkProjectData(bot.id, conversations, statuses)
  }, [bot.id, conversations, setHarkProjectData, statuses])

  useEffect(() => {
    if (composerOpen) titleInputRef.current?.focus()
  }, [composerOpen])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadConversations(), refreshStatuses()])
  }, [loadConversations, refreshStatuses])

  const mainConversation = useMemo(() => conversations?.find((item) => item.kind === 'main') ?? null, [conversations])
  const projects = useMemo(() => (conversations ? harkProjectsByRecency(conversations) : []), [conversations])
  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? projects.filter((item) => conversationTitle(item).toLowerCase().includes(keyword)) : projects
  }, [projects, query])
  const workingProjects = useMemo(
    () => harkWorkingProjects(projects, statuses),
    [projects, statuses]
  )

  const openConversation = useCallback(async (conversation: HarkConversation) => {
    if (openingId) return
    setOpeningId(conversation.id)
    setError(undefined)
    try {
      await useBotStore.getState().openHarkConversation(bot.id, conversation.id, conversationTitle(conversation), conversation.kind)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setOpeningId(undefined)
    }
  }, [bot.id, openingId])

  const deleteConversation = useCallback(async (conversation: HarkConversation) => {
    if (deletingId || openingId) return
    const title = conversationTitle(conversation)
    const confirmed = window.confirm(`删除项目「${title}」？

这会从 Hark 云端删除该对话，且无法恢复。`)
    if (!confirmed) return
    setDeletingId(conversation.id)
    setError(undefined)
    try {
      await useBotStore.getState().deleteHarkConversation(bot.id, conversation.id)
      setConversations((prev) => prev?.filter((item) => item.id !== conversation.id) ?? prev)
      setStatuses((prev) => {
        const next = { ...prev }
        delete next[conversation.id]
        return next
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setDeletingId(undefined)
    }
  }, [bot.id, deletingId, openingId])

  useEffect(() => {
    if (autoOpenedRef.current || !conversations || !statusLoaded) return
    autoOpenedRef.current = true
    const autoOpen = shouldAutoOpenHarkProject({
      activeSessionId: bot.activeSessionId,
      resumeLast: harkResumeLast,
      projects,
      statuses
    })
    if (autoOpen) void openConversation(autoOpen)
  }, [bot.activeSessionId, conversations, harkResumeLast, openConversation, statusLoaded, statuses, workingProjects])

  const openComposer = () => {
    setComposerOpen(true)
    setCreateError(undefined)
  }

  const cancelComposer = () => {
    if (creating) return
    setComposerOpen(false)
    setDraftTitle('')
    setCreateError(undefined)
  }

  const submitCreate = async () => {
    if (creating) return
    if (!accountId) return setCreateError('当前 Hark 机器人还没有绑定账号')
    const hark = getBridge()?.hark
    if (!hark?.rpc) return setCreateError('Hark IPC 不可用，请在桌面客户端中使用')
    const title = draftTitle.trim()
    setCreating(true)
    setCreateError(undefined)
    let conversationId = ''
    let createdTitle = '未命名项目'
    try {
      const result = await hark.rpc({ accountId, op: 'createProject', title, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      if (!result.ok) throw new Error(result.message || `创建项目失败（HTTP ${result.status}）`)
      conversationId = asString(asRecord(result.data)?.['conversationId'])
      createdTitle = asString(asRecord(result.data)?.['title']) || '未命名项目'
      if (!conversationId) throw new Error('创建项目失败：未返回会话 ID')
    } catch (err) {
      setCreateError(errorMessage(err))
      setCreating(false)
      return
    }
    setCreating(false)
    setComposerOpen(false)
    setDraftTitle('')
    await loadConversations()
    try {
      await useBotStore.getState().openHarkConversation(bot.id, conversationId, createdTitle, 'project')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-main">
      <PaneHeader className="justify-between pr-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-hover text-ink-secondary"><FolderKanban className="size-4" aria-hidden /></span>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink">项目</h1>
          <span className="h-3.5 w-px shrink-0 bg-line" aria-hidden />
          <span className="truncate text-[12px] text-ink-secondary">{bot.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="hidden items-center gap-1.5 text-[11.5px] text-ink-secondary sm:flex" title="默认开启：打开 Hark 时直接回到上次聊天的项目；关闭后总是先显示项目列表。">
            <input
              type="checkbox"
              checked={harkResumeLast}
              onChange={(event) => setHarkResumeLast(event.target.checked)}
              className="size-3.5 accent-accent-600"
            />
            恢复上次对话
          </label>
          <IconButton label="刷新项目" disabled={loading} onClick={() => void refreshAll()}><RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /></IconButton>
          <Button variant="primary" size="sm" onClick={openComposer}><Plus aria-hidden /> 新建项目</Button>
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5">
          <label className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-secondary sm:hidden">
            <input
              type="checkbox"
              checked={harkResumeLast}
              onChange={(event) => setHarkResumeLast(event.target.checked)}
              className="size-3.5 shrink-0 accent-accent-600"
            />
            <span className="shrink-0">恢复上次对话</span>
            <span className="min-w-0 truncate text-ink-muted">优先打开正在工作的项目</span>
          </label>
          {error && <ErrorBanner message={error} onRetry={() => void refreshAll()} />}

          {composerOpen && (
            <div className="animate-veil-in flex flex-col gap-3 rounded-2xl border border-line-strong bg-surface p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13.5px] font-semibold text-ink">新建项目</h2>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">给项目起个名字，之后可以随时回来继续。</p>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">{draftTitle.length}/80</span>
              </div>
              <TextInput
                ref={titleInputRef}
                value={draftTitle}
                maxLength={80}
                invalid={Boolean(createError)}
                onChange={(event) => {
                  setDraftTitle(event.target.value)
                  if (createError) setCreateError(undefined)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submitCreate()
                  } else if (event.key === 'Escape') {
                    cancelComposer()
                  }
                }}
                placeholder="例如：官网改版、Q4 增长计划…"
                aria-label="项目名称"
                className="h-9 text-[13px]"
              />
              {createError && <p className="text-[12px] text-status-error-ink" role="alert">{createError}</p>}
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" disabled={creating} onClick={() => void submitCreate()}>
                  {creating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                  {creating ? '创建中…' : '创建'}
                </Button>
                <Button variant="ghost" size="sm" disabled={creating} onClick={cancelComposer}>取消</Button>
              </div>
            </div>
          )}

          {conversations === null ? (
            error ? null : <ProjectsSkeleton />
          ) : (
            <>
              {workingProjects.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h2 className="text-[12px] font-medium text-ink-secondary">正在工作<span className="ml-1.5 text-[11px] font-normal tabular-nums text-ink-muted">{workingProjects.length}</span></h2>
                    <span className="text-[11px] text-ink-muted">可以直接点开切换</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {workingProjects.map((conversation) => (
                      <ConversationRow key={`working-${conversation.id}`} bot={bot} conversation={conversation} status="working" opening={openingId === conversation.id} deleting={deletingId === conversation.id} onOpen={(next) => void openConversation(next)} onDelete={(next) => void deleteConversation(next)} />
                    ))}
                  </div>
                </section>
              )}

              {mainConversation && (
                <section className="flex flex-col gap-2">
                  <h2 className="px-1 text-[11.5px] font-medium tracking-wide text-ink-muted">主对话</h2>
                  <ConversationRow bot={bot} conversation={mainConversation} status={harkProjectStatus(mainConversation, statuses)} opening={openingId === mainConversation.id} featured onOpen={(conversation) => void openConversation(conversation)} />
                </section>
              )}

              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[12.5px] font-medium text-ink-secondary">项目<span className="ml-1.5 text-[11.5px] font-normal tabular-nums text-ink-muted">{projects.length}</span></h2>
                  <div className="relative w-full max-w-[240px]">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
                    <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目…" aria-label="搜索项目" className="h-8 pl-9 text-[12.5px]" />
                  </div>
                </div>

                {projects.length === 0 ? (
                  <EmptyProjects onCreate={openComposer} />
                ) : filteredProjects.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line bg-surface/50 px-4 py-8 text-center text-[12.5px] text-ink-muted">没有匹配的项目</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredProjects.map((conversation) => (
                      <ConversationRow key={conversation.id} bot={bot} conversation={conversation} status={harkProjectStatus(conversation, statuses)} opening={openingId === conversation.id} deleting={deletingId === conversation.id} onOpen={(next) => void openConversation(next)} onDelete={(next) => void deleteConversation(next)} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
