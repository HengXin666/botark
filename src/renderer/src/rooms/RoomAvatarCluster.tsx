import { BotAvatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { useBotStore } from '@/store/botStore'
import type { RoomMember } from './model'

export interface RoomAvatarClusterProps {
  members: ReadonlyArray<RoomMember>
  speakingName?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  ringClassName?: string
  className?: string
}

const AVATAR_SIZE = {
  xs: 'xs',
  sm: 'xs',
  md: 'sm',
  lg: 'md'
} as const

const OVERLAP = {
  xs: '-space-x-2',
  sm: '-space-x-2',
  md: '-space-x-2.5',
  lg: '-space-x-3'
} as const

/**
 * Overlapping living 3D `BotAvatar` cluster representing a multi-agent room.
 */
export function RoomAvatarCluster({
  members,
  speakingName,
  size = 'sm',
  ringClassName = 'ring-main',
  className
}: RoomAvatarClusterProps) {
  const bots = useBotStore((s) => s.bots)
  const list = Array.isArray(members) ? members : []
  const limit = size === 'lg' ? 6 : size === 'xs' ? 2 : 3
  const visible = list.slice(0, limit)
  const overflow = list.length - visible.length

  return (
    <span className={cn('inline-flex shrink-0 items-center', OVERLAP[size], className)}>
      {visible.map((m) => {
        const bot = bots.find((b) => b.id === m.botId)
        const isSpeaking = speakingName === m.name
        return (
          <span
            key={m.botId}
            className={cn(
              'relative inline-flex rounded-full ring-2',
              ringClassName,
              isSpeaking && 'z-10'
            )}
          >
            <BotAvatar
              emoji={bot?.emoji ?? '🤖'}
              seed={bot?.id ?? m.botId}
              avatar={bot?.avatar}
              avatarShape={bot?.avatarShape}
              avatarColor={bot?.avatarColor}
              platformId={m.platform}
              isWorking={isSpeaking}
              followPointer={size === 'lg'}
              size={AVATAR_SIZE[size]}
            />
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          className={cn(
            'relative inline-grid place-items-center rounded-full bg-hover font-semibold text-ink-secondary tabular-nums ring-2',
            ringClassName,
            size === 'lg' ? 'size-9 text-[12px]' : 'size-6 text-[10px]'
          )}
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}
