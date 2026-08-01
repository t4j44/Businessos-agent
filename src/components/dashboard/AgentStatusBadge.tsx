interface AgentStatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  completed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
  failed: 'bg-red-500/15 text-red-400 border border-red-500/20',
  error: 'bg-red-500/15 text-red-400 border border-red-500/20',
  pending: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  queued: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-400 animate-pulse',
  completed: 'bg-emerald-400',
  success: 'bg-emerald-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  pending: 'bg-amber-400',
  queued: 'bg-amber-400',
};

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? 'bg-slate-500/15 text-slate-400 border border-slate-500/20';
  const dot = STATUS_DOT[key] ?? 'bg-slate-400';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {status}
    </span>
  );
}
