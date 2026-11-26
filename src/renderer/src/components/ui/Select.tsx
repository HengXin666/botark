import { useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOverlayLock } from '@/lib/overlay'
import { MENU_SURFACE } from './Menu'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

export interface SelectProps<T extends string = string> {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<SelectOption<T>>
  placeholder?: string
  variant?: 'pill' | 'field' | 'ghost'
  size?: 'xs' | 'sm' | 'md'
  leadingIcon?: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  disabled?: boolean
  id?: string
  'aria-label'?: string
  title?: string
  className?: string
  menuClassName?: string
  footer?: ReactNode
}

const TRIGGER_VARIANTS = {
  pill: 'rounded-full border-[0.5px] border-line-strong bg-surface text-ink shadow-soft hover:bg-hover data-[state=open]:bg-hover',
  field:
    'w-full rounded-lg border border-line-strong bg-surface text-ink shadow-soft hover:border-ink/20 data-[state=open]:border-accent-300 data-[state=open]:ring-3 data-[state=open]:ring-accent-100',
  ghost: 'rounded-full bg-transparent text-ink-secondary hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink'
} as const

const TRIGGER_SIZES = {
  xs: 'h-7 gap-1.5 px-2.5 text-[12px]',
  sm: 'h-8 gap-1.5 px-3 text-[12.5px]',
  md: 'h-9 gap-2 px-3 text-[13px]'
} as const

/**
 * Bespoke Grok-Bot-style custom dropdown picker built on Radix DropdownMenu.
 * Replaces native `<select>` across toolbars, inspector cards, and dialogs.
 */
export function Select<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder = '请选择…',
  variant = 'field',
  size = 'md',
  leadingIcon,
  align = 'start',
  side,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  title,
  className,
  menuClassName,
  footer
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  useOverlayLock(open)

  const selected = options.find((opt) => opt.value === value)

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        title={title ?? selected?.label}
        className={cn(
          'no-drag group press inline-flex min-w-0 items-center justify-between font-medium outline-none select-none',
          'disabled:pointer-events-none disabled:opacity-40',
          TRIGGER_VARIANTS[variant],
          TRIGGER_SIZES[size],
          className
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {(leadingIcon ?? selected?.icon) && (
            <span className="flex shrink-0 items-center text-ink-secondary [&_svg]:size-3.5">
              {leadingIcon ?? selected?.icon}
            </span>
          )}
          <span className={cn('truncate', !selected && 'text-ink-muted font-normal')}>
            {selected ? selected.label : placeholder}
          </span>
          {selected?.badge && <span className="shrink-0">{selected.badge}</span>}
        </span>
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-ink-muted transition-transform duration-200 ease-spring-tap group-data-[state=open]:rotate-180"
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'no-drag z-50 flex max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-80 flex-col overflow-hidden origin-(--radix-dropdown-menu-content-transform-origin)',
            MENU_SURFACE,
            'data-[side=bottom]:animate-pop-drop data-[side=top]:animate-pop-lift data-[state=closed]:animate-pop-out',
            menuClassName
          )}
        >
          <div className="flex flex-col gap-0.5 overflow-y-auto py-0.5">
            {options.map((opt) => {
              const active = opt.value === value
              return (
                <DropdownMenu.Item
                  key={opt.value}
                  disabled={opt.disabled}
                  onSelect={() => onValueChange(opt.value)}
                  className={cn(
                    'flex min-h-[30px] cursor-default items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] leading-[18px] text-ink outline-none select-none',
                    'transition-colors duration-100 data-[disabled]:opacity-35 data-[highlighted]:bg-hover',
                    active && 'bg-accent-50/70 font-medium text-ink'
                  )}
                >
                  {opt.icon && (
                    <span className="flex shrink-0 items-center text-ink-secondary [&_svg]:size-3.5">
                      {opt.icon}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="truncate text-[11px] font-normal text-ink-muted">
                        {opt.description}
                      </span>
                    )}
                  </span>
                  {opt.badge && <span className="shrink-0">{opt.badge}</span>}
                  <Check
                    aria-hidden
                    className={cn(
                      'ml-1 size-3.5 shrink-0 text-accent-600 transition-opacity duration-120',
                      active ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </DropdownMenu.Item>
              )
            })}
          </div>
          {footer && (
            <div
              className="mt-1 border-t border-line pt-1.5"
              onKeyDown={(e) => e.stopPropagation()}
            >
              {footer}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
