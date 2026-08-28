import { StatusPill } from './StatusPill';
import { normalizeStatus } from '@/lib/agent-catalog';

interface AgentStatusBadgeProps {
  status: string;
}

// Thin wrapper kept for callers that hold a raw agent_runs.status string.
// The pill itself owns the colour system: running = amber, success = emerald,
// error = red, never run = grey.
export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  return <StatusPill status={normalizeStatus(status)} label={status} />;
}
