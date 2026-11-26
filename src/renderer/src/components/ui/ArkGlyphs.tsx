import type { SVGProps } from 'react'
import { cn } from '@/lib/cn'

export type ArkGlyphProps = SVGProps<SVGSVGElement> & {
  active?: boolean
}

/**
 * 1. Multi-Agent Collaboration Relay Mark
 * Three organic nodes linked by a continuous fluid orbital loop.
 */
export function ArkRelayOrbSvg({ className, active, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M10 4.6C13.1 4.6 15.6 7.1 15.6 10.2C15.6 13.3 13.1 15.8 10 15.8C6.9 15.8 4.4 13.3 4.4 10.2C4.4 7.1 6.9 4.6 10 4.6Z"
        stroke="currentColor"
        strokeOpacity={active ? 0.45 : 0.28}
        strokeWidth="1.35"
        strokeDasharray="2.4 2.2"
      />
      <circle
        cx="10"
        cy="4.3"
        r="2.35"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <circle
        cx="5.1"
        cy="13.4"
        r="2.35"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <circle
        cx="14.9"
        cy="13.4"
        r="2.35"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.45"
      />
    </svg>
  )
}

/**
 * 2. Local Workspace & Scoped MCP Vault Mark
 * Soft squircle folder contour with an embedded modular node.
 */
export function ArkWorkspaceVaultSvg({ className, active, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M3.1 6.6C3.1 5.05 4.35 3.8 5.9 3.8H7.85C8.55 3.8 9.2 4.12 9.63 4.67L10.25 5.45C10.52 5.8 10.94 6 11.38 6H14.1C15.65 6 16.9 7.25 16.9 8.8V13.4C16.9 14.95 15.65 16.2 14.1 16.2H5.9C4.35 16.2 3.1 14.95 3.1 13.4V6.6Z"
        fill="currentColor"
        fillOpacity={active ? 0.16 : 0.08}
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <circle cx="8.1" cy="11.2" r="1.35" fill="currentColor" />
      <circle cx="12.3" cy="11.2" r="1.35" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M9.45 11.2H10.95"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 3. MCP Modular Connector Mark
 * Soft interlocking four-lobe node with central spark core.
 */
export function ArkMcpNodeSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <rect
        x="3.3"
        y="3.3"
        width="5.6"
        height="5.6"
        rx="2"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="11.1"
        y="3.3"
        width="5.6"
        height="5.6"
        rx="2.8"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="3.3"
        y="11.1"
        width="5.6"
        height="5.6"
        rx="2.8"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="11.1"
        y="11.1"
        width="5.6"
        height="5.6"
        rx="2"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/**
 * 4. Slack Pinwheel Weave Mark
 * Rounded four-capsule pinwheel evoking Slack without generic `#`.
 */
export function ArkSlackWeaveSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M7.6 3.7V8.1M12.4 11.9V16.3M3.7 12.4H8.1M11.9 7.6H16.3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12.4" cy="4.4" r="1.25" fill="currentColor" />
      <circle cx="7.6" cy="15.6" r="1.25" fill="currentColor" />
      <circle cx="4.4" cy="7.6" r="1.25" fill="currentColor" fillOpacity="0.65" />
      <circle cx="15.6" cy="12.4" r="1.25" fill="currentColor" fillOpacity="0.65" />
    </svg>
  )
}

/**
 * 5. Consensus Deliverable Seal (`[FINAL]`)
 * Soft scalloped Grok rosette with crisp inner check arc.
 */
export function ArkConsensusSealSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M10 2.5C11.1 2.5 12 3.3 12.9 3.7C13.8 4.1 15 3.9 15.7 4.6C16.4 5.3 16.2 6.5 16.6 7.4C17 8.3 17.8 9.2 17.8 10.3C17.8 11.4 17 12.3 16.6 13.2C16.2 14.1 16.4 15.3 15.7 16C15 16.7 13.8 16.5 12.9 16.9C12 17.3 11.1 18.1 10 18.1C8.9 18.1 8 17.3 7.1 16.9C6.2 16.5 5 16.7 4.3 16C3.6 15.3 3.8 14.1 3.4 13.2C3 12.3 2.2 11.4 2.2 10.3C2.2 9.2 3 8.3 3.4 7.4C3.8 6.5 3.6 5.3 4.3 4.6C5 3.9 6.2 4.1 7.1 3.7C8 3.3 8.9 2.5 10 2.5Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M7.35 10.4L9.15 12.2L12.85 8.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 6. Fluid Peer Handoff Curve
 */
export function ArkHandoffCurveSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      {...props}
    >
      <path
        d="M3 10.5C3 7.4 5.2 5.5 8.6 5.5H12.5M12.5 5.5L9.8 3M12.5 5.5L9.8 8"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 7. Hark Layered Project Stack Mark
 */
export function ArkProjectStackSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M5.2 4.2H14.8C15.8 4.2 16.6 5 16.6 6"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <rect
        x="3.2"
        y="6.7"
        width="13.6"
        height="9.6"
        rx="3"
        fill="currentColor"
        fillOpacity="0.13"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <path
        d="M7 11.5H13"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 8. Bespoke Soft Four-Point Sparkle + Satellite Dot (Grok Sand signature)
 */
export function ArkPromptSparkSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M9.4 2.8C9.65 6.45 10.75 7.55 14.4 7.8C10.75 8.05 9.65 9.15 9.4 12.8C9.15 9.15 8.05 8.05 4.4 7.8C8.05 7.55 9.15 6.45 9.4 2.8Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="14.7" cy="14.3" r="1.45" fill="currentColor" />
    </svg>
  )
}

/**
 * 9. Bespoke Fluid `@` Mention Loop
 */
export function ArkMentionLoopSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <circle cx="10" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12.75 10V11.35C12.75 12.48 13.58 13.3 14.62 13.3C15.82 13.3 16.75 12.1 16.75 10C16.75 6.27 13.73 3.25 10 3.25C6.27 3.25 3.25 6.27 3.25 10C3.25 13.73 6.27 16.75 10 16.75C11.48 16.75 12.82 16.32 13.92 15.56"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 10. Bespoke Compose Fresh Thread Mark
 */
export function ArkComposeNewSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M10.8 3.6H6.8C4.81 3.6 3.2 5.21 3.2 7.2V12.8C3.2 14.79 4.81 16.4 6.8 16.4H12.8C14.79 16.4 16.4 14.79 16.4 12.8V9.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14.6 3.1V7.5M12.4 5.3H16.8"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 11. Bespoke Inspector / Sidebar Drawer Pill Frame
 */
export function ArkDrawerToggleSvg({
  className,
  side = 'right',
  active,
  ...props
}: ArkGlyphProps & { side?: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <rect
        x="2.8"
        y="3.6"
        width="14.4"
        height="12.8"
        rx="3.6"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <rect
        x={side === 'right' ? 11.7 : 4.7}
        y="5.6"
        width="3.6"
        height="8.8"
        rx="1.5"
        fill="currentColor"
        fillOpacity={active ? 0.85 : 0.28}
      />
    </svg>
  )
}

/**
 * 12. Bespoke Export / Share Sheet Mark
 */
export function ArkExportDocSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M10 3.3V11.8M10 3.3L7.1 6.2M10 3.3L12.9 6.2"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.2 11.4V13.6C4.2 15.15 5.45 16.4 7 16.4H13C14.55 16.4 15.8 15.15 15.8 13.6V11.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 13. Bespoke Mobile Wireless Sync Mark
 */
export function ArkMobileLinkSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <rect
        x="4.4"
        y="3.2"
        width="8.4"
        height="13.6"
        rx="2.6"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.45"
      />
      <circle cx="8.6" cy="14.2" r="0.8" fill="currentColor" />
      <path
        d="M14.7 7.6C15.65 8.55 15.65 10.25 14.7 11.2M16.6 5.9C18.35 7.65 18.35 11.15 16.6 12.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 14. Bespoke Sculpted QR Pairing Matrix Mark
 */
export function ArkQrPairingSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <rect
        x="3.2"
        y="3.2"
        width="5.4"
        height="5.4"
        rx="1.8"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="11.4"
        y="3.2"
        width="5.4"
        height="5.4"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <rect
        x="3.2"
        y="11.4"
        width="5.4"
        height="5.4"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12.7" cy="12.7" r="1.2" fill="currentColor" />
      <circle cx="15.6" cy="15.6" r="1.2" fill="currentColor" />
      <path
        d="M15.6 12.2V13.2M12.2 15.6H13.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 15. Bespoke Keychain Security Shield Mark
 */
export function ArkShieldVaultSvg({ className, ...props }: ArkGlyphProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path
        d="M10 2.7L15.7 4.85C16.25 5.06 16.6 5.58 16.6 6.17V9.85C16.6 13.55 13.86 16.42 10 17.5C6.14 16.42 3.4 13.55 3.4 9.85V6.17C3.4 5.58 3.75 5.06 4.3 4.85L10 2.7Z"
        fill="currentColor"
        fillOpacity="0.13"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="9.4" r="1.35" fill="currentColor" />
      <path
        d="M10 10.75V12.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
