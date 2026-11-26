import { memo, useRef, useState } from 'react'
import { ChevronRight, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { ArkExportDocSvg, ArkRelayOrbSvg } from '@/components/ui/ArkGlyphs'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextInput } from '@/components/ui/Field'
import { InlineEdit } from '@/components/ui/InlineEdit'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger
} from '@/components/ui/Menu'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useBotStore } from '@/store/botStore'
import { stripFinalPrefix, type CollabRoom } from './model'
import { RoomAvatarCluster } from './RoomAvatarCluster'
import { exportRoomMarkdownFile, NEW_ROOM_ID } from './roomExport'
import { applyDropOnRoom, isRoomDropDrag, showRoomDndNotice, useRoomDndNotice } from './roomDnd'
import { deleteRoom, renameRoom, togglePinRoom, useRooms } from './roomStore'

export { NEW_ROOM_ID }

/** Drop-target props so a bot / room member can be dragged onto a group chat. */
function useRoomDropTarget(roomId: string) {
  const [over, setOver] = useState(false)
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent<HTMLElement>) => {
        if (!isRoomDropDrag(e.dataTransfer.types)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      },
      onDragLeave: (e: React.DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      },
      onDrop: (e: React.DragEvent<HTMLElement>) => {
        if (!isRoomDropDrag(e.dataTransfer.types)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        showRoomDndNotice(applyDropOnRoom(roomId, e.dataTransfer))
      }
    }
  }
}

function RoomDndNotice() {
  const notice = useRoomDndNotice((s) => s.notice)
  if (!notice) return null
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed bottom-4 left-4 z-50 max-w-72 rounded-xl px-3 py-2 text-[12px] font-medium shadow-lg',
        notice.ok ? 'bg-ink text-canvas' : 'bg-status-error text-white'
      )}
    >
      {notice.message}
    </div>
  )
}

function openSidebarRoom(id: string) {
  const { settingsOpen, setSettingsOpen, selectRoom } = useBotStore.getState()
  if (settingsOpen) setSettingsOpen(false)
  selectRoom(id)
}

const RoomSidebarItem = memo(function RoomSidebarItem({
  room,
  compact = false
}: {
  room: CollabRoom
  compact?: boolean
}) {
  const t = useT()
  const selected = useBotStore((s) => s.roomsOpen && s.selectedRoomId === room.id && !s.settingsOpen)
  const speaker = useRooms((s) => s.speakers[room.id])
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const rowRef = useRef<HTMLButtonElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const drop = useRoomDropTarget(room.id)
  const lastMsg = room.messages.at(-1)
  const subtitle = speaker
    ? `@${speaker}…`
    : room.finalId
      ? '已定稿'
      : lastMsg
        ? stripFinalPrefix(lastMsg.text).replace(/\s+/g, ' ').trim()
        : `${room.members.length} 位成员`

  return (
    <div
      className={cn(
        'group/room relative shrink-0 transition-shadow',
        compact ? 'rounded-2xl' : 'rounded-xl',
        drop.over && 'bg-accent-50/70 ring-2 ring-accent-500'
      )}
      {...drop.props}
      onContextMenu={(event) => {
        if (renaming) return
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      {drop.over && !compact && (
        <span className="pointer-events-none absolute top-1/2 right-9 z-10 -translate-y-1/2 rounded-md bg-accent-600 px-1.5 py-0.5 text-[10.5px] font-medium text-white">
          松开加入
        </span>
      )}
      {renaming && !compact ? (
        <div className="flex h-11 items-center px-2">
          <InlineEdit
            value={room.title}
            label="群聊名称"
            maxLength={50}
            className="h-8 w-full text-[13px] font-medium"
            onCommit={(name) => renameRoom(room.id, name)}
            onDone={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          ref={rowRef}
          type="button"
          data-bot-row
          aria-current={selected}
          aria-label={compact ? room.title : undefined}
          onClick={() => openSidebarRoom(room.id)}
          title={compact ? `${room.title}（可拖入 Bot）` : room.title}
          className={cn(
            'no-drag text-ink transition-colors focus-visible:outline-offset-[-2px]',
            compact
              ? 'press-icon relative grid size-11 place-items-center rounded-2xl'
              : 'press flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left',
            selected ? 'bg-active' : 'hover:bg-hover',
            selected && compact && 'ring-1 ring-line-strong'
          )}
        >
          <RoomAvatarCluster
            members={compact ? room.members.slice(0, 2) : room.members}
            speakingName={speaker}
            size="xs"
            ringClassName="ring-canvas"
          />
          {compact ? (
            <>
              {room.pinned && <Pin aria-hidden className="absolute top-0.5 left-0.5 size-3 text-ink-muted" />}
              {speaker && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-accent-600 ring-2 ring-canvas"
                />
              )}
            </>
          ) : (
            <span className="min-w-0 flex-1 pr-4">
              <span className="flex items-center gap-1">
                {room.pinned && <Pin aria-hidden className="size-3 shrink-0 text-ink-muted" />}
                <span className="truncate text-[13px] leading-[18px] font-medium tracking-tight">
                  {room.title}
                </span>
              </span>
              <span
                className={cn(
                  'block truncate text-[11.5px] leading-4',
                  speaker
                    ? 'shimmer-text font-medium'
                    : room.finalId
                      ? 'text-status-online-ink'
                      : 'text-ink-muted'
                )}
              >
                {subtitle}
              </span>
            </span>
          )}
        </button>
      )}

      {!renaming && (
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            aria-label={t('Actions for {name}', { name: room.title })}
            className={cn(
              'press-icon absolute grid place-items-center rounded-full text-ink-muted',
              compact ? 'right-0 bottom-0 size-5 bg-canvas' : 'top-1/2 right-1.5 size-6 -translate-y-1/2',
              'opacity-0 group-hover/room:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
              'hover:bg-active hover:text-ink data-[state=open]:bg-active'
            )}
          >
            <MoreHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuContent align="start" side="bottom" className="min-w-40">
            <MenuItem onSelect={() => togglePinRoom(room.id)}>
              {room.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
              {t(room.pinned ? 'Unpin' : 'Pin')}
            </MenuItem>
            <MenuItem onSelect={() => setRenaming(true)}>
              <Pencil aria-hidden /> {t('Rename')}
            </MenuItem>
            <MenuItem
              disabled={room.messages.length === 0}
              onSelect={() => exportRoomMarkdownFile(room)}
            >
              <ArkExportDocSvg /> 导出 Markdown
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => deleteRoom(room.id)}>
              <Trash2 aria-hidden /> {t('Delete')}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}

      {compact && (
        <Dialog
          open={renaming}
          onOpenChange={setRenaming}
          title={t('Rename')}
          className="max-w-[360px]"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            renameInputRef.current?.focus()
            renameInputRef.current?.select()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            rowRef.current?.focus()
          }}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              const title = new FormData(event.currentTarget).get('title')
              if (typeof title !== 'string' || !title.trim()) return
              renameRoom(room.id, title)
              setRenaming(false)
            }}
          >
            <TextInput
              ref={renameInputRef}
              name="title"
              aria-label="群聊名称"
              defaultValue={room.title}
              maxLength={50}
              required
            />
            <Button type="submit" size="sm" variant="primary" className="self-end">
              {t('Save')}
            </Button>
          </form>
        </Dialog>
      )}
    </div>
  )
})

export function PinnedRoomsList({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const rooms = useRooms(useShallow((s) => s.rooms.filter((room) => room.pinned === true)))
  if (rooms.length === 0) return null

  return (
    <section
      aria-label={`${t('Pinned')} · ${t('Collaboration rooms')}`}
      className={cn(
        'no-drag mb-1.5 flex max-h-[min(12rem,40%)] w-full shrink-0 flex-col overflow-y-auto rounded-xl bg-ink/[0.035] p-1',
        compact ? 'items-center gap-1' : 'gap-0.5'
      )}
    >
      {rooms.map((room) => <RoomSidebarItem key={room.id} room={room} compact={compact} />)}
    </section>
  )
}

export function RoomList({ compact = false }: { compact?: boolean }) {
  const rooms = useRooms(useShallow((s) => s.rooms.filter((room) => room.pinned !== true)))
  const creating = useBotStore((s) => s.roomsOpen && s.selectedRoomId === NEW_ROOM_ID && !s.settingsOpen)
  const [collapsed, setCollapsed] = useState(false)
  const items = rooms.map((room) => <RoomSidebarItem key={room.id} room={room} compact={compact} />)

  if (compact) {
    return (
      <section
        aria-label="群聊"
        className="no-drag mt-1 flex max-h-[45%] w-full shrink-0 flex-col items-center gap-1.5 border-t border-ink/[0.06] pt-2"
      >
        <button
          type="button"
          title="新建群聊"
          aria-label="新建群聊"
          aria-current={creating}
          onClick={() => openSidebarRoom(NEW_ROOM_ID)}
          className={cn(
            'press-icon grid size-10 shrink-0 place-items-center rounded-2xl transition-colors',
            creating
              ? 'bg-active text-accent-600'
              : 'text-ink-secondary hover:bg-hover hover:text-ink'
          )}
        >
          <ArkRelayOrbSvg active={creating} className="size-4.5" />
        </button>
        {rooms.length > 0 && (
          <div className="flex min-h-0 w-full flex-col items-center gap-1.5 overflow-y-auto py-0.5">
            {items}
          </div>
        )}
        <RoomDndNotice />
      </section>
    )
  }

  return (
    <section aria-label="群聊" className="no-drag mt-1 shrink-0 border-t border-ink/[0.06] pt-1.5">
      <div className="group/rsec flex h-7 items-center gap-0.5 px-0.5">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-ink-muted transition-colors hover:bg-hover hover:text-ink-secondary"
        >
          <ArkRelayOrbSvg className="size-3.5 text-ink-secondary" />
          <span className="truncate text-[12px] font-medium tracking-tight">群聊</span>
          {collapsed && rooms.length > 0 && (
            <span className="ml-auto text-[11px] tabular-nums opacity-70">{rooms.length}</span>
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              'ml-auto size-3.5 shrink-0 transition-transform duration-150',
              !collapsed ? 'rotate-90 opacity-0 group-hover/rsec:opacity-80' : 'opacity-70'
            )}
          />
        </button>
        <button
          type="button"
          title="新建群聊"
          aria-label="新建群聊"
          onClick={() => openSidebarRoom(NEW_ROOM_ID)}
          className={cn(
            'press-icon grid size-6 shrink-0 place-items-center rounded-full transition-colors',
            creating
              ? 'bg-ink text-canvas'
              : 'text-ink-muted hover:bg-hover hover:text-ink'
          )}
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {!collapsed && rooms.length > 0 && (
        <div className="mt-0.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {items}
        </div>
      )}
      <RoomDndNotice />
    </section>
  )
}
