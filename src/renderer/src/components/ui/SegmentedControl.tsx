import type { ReactNode } from 'react'
import { useGlide } from '@/hooks/useGlide'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string = string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T>>
  size?: 'xs' | 'sm' | 'md'
  'aria-label'?: string
  className?: string
  fullWidth?: boolean
}

const ITEM_SIZES = {
  xs: 'h-[26px] px-2.5 text-[11.5px] gap-1',
  sm: 'h-[30px] px-3 text-[12px] gap-1.5',
  md: 'h-[34px] px-3.5 text-[13px] gap-1.5'
} as const

/**
 * Grok Bot ("Sand") sliding pill segmented control powered by `useGlide`.
 */
export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  size = 'sm',
  'aria-label': ariaLabel,
  className,
  fullWidth = false
}: SegmentedControlProps<T>) {
  const glide = useGlide<HTMLDivElement>(`${value}:${options.length}`, { axis: 'x' })

  return (
    <div
      ref={glide.ref}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'no-drag relative inline-flex items-center rounded-[11px] bg-hover p-0.5 select-none',
        fullWidth && 'flex w-full',
        className
      )}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const enabled = options.filter((o) => !o.disabled)
        if (!enabled.length) return
        const delta = event.key === 'ArrowRight' ? 1 : -1
        const idx = Math.max(
          0,
          enabled.findIndex((item) => item.value === value)
        )
        const next = enabled[(idx + delta + enabled.length) % enabled.length]!.value
        onValueChange(next)
        glide.ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
      }}
    >
      {glide.thumb && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-[9px] bg-surface shadow-float"
          style={glide.thumb}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            data-tab={opt.value}
            disabled={opt.disabled}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              'press relative inline-flex min-w-0 items-center justify-center rounded-[9px] font-medium tracking-tight whitespace-nowrap transition-colors outline-none',
              'disabled:pointer-events-none disabled:opacity-35',
              fullWidth && 'flex-1',
              ITEM_SIZES[size],
              active ? 'text-ink' : 'text-ink-secondary hover:text-ink'
            )}
          >
            {opt.icon && <span className="flex shrink-0 items-center [&_svg]:size-3.5">{opt.icon}</span>}
            <span className="truncate">{opt.label}</span>
            {opt.badge && <span className="shrink-0">{opt.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
