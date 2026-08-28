import type { RunStatus } from '@/lib/agent-catalog'

// Status pills: low-opacity background, hairline border, matching dot.
// running = amber, success = emerald, error = red, never = grey.
const STYLES: Record<RunStatus, { wrap: string; dot: string; label: string }> = {
  running: {
    wrap: 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20',
    dot: 'bg-[#F59E0B] animate-pulse',
    label: 'Running',
  },
  success: {
    wrap: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20',
    dot: 'bg-[#10B981]',
    label: 'Success',
  },
  error: {
    wrap: 'bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20',
    dot: 'bg-[#EF4444]',
    label: 'Error',
  },
  never: {
    wrap: 'bg-[#52525B]/10 text-[#71717A] border-[#52525B]/20',
    dot: 'bg-[#52525B]',
    label: 'Never run',
  },
}

export function StatusPill({
  status,
  label,
}: {
  status: RunStatus
  /** Overrides the default wording; the colour still comes from `status`. */
  label?: string
}) {
  const s = STYLES[status] ?? STYLES.never
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${s.wrap}`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  )
}
