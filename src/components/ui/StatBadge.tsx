import React from 'react'

export type StatBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral'

interface StatBadgeProps {
  label: string
  variant: StatBadgeVariant
}

// Literal class strings — Tailwind JIT cannot resolve names built at runtime.
const VARIANTS: Record<StatBadgeVariant, string> = {
  success: 'bg-good/10 text-good border-good/20',
  warning: 'bg-warn/10 text-warn border-warn/20',
  danger: 'bg-crit/10 text-crit border-crit/20',
  neutral: 'bg-line text-muted border-line-strong',
}

const DOTS: Record<StatBadgeVariant, string> = {
  success: 'bg-good',
  warning: 'bg-warn',
  danger: 'bg-crit',
  neutral: 'bg-dim',
}

export function StatBadge({ label, variant }: StatBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOTS[variant]}`} />
      {label}
    </span>
  )
}

export default StatBadge
