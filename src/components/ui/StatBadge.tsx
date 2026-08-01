import React from 'react'

export type StatBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral'

interface StatBadgeProps {
  label: string
  variant: StatBadgeVariant
}

// Literal class strings — Tailwind JIT cannot resolve names built at runtime.
const VARIANTS: Record<StatBadgeVariant, string> = {
  success: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20',
  warning: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20',
  danger: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20',
  neutral: 'bg-[#27272A] text-[#A1A1AA] border-[#3F3F46]',
}

const DOTS: Record<StatBadgeVariant, string> = {
  success: 'bg-[#10B981]',
  warning: 'bg-[#F59E0B]',
  danger: 'bg-[#EF4444]',
  neutral: 'bg-[#71717A]',
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
