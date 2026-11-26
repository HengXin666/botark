import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SwitchPillProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Tactile spring-animated toggle switch (Grok Bot Sand style).
 */
export function SwitchPill({
  checked,
  onCheckedChange,
  disabled = false,
  'aria-label': ariaLabel,
  size = 'md',
  className
}: SwitchPillProps) {
  const sm = size === 'sm'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'no-drag press relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-1',
        'disabled:pointer-events-none disabled:opacity-40',
        sm ? 'h-[20px] w-[34px] p-[2px]' : 'h-[24px] w-[42px] p-[2px]',
        checked ? 'bg-status-online' : 'bg-ink/16 hover:bg-ink/22',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-soft transition-transform duration-[290ms] ease-spring-tap',
          sm ? 'size-4' : 'size-5',
          checked ? (sm ? 'translate-x-[14px]' : 'translate-x-[18px]') : 'translate-x-0'
        )}
      />
    </button>
  )
}

export interface NumberStepperProps {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  presets?: ReadonlyArray<number>
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * Bespoke numeric stepper with optional quick-preset capsules (no native spinbuttons).
 */
export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 24,
  step = 1,
  suffix,
  presets,
  disabled = false,
  'aria-label': ariaLabel,
  className
}: NumberStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))

  return (
    <div className={cn('no-drag flex flex-wrap items-center gap-2', className)}>
      <div
        role="group"
        aria-label={ariaLabel}
        className="inline-flex h-8 items-center rounded-full border-[0.5px] border-line-strong bg-surface p-0.5 shadow-soft"
      >
        <button
          type="button"
          aria-label="Decrease"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - step))}
          className="press-icon grid size-7 place-items-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <Minus className="size-3.5" />
        </button>
        <span className="min-w-[48px] px-2 text-center text-[13px] font-semibold text-ink tabular-nums select-none">
          {value}
          {suffix ? <span className="ml-0.5 text-[11.5px] font-normal text-ink-muted">{suffix}</span> : null}
        </span>
        <button
          type="button"
          aria-label="Increase"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + step))}
          className="press-icon grid size-7 place-items-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-30"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {presets && presets.length > 0 && (
        <div className="flex items-center gap-1">
          {presets.map((p) => {
            const active = p === value
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onChange(clamp(p))}
                className={cn(
                  'press h-7 rounded-full px-2.5 text-[12px] font-medium tabular-nums transition-colors',
                  active
                    ? 'bg-accent-600 text-white shadow-soft'
                    : 'bg-hover text-ink-secondary hover:bg-active hover:text-ink'
                )}
              >
                {p}
                {suffix ?? ''}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
