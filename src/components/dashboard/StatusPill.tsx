import type { RunStatus } from '@/lib/agent-catalog'

// Status pills: low-opacity background, hairline border, matching dot.
// running = amber, success = emerald, error = red, never = grey.
const STYLES: Record<RunStatus, { wrap: string; dot: string; label: string }> = {
  running: {
    wrap: 'bg-warn/10 text-warn border-warn/20',
    dot: 'bg-warn animate-pulse',
    label: 'Running',
  },
  success: {
    wrap: 'bg-good/10 text-good border-good/20',
    dot: 'bg-good',
    label: 'Success',
  },
  error: {
    wrap: 'bg-crit/10 text-crit border-crit/20',
    dot: 'bg-crit',
    label: 'Error',
  },
  never: {
    wrap: 'bg-faint/10 text-dim border-faint/20',
    dot: 'bg-faint',
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
